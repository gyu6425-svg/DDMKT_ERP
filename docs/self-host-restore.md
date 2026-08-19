# 자체호스팅 이전 절차서 (Supabase 클라우드 → SUB4 Ubuntu VM)

작성 2026-08-18. 독립검증 2팀 + QA 1팀 결과 반영.

---

## 0. 지금 확보된 것

`_backup/<날짜>/` (git 제외 · 로컬만)

| 파일 | 내용 | 검증 |
|---|---|---|
| `pg/schema_public.sql` | 테이블 60 · 인덱스 127(CREATE 59 + PK 58 + UNIQUE 10) · FK 49 · 함수 23 · **RLS 153** · 트리거 3 | 라이브와 전부 일치 |
| `pg/schema_auth_storage.sql` | auth·storage 스키마, 버킷 정의 | ✓ |
| `pg/data_public.sql` | public 데이터 58 테이블 (80 MB) | ✓ |
| `pg/data_auth_storage.sql` | **auth.users 126 · 비밀번호 해시 100 · identities 104** | 라이브와 일치 |
| `*.json` | REST 백업(사람이 읽기용 · 복원용 아님) | banner_outputs·blog_save_queue 는 1행씩 재백업 |

> 해시가 100개인 건 정상이다. 나머지 26명은 익명 22 + 카카오 4 라서 비밀번호가 원래 없다.

⚠ **이 백업에는 평문 자격증명이 들어 있다**(`cafe_studio_settings.naver_pw` 등). 외부로 옮길 땐 반드시 암호 zip.

---

## 1. 이전 전에 반드시 확보 (클라우드 살아 있을 때만 가능)

- [x] ~~Edge Function 소스~~ — **레포에 있다**(2026-08-19 정정, SUB3 지적).
      `supabase/functions/create-customer/index.ts` (배포명 clever-processor).
      배포본 동작도 대조 확인함(OPTIONS→`ok` · GET→405 `POST only`).
      · 남은 확인 1건(선택): 클라우드 배포본이 레포보다 최신인지
        `npx supabase functions download clever-processor` 후 diff.
      · 호출처: `src/api/signup.ts`, `src/api/blogRank.ts:164`, `src/components/CustomerAccountModal.tsx:46`
- [ ] **PostgREST max-rows 확인** — 대시보드 Settings → API. 자체호스팅 `.env` 의 `PGRST_DB_MAX_ROWS` 를 같은 값으로.
      다르면 **에러 없이 결과가 잘린다**(가장 알아채기 힘든 고장).
- [ ] **R2 이미지 전량 백업** — 이미지 실물은 R2 에만 있다(Supabase 원본 삭제됨). Supabase 백업으로 커버 안 됨.
- [ ] Supabase Storage 실물(`cafe-images` 682개 등) 별도 복사 — DB 덤프에 바이너리는 없다.

---

## 2. VM 구성

```
SUB4 (Windows 11 Pro · 상시)
 └ Hyper-V
    └ Ubuntu Server 24.04 LTS   RAM 8GB 고정 · vCPU 4 · 디스크 80GB+
       ├ docker compose (supabase/docker)   ※ pg17 로 맞춘다(클라우드가 17.6)
       └ cloudflared (Cloudflare Tunnel)
```

- **동적 메모리 쓰지 말 것** — Postgres shared_buffers 와 궁합이 나쁘다.
- **logs/analytics 는 켜지 말 것**(기본 off). 8GB 에서 재시작 루프의 주범.
- 호스트 부팅 시 자동 시작 + 종료 시 저장.

---

## 3. 복원 순서 (순서를 지켜야 한다)

```bash
# ① 자체호스팅 먼저 기동해서 auth/storage 마이그레이션을 끝낸다
sh utils/generate-keys.sh          # JWT_SECRET · 키 생성
docker compose up -d

# ② 스키마 → 데이터 순서로 복원
psql "$SELF" -v ON_ERROR_STOP=1 -f pg/schema_public.sql
psql "$SELF" -v ON_ERROR_STOP=1 -f pg/schema_auth_storage.sql
psql "$SELF" -c "SET session_replication_role = replica" -f pg/data_public.sql
psql "$SELF" -c "SET session_replication_role = replica" -f pg/data_auth_storage.sql
```

`session_replication_role = replica` 는 FK 49개 때문에 필수(순서 무관하게 넣기 위해).

---

## 4. 덤프에 안 담기는 것 — 손으로 해야 한다

| 항목 | 조치 |
|---|---|
| Realtime publication | `docs/realtime-reports.sql` 재실행 |
| 카카오 로그인 | GoTrue `GOTRUE_EXTERNAL_KAKAO_*` + 카카오 디벨로퍼스 **Redirect URI 변경** |
| 익명 로그인 | `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=true` (`AuthContext.tsx:135` 이 씀) |
| 이메일 발송 | SMTP 직접 설정 (`signInWithOtp` 사용) |
| Edge Function | `volumes/functions/` 에 배치 후 `restart functions` |
| 스토리지 실물 | rclone 등으로 복사. 또는 처음부터 S3 백엔드를 R2 로 |
| API 키 | 새로 발급 → **전 사용자 로그아웃**(JWT 시크릿이 바뀐다) |

---

## 5. 전환(컷오버)

1. **브라우저 1대만** 먼저 붙여 검증 — 배포 없이 즉시
   ```js
   ddmkt.useBackend('https://새주소', '새 publishable key')   // 콘솔
   ddmkt.whichBackend()                                      // 확인
   ddmkt.useBackend(null)                                    // 원복
   ```
2. 로그인 · 순위트래커 · 발행요청 · 이미지 표시를 눈으로 확인
3. **행 수 대조** — 클라우드 vs 자체호스팅 (조용한 절단 검출)
4. Cloudflare Pages 환경변수 3개(`SUPABASE_URL` `SUPABASE_SERVICE_KEY` `SUPABASE_ANON_KEY`) 교체
5. `.env` 의 `VITE_*` 2개 교체 → `npm run build` 통과 확인 → push (재배포 필수 · 빌드타임 주입)
6. `crawler/.env` 교체 → **main · SUB1 · SUB2 · SUB4 · 고객PC** 전파 → 파이썬 데몬 **전부 재시작**
7. **클라우드 프로젝트는 최소 2주 유지**(롤백용). Egress 초과는 삭제 사유가 아니다.

---

## 6. 되돌리기

- 웹: `ddmkt.useBackend(null)` → 새로고침. 전체는 Pages 환경변수 원복 + 재배포(약 3분)
- 크롤러: `.env` 원복 + 데몬 재시작
- 데이터: 전환 후 자체호스팅에 쌓인 변경분은 수동 이관 필요 → **컷오버는 발행이 없는 시간대에**

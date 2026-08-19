# 자체호스팅 설치·복원 절차 (SUB4 Ubuntu VM)

전제: VM 생성 완료 · Ubuntu 24.04 · Docker 설치됨 · 내부 IP 확인됨.
이 문서는 **내부 IP 로만** 진행한다. 도메인·Tunnel 은 마지막 컷오버 때 붙인다.

---

> **⚠ Hyper-V 콘솔에 긴 문자열을 붙여넣지 말 것**
> 콘솔은 Ctrl+V 가 안 되고 `클립보드 → 클립보드 텍스트 입력` 으로 자동 타이핑하는데,
> 공개키(68자) 같은 긴 문자열은 글자가 누락된다(SUB4 실측 2026-08-19 — 여러 번 시도 후 파일이 빔).
> SSH 키 등록은 콘솔이 아니라 **비밀번호 SSH 접속으로 한 번에** 처리한다:
> ```powershell
> type $env:USERPROFILE\.ssh\ddmkt_vm.pub | ssh ddmkt@<VM_IP> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
> ```

> **전제 확인** — Docker 는 아래로 설치한다(Ubuntu 24.04).
> ```bash
> sudo apt -y install docker.io docker-compose-v2 git curl
> ```
> `docker-compose-plugin` 은 Ubuntu 저장소에 없다(Docker 공식 저장소 전용).
> SUB4 실측 2026-08-19 — `Unable to locate package` 로 막혔다.

## 1. Supabase 내려받기

```bash
cd ~
git clone --depth 1 https://github.com/supabase/supabase
mkdir -p ~/ddmkt-db && cd ~/ddmkt-db
cp -r ~/supabase/docker/* .
cp .env.example .env
```

## 2. 키 생성 (클라우드 키는 못 쓴다 — JWT 시크릿이 다르다)

```bash
sh utils/generate-keys.sh                    # JWT_SECRET · DB 비번 · 레거시 키
sh utils/add-new-auth-keys.sh --update-env   # 신형 publishable/secret 키
grep -E 'ANON_KEY|SERVICE_ROLE_KEY|PUBLISHABLE|SECRET_KEY|POSTGRES_PASSWORD' .env
```
→ 출력값을 main 에 전달(앱·크롤러 전환에 쓴다).

## 3. `.env` 손볼 항목

```bash
# ★ 클라우드와 같은 값이어야 한다. 다르면 에러 없이 결과가 잘린다(가장 찾기 힘든 고장).
PGRST_DB_MAX_ROWS=1000

# 외부에서 접근할 주소. 지금은 내부 IP, 컷오버 때 db.<도메인> 으로 교체.
API_EXTERNAL_URL=http://<VM_IP>:8000
SUPABASE_PUBLIC_URL=http://<VM_IP>:8000
SITE_URL=https://ddmkt-erp.pages.dev

# 익명 로그인 — AuthContext 가 쓴다. 끄면 게스트 경로가 죽는다.
ENABLE_ANONYMOUS_USERS=true

# 메일 발송(비번 재설정 등). 없으면 그 기능만 안 된다 — 나중에 채워도 된다.
SMTP_HOST= / SMTP_PORT= / SMTP_USER= / SMTP_PASS= / SMTP_SENDER_NAME=
```

## 4. 기동 (PG17 · 로그 스택은 켜지 않는다)

```bash
docker compose -f docker-compose.yml -f docker-compose.pg17.yml up -d
docker compose ps          # 전부 running/healthy 확인
```
> analytics(Logflare)는 기본 off. 6GB VM 에서 재시작 루프의 주범이니 켜지 말 것.

## 5. 백업 파일 옮기기 (main → VM · 80MB)

main PC 에서:
```powershell
scp -r "C:\Users\ddmkt\DDMKT_ERP\_backup\2026-08-18\pg" ddmkt@<VM_IP>:~/restore
```

## 6. 복원 — 순서를 지킨다

```bash
cd ~/ddmkt-db
DB="postgresql://postgres:$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2)@localhost:5432/postgres"

# ① 우리 스키마(테이블 60·RLS 153·함수 23·트리거 3)
psql "$DB" -v ON_ERROR_STOP=1 -f ~/restore/schema_public.sql

# ② 데이터 — FK 49개 때문에 순서 무시하도록 replica 모드
psql "$DB" -c "SET session_replication_role = replica" -f ~/restore/data_public.sql

# ③ 로그인 계정 — auth 스키마는 컨테이너가 이미 자기 버전으로 만들어 뒀다.
#    스키마는 덮지 말고 데이터만 넣는다(GoTrue 버전 불일치 방지).
psql "$DB" -c "SET session_replication_role = replica" -f ~/restore/data_auth_storage.sql
```
③에서 컬럼 불일치 오류가 나면 스키마를 덮지 말고 **main 에 오류 전문**을 보낼 것.

## 7. 덤프에 안 담기는 것 — 손으로

```bash
# Realtime publication (보고 알림 2곳이 쓴다)
psql "$DB" -c "alter publication supabase_realtime add table public.blog_post_reports;"

# 스토리지 버킷 5개
psql "$DB" -c "insert into storage.buckets (id,name,public) values
  ('cafe-images','cafe-images',false),('deploy-intake','deploy-intake',false),
  ('blog-materials','blog-materials',false),('blog-save-images','blog-save-images',false),
  ('blog-studio','blog-studio',false) on conflict do nothing;"
```
- Edge Function: `supabase/functions/create-customer/index.ts` 를 `volumes/functions/clever-processor/index.ts` 로 복사 후 `docker compose restart functions`
- 카카오 로그인: 이번엔 안 함(고객 4곳 별도 안내)

## 8. 검증 — '떴다'와 '된다'는 다르다

```bash
psql "$DB" -c "select count(*) from information_schema.tables where table_schema='public';"   -- 58
psql "$DB" -c "select count(*) from pg_policies where schemaname='public';"                   -- 153
psql "$DB" -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public';" -- 23
psql "$DB" -c "select count(*) from auth.users;"                                              -- 126
psql "$DB" -c "select count(*) from auth.users where encrypted_password is not null;"         -- 100
psql "$DB" -c "select count(*) from public.cafe_rank_posts;"   -- 클라우드와 대조
curl -s "http://localhost:8000/rest/v1/cafe_accounts?select=id&limit=1" -H "apikey: <ANON_KEY>"
```

## 9. 브라우저 1대만 붙여 리허설 (운영은 안 건드린다)

ERP 열고 콘솔에서:
```js
ddmkt.useBackend('http://<VM_IP>:8000', '<PUBLISHABLE_KEY>')   // 새로고침
ddmkt.whichBackend()
ddmkt.useBackend(null)                                          // 원복
```
확인 항목: 로그인 · 순위트래커 · 카페 대시보드 · 이미지 표시 · 발행요청 적재

---

## 되돌리기

- VM 스냅샷(clean-install)으로 롤백 → 1분
- 브라우저는 `ddmkt.useBackend(null)`
- 운영 Supabase 는 이 과정에서 **한 번도 건드리지 않는다**

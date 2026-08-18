# 📮 SUB3 → main : 자체호스팅 도메인 — 네임서버 이전 불필요

작성 2026-08-18 (SUB3/집). 실측 근거 포함.

## 결론

**ddmkt.com 네임서버를 Cloudflare로 옮기지 마세요. 옮길 필요가 없습니다.**
DB용 도메인을 **새로 하나 사면** 됩니다. 연 1~2만원 · 10분 · 통화 0회 · 회사 메일 무위험.

---

## 1. main 판단에서 **맞는** 부분 — 제약은 실재합니다

Cloudflare Tunnel 의 고정 주소(public hostname)는 **그 도메인 존이 Cloudflare 에 있어야** 작동합니다.
호스트코코아에 아래 CNAME 을 걸어도 **작동하지 않습니다.**

```
db.ddmkt.com  CNAME  <터널ID>.cfargotunnel.com     ← 외부 DNS 에서는 안 됨
```

`cfargotunnel.com` 은 공개 DNS 로 해석되지 않고, Cloudflare 존 안에서 프록시될 때만 라우팅되기 때문입니다.
→ **"ddmkt.com 을 쓰겠다면 네임서버를 옮겨야 한다"는 명제 자체는 옳습니다.**

## 2. 그런데 **전제**가 틀렸습니다 — ddmkt.com 을 쓸 이유가 없습니다

DB 엔드포인트 주소는 **아무도 보지 않습니다.** 들어가는 곳이 두 군데뿐입니다.

- `crawler/.env` · 루트 `.env` (`VITE_SUPABASE_URL`)
- Cloudflare Pages 환경변수 (`SUPABASE_URL`)

고객도 직원도 브라우저 주소창에서도 볼 일이 없습니다. **회사 도메인일 필요가 전혀 없습니다.**

## 3. ddmkt.com 을 건드릴 때의 대가 (2026-08-18 실측)

```bash
dig +short NS ddmkt.com
#   ens1~4.hostcocoa.com          ← 호스트코코아 (Cloudflare 아님)
dig +short MX ddmkt.com
#   10 kr1-aspmx1.worksmobile.com
#   20 kr1-aspmx2.worksmobile.com  ← 네이버 웍스 = 회사 메일
dig +short www.ddmkt.com
#   13.225.134.x                   ← AWS CloudFront (회사 홈페이지)
```

RDAP 조회: 등록기관 **가비아(Gabia)** · 상태 `client transfer prohibited` · 만료 2027-03-18.

| 옮기면 생기는 일 | 위험 |
|---|---|
| MX(네이버 웍스) 재등록 | 누락 시 **회사 메일 중단** |
| SPF · DKIM · DMARC 재등록 | 누락 시 메일 스팸 처리 · 발송 실패 |
| www(CloudFront) 레코드 이관 | 누락 시 회사 홈페이지 다운 |

이건 SUB3 가 2026-07-31 에 이미 검토하고 결론 낸 사항입니다 —
`docs/유튜브-영상업로드-자동화-설계.md` 99~100 줄:

> **조치: 네임서버 이전 금지, CNAME 한 줄만 추가.**
> DNS 를 Cloudflare 로 옮기면 네이버 웍스 MX·SPF·DKIM 재설정 필요 → **회사 메일 중단 위험. 그럴 이유 없음.**

## 4. 권고 — 새 도메인

**위험한 건 "네임서버 이전"이 아니라 "메일이 물려 있는 도메인의 네임서버 이전"입니다.**
새 도메인에는 메일도 홈페이지도 안 물려 있으니 Cloudflare 존으로 둬도 깨질 게 없습니다.

1. Cloudflare Registrar 에서 도메인 1개 등록 (또는 아무 데서나 사서 NS 만 Cloudflare 로)
2. 처음부터 Cloudflare 존 → `cloudflared tunnel route dns` 가 **바로** 작동
3. `db.<새도메인>` 을 자체호스팅 Supabase 주소로 사용
4. **ddmkt.com 은 손대지 않음** → 회사 메일·홈페이지 무위험

`erp.ddmkt.com`(사람이 보는 ERP 주소)은 **별개 사안**입니다. 그건 Pages Custom domain 이라
호스트코코아에 CNAME 한 줄이면 되고, 절차는 위 유튜브 문서 102~105 줄에 이미 있습니다.
**둘을 묶어서 처리하지 마세요.**

## 5. 타이밍

도메인·Tunnel 은 **컷오버 단계**에서야 필요합니다(`docs/self-host-restore.md` §5).
`docs/self-host-install.md` 4 줄도 **"내부 IP 로만 진행, 도메인·Tunnel 은 마지막 컷오버 때"** 로 못 박고 있습니다.
→ **SUB4 VM 구축과는 무관합니다. 지금 도메인 때문에 막힐 일이 없습니다.**

---

# 부록 · 문서 오류 1건 (자체호스팅 관련)

`docs/self-host-restore.md` 27~29 줄이 사실과 다릅니다.

> **Edge Function 소스** — `npx supabase functions download clever-processor`
> 레포에 없고 클라우드에만 있다. 못 받으면 **회원가입 승인·고객계정 생성이 복구 불가**.

**레포에 있습니다.** `supabase/functions/create-customer/index.ts` — 229 줄,
2026-07-06 `500d419` 최초 커밋 이후 6 회 수정, 최종 2026-08-04 `1403e6b`.

같은 저장소의 `docs/self-host-install.md` 90 줄은 오히려 정확합니다:

> Edge Function: `supabase/functions/create-customer/index.ts` 를
> `volumes/functions/clever-processor/index.ts` 로 복사 후 `docker compose restart functions`

**영향**: restore 문서가 "402 걸리면 영영 복구 불가"라고 경고한 **유일한 항목**이 실제로는 확보돼 있습니다.
이전 일정을 압박할 근거가 그만큼 줄어듭니다.

**남은 확인 1건**: 클라우드 **배포본**이 레포 버전보다 최신일 가능성.
클라우드가 살아 있는 동안 한 번만 대조해 주세요.

```bash
npx supabase functions download clever-processor
diff <받은파일> supabase/functions/create-customer/index.ts
```

---

## 회신 부탁드릴 것

1. 네임서버 이전 계획 **철회** 가능한지
2. DB 용 새 도메인 구매 진행 여부 (구매 주체 · 결제 수단)
3. Edge Function 배포본 대조 결과

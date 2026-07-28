# 카페 발행 MCP 서버 — 구현계획 (독립검증)

> ⛔ **상태: 기각(2026-07-27) — 미구현.** 카페 발행은 MCP 대신 **기존 에이전트/파이썬 방식**(`crawler/cafe_pub/agent_main.py` 등)을 고객ERP UI에 붙이는 방향으로 결정됨. 이 문서는 "검토했으나 채택 안 함" 기록으로만 보존.
> (기각 사유 요약: MCP는 트리거 레이어만 바꿀 뿐 발행 난이도의 핵심인 로그인 세션·안티봇·스마트에디터 안정화를 개선하지 못하고, 결정적·무료 폴링을 비결정적·유료 호출로 다운그레이드. 자세한 반증은 아래 §1.)
>
> ---
> (이하 원본 계획 — 참고용)
>
> 원래 목표: 브랜치 `sub3`(집 맥, darwin)에서 스캐폴딩 + dry-run.
> 독립검증(리서처·리뷰어·플래너 3역할 + QA)으로 도출.

## 0. 목표와 결정 사항

- **접근**: 커스텀 MCP 서버(stdio)로 기존 파이썬 발행함수 `publish_job`을 **래핑**. Claude가 MCP tool로 발행을 트리거하는 걸 실험. 발행 엔진(`crawler/cafe_pub/publish_cafe.py`)은 **재구현하지 않고 그대로 호출**.
- **환경**: 지금은 **맥에서 스캐폴딩 + dry-run만**. 실제 네이버 등록은 나중에 윈도우 PC에서.
- **파이썬**: `brew install python@3.12` + 전용 venv 사용 승인됨(시스템 3.9.6으로는 공식 `mcp` SDK 임포트 불가).

## 1. 왜 이 설계인가 (독립검증 핵심 결론)

리뷰어 반증: **카페 발행의 어려움은 "무엇이 tool을 호출하느냐(트리거)"가 아니라 "살아있는 로그인 크롬 세션을 안 튕기고 오래 조종하느냐(실행)"에 있다.** MCP는 트리거 레이어만 바꾸며, 발행 성공률·계정 안전에는 기여하지 않는다. 따라서:

- MCP는 **얇은 수동 실험용 배관**으로만 둔다. 폴링/좀비회수/발행간격/자동재로그인은 절대 복제하지 않는다(리스너 소관).
- 기존 결정적·무료 트리거(`publish_listener.py`)를 대체하지 않는다. **동시 구동 금지**.

## 2. 반드시 지킬 제약 (실측 근거)

| 제약 | 근거 |
|---|---|
| 발행 엔진은 로그인된 헤드리스 크롬(**CDP 127.0.0.1:9223**)에 붙어 동작. 로컬 전용, 원격 불가 | `crawler/cafe_pub/publish_cafe.py:44` `DEFAULT_CDP` |
| `ctypes.windll.user32`(**윈도우 전용**)로 파일업로드 창 처리 → 맥에선 실제 발행 불가 | `publish_cafe.py:202` `_focus_naver_window` |
| 맥에선 `no_send=True`여도 이미지 업로드 단계에서 실패 → dry-run 경계를 **"publish_job 자체 미호출"**로 앞당김 | 위 두 항목 |
| 리스너와 MCP tool이 동시에 같은 큐(pending) 소비 시 **중복발행** → 트리거 이중화 금지 | `docs/cafe-multi-pc.md:15-17` |
| `publish_job(job, cdp_url, no_send, on_submit)` 시그니처 그대로 활용 | `publish_cafe.py:768` |
| 시각은 **naive KST 벽시계** 규약(UTC 쓰면 9시간 skew로 발행 막힘) | `publish_listener.py:50-54`, 91-94 |
| 자동 재로그인 금지 정책 유지(캡차/2FA/계정잠금 위험) | `publish_cafe.py:730` |
| 파이썬엔 storage **업로드** 헬퍼 없음(다운로드만) → enqueue는 **text 전용** 또는 기존 path 참조 | `publish_cafe.py:191` `storage_download` |

## 3. 파일 구성 (신규)

```
crawler/cafe_mcp/
  server.py          # FastMCP 인스턴스 + @mcp.tool 정의 (엔트리포인트)
  queue_ops.py       # sb_get/sb_patch 래핑 + _sb_insert(POST) + CAS 잠금
  requirements.txt   # mcp>=1.0
  .env.example       # CAFE_MCP_ALLOW_PUBLISH=0 등 토글 문서화
  README.md          # 맥 dry-run / 윈도우 이관 / 이중트리거 금지 운영수칙
```

- `server.py`가 `sys.path.insert(0, <.../cafe_pub>)` 후 `import publish_cafe as pc`. 엔진 `_load_env()`가 `.env`를 자동 로드 → SUPABASE 자격증명 재사용(별도 설정 불필요).

## 4. 노출할 MCP tool (최소셋 4개, 읽기→부작용 순)

1. **`cafe_queue_list`** — 큐 조회. 입력 `status?/company?/limit?`. `pc.sb_get(...)`. 부작용 없음(읽기).
2. **`cafe_session_ping`** — 세션/CDP 진단. `pc.session_ping(pc.DEFAULT_CDP)` → `ok|expired|chrome_unreachable`. 맥에선 크롬 없어 `chrome_unreachable`(윈도우 코드 미도달, 안전).
3. **`cafe_queue_enqueue`** — pending 적재. 입력 `title/manifest/company?/region?/keyword?/client_key`. `_sb_insert`(REST POST). **idempotent**: `client_key`를 id로, 선존재 확인 후 재삽입 금지. **이미지 업로드 안 함** → text 전용 매니페스트 또는 기존 storage path 참조.
4. **`cafe_publish_dryrun`** — 특정 job을 no_send로 시도. 흐름: 행 로드 → **CAS 잠금**(`expect="pending"`, 실패 시 "다른 소비자 선점" 반환) → **맥 가드**(`CAFE_MCP_ALLOW_PUBLISH!="1"`이면 processing→pending 롤백 후 정지, `publish_job` 미실행) → 윈도우/ALLOW=1일 때만 `pc.publish_job(job, DEFAULT_CDP, no_send=True)`.

노출 안 함: 폴링 루프, `_reap_stale`, 발행간격, 자동재로그인 — 전부 리스너 소관.

## 5. 맥 dry-run 검증 전략

| 대상 | 방법 | 멈추는 지점 |
|---|---|---|
| tool 배관(stdio) | `mcp dev` 또는 Claude Code에서 호출 | JSON-RPC 왕복 |
| list | 실 Supabase 조회 | 완주(읽기) |
| enqueue | 실 Supabase에 **text 전용** pending 1건 → list 재확인 → 수동 삭제 | 완주(크롬 무관) |
| dryrun | 가드로 **CAS 잠금까지만**, `publish_job` 미실행 | processing→pending 롤백 |
| ping | `session_ping` → 크롬 9223 없어 `chrome_unreachable` | `_connect` 예외 삼킴 |

발행 경로는 `publish_job` **호출 자체를 차단**하는 것으로 경계(맥에선 완주 불가).

## 6. 프로덕션(윈도우) 이관 시 + 이중 트리거 방지

- 윈도우: `CAFE_MCP_ALLOW_PUBLISH=1` → dryrun tool이 실제 `publish_job(no_send=True)` 실행(등록 직전까지 채움, 수동 등록). `run_chrome.bat`(로그인 헤드리스 크롬 9223) 선구동 전제.
- **운영수칙(README 명문화)**: 리스너와 MCP 발행 tool을 **동시에 켜지 말 것**. 하나 켜면 하나 끔. CAS 잠금은 최후 방어일 뿐. 자동재로그인 금지 유지.

## 7. Claude Code 연결 (`.mcp.json`)

```json
{
  "mcpServers": {
    "cafe-pub": {
      "command": "/절대경로/venv312/bin/python",
      "args": ["/Users/jang-gyujin/Marketing ERP Dashboard/crawler/cafe_mcp/server.py"],
      "env": { "CAFE_MCP_ALLOW_PUBLISH": "0" }
    }
  }
}
```

- `command`는 3.12 venv 파이썬 절대경로. SUPABASE 키는 넣지 않음(엔진 `_load_env()`가 `.env` 로드).
- **커밋 안 함**(결정): 절대경로가 머신 종속이라 윈도우 PC와 충돌 → 개인 로컬로 두고 `.gitignore`에 추가.

## 8. 단계별 작업 순서

1. **환경 준비**: `brew install python@3.12` → venv → `pip install -r crawler/requirements.txt -r crawler/cafe_mcp/requirements.txt`. 검증: `python -c "import mcp, requests, publish_cafe"`.
2. **스캐폴딩**: `crawler/cafe_mcp/` 파일 생성 + 엔진 임포트 배선. 검증: `python server.py` stdio 대기.
3. **tool 구현**: list → ping → enqueue → dryrun. `_sb_insert`, `_now_iso`(KST 복제), CAS, ALLOW 가드.
4. **dry-run 테스트**(§5): list→enqueue(text)→list→dryrun(가드 정지)→ping. enqueue 행 수동 삭제.
5. **Claude Code 연결**: `.mcp.json`(비커밋) → 4개 tool 인식·호출.
6. **커밋**(승인 시): `crawler/cafe_mcp/*`, requirements. `.env`·venv·`.mcp.json` 제외. 브랜치 sub3.

## 9. 미결정 / 추후 확인

- enqueue 이미지 범위: 현재 **text 전용 dry-run** 권장. 웹의 `varyImage`+업로드 파이썬 재현은 별도 과제(권장 안 함).
- 실제 발행 완주 검증은 **윈도우 PC 이관 후에만** 가능(맥에선 확정 불가).
- `board` 컬럼 불일치(경미): 웹 insert는 `board` 컬럼 사용하나 `docs/cafe-publish-queue.sql`엔 정의 없음(라이브 DB에만 존재 추정). enqueue tool은 board를 manifest에만 넣고 최상위 컬럼엔 안 넣는 게 안전.

---

### 참조 파일
- `crawler/cafe_pub/publish_cafe.py` (publish_job:768, sb_get:166, sb_patch:172, session_ping:726, DEFAULT_CDP:44, ctypes:202)
- `crawler/cafe_pub/publish_listener.py` (CAS·_now_iso KST·이중소비 방지 참조)
- `src/api/cafePublishQueue.ts` (manifest 스키마·createPublishJob 대응 기준)
- `docs/cafe-publish-queue.sql` (큐 컬럼·status 값)

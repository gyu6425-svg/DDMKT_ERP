# 블로그 순위 크롤러

사무실 PC에서 **매일 자동 실행**되어, 관리 블로그들의 최신 글을 수집하고
네이버 검색 순위(통합탭/블로그탭)를 측정해 Supabase에 기록합니다.
웹 ERP의 **블로그 대시보드**가 이 데이터를 표시합니다.

> HTTP 요청만 사용합니다. AI/토큰 비용이 들지 않습니다.

## 순위 측정 방식 (중요)

- **블로그탭 순위(bl)** — **네이버 공식 검색 API(JSON)** 로 측정합니다. HTML 파싱이 아니라
  공식 엔드포인트라 안정적이고, 글의 정확한 logNo로 매칭합니다. → 실제 순위가 잘 잡힙니다.
- **통합검색 순위(ti)** — 공식 API가 없어 모바일 통합검색 HTML을 파싱합니다(best-effort).
  결과 영역 우선 스캔 + 리다이렉트 링크 해제 + URL 패턴 매칭으로 최대한 견고하게 구성했고,
  네이버가 구조를 바꿔도 페이지 전체 퍼머링크 스캔으로 폴백합니다.

## 1. 준비 (최초 1회)

먼저 **Python 3.10+ 설치**(python.org). 그다음:

```bash
cd crawler
pip install -r requirements.txt
copy .env.example .env       # mac/linux: cp .env.example .env
```

`.env` 채우기:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` — Supabase > Project Settings > API의 **service_role** 키
  - ⚠️ anon 아님. RLS 우회 기록용이라 **절대 외부 노출 금지.** `.env` 는 깃에 안 올립니다.
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` — 블로그탭 순위 안정화를 위해 권장
  - https://developers.naver.com → **Application 등록** → 사용 API에 **검색** 추가 → 발급 (무료, 하루 25,000회)
  - 비워두면 HTML 폴백으로 동작(정확도↓)

## 2. 실제로 잡히는지 먼저 검증 (디버그)

```bash
python blog_rank_crawler.py --debug "송파 입주청소" --blog-id yellowhead76
```
- 해당 키워드의 블로그탭 상위 결과 목록과, 그 블로그가 **몇 위인지** 바로 출력합니다.
- 특정 글 기준으로 보려면 `--post-url https://blog.naver.com/yellowhead76/2230...` 추가.

여기서 순위가 정상적으로 나오면, 전체 실행도 정상입니다.

## 3. 전체 실행 (수동)

```bash
python blog_rank_crawler.py
```
- 활성 블로그 RSS에서 최신 글을 `blog_posts` 에 동기화
- 각 글의 키워드로 순위 측정 → `measurements` 에 오늘 값 추가 (같은 날 1회만)

## 4. 매일 09:00 자동 실행 (Windows 작업 스케줄러)

1. **작업 스케줄러** → **기본 작업 만들기**
2. 트리거: **매일 09:00**
3. 동작: **프로그램 시작**
   - 프로그램/스크립트: `python`
   - 인수: `blog_rank_crawler.py`
   - 시작 위치: 이 `crawler` 폴더 전체 경로
4. "가장 높은 권한으로 실행", "사용자 로그온 여부와 관계없이 실행" 권장

> PC가 켜져 있어야 실행됩니다.

## 한계 / 튜닝

- RSS 수집과 블로그탭(API) 순위는 안정적입니다.
- 통합검색(ti)이 계속 `권외(99)` 로만 나오면, `blog_rank_crawler.py` 의
  `RESULT_CONTAINERS` (결과영역 CSS 후보)에 현재 페이지에 맞는 셀렉터를 추가하세요.
  디버그 모드로 확인하며 조정하면 됩니다.
- 키워드는 글 제목에서 자동 추출(`extract_keyword`)합니다. 정확도를 높이려면 로직을 수정하거나
  추후 글별 키워드 수동 지정 기능을 붙일 수 있습니다.

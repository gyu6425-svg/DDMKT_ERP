# 스캔 전용 PC 세팅 (예: sub4) — 카페 인기탭 워커

이 PC는 **인기탭 스캔만** 하는 전용 워커다. 큐에서 작업을 받아 **이 PC의 IP로** 스캔하고
결과를 공유 캐시에 저장한다. **크롤·발행은 절대 여기서 하지 않는다**(IP 격리가 목적).

> 참고: sub4는 원래 모바일테더링 PC였음 → 이제 **스캔 전용 워커**로 전환. 이 PC의 IP가 곧
> 하나의 "스캔 레인". 여러 전용 PC를 두면 IP가 분산돼 용량이 PC 수만큼 늘어난다.

---

## 0. 30초 설치
```bat
:: 1) 코드 받기 (git 있으면)
git clone http://github.com/gyu6425-svg/DDMKT_ERP.git
:: (git 안 되면 main PC의 DDMKT_ERP\crawler 폴더를 통째로 복사)

:: 2) DDMKT_ERP\.env 에 아래 2줄 (main의 .env에서 복사)
::    SUPABASE_URL=https://xxxx.supabase.co
::    SUPABASE_SERVICE_KEY=eyJ...(서비스키)

:: 3) 설치 실행 (원클릭)
DDMKT_ERP\crawler\install_kw_worker.bat
```
→ Python 패키지 설치 + 자동시작 등록 + 워커 실행까지 한 번에.

---

## 1. 필요한 것
- Windows PC + 인터넷 (모바일테더링이어도 됨 — 그 IP가 스캔 레인)
- Python 3.9+ (install_kw_worker.bat 이 없으면 winget으로 자동 설치 시도)
- `DDMKT_ERP\.env` 에 **SUPABASE_URL / SUPABASE_SERVICE_KEY** (큐·캐시 접근용, main에서 복사)

## 2. 설치 단계 (자세히)
1. **Python 설치**(없으면) — python.org 또는 `winget install -e --id Python.Python.3.12`
2. **코드**: `git clone http://github.com/gyu6425-svg/DDMKT_ERP.git` (GitHub 접근 필요) — 또는 main의 `crawler` 폴더 복사
3. **키**: `DDMKT_ERP\.env` 파일에 SUPABASE_URL·SUPABASE_SERVICE_KEY 2줄 (main의 `.env` 그대로 복사)
4. **원클릭 설치**: `DDMKT_ERP\crawler\install_kw_worker.bat` 더블클릭
   - 의존 패키지(truststore·requests·beautifulsoup4·python-dotenv) 설치
   - Startup 폴더에 자동시작 등록(부팅 시 워커 상시 실행)
   - 워커 즉시 실행
5. **확인**: `DDMKT_ERP\crawler\kw_worker.log` 에
   ```
   === 카페 인기탭 워커 시작 · <PC이름>-<pid> ===
   [<id>] <업체명> → 인기탭 N건
   ```

## 3. 동작 방식
```
부팅 → 워커 자동 시작 → 큐(cafe_kw_requests) 폴링
  → 요청 원자적으로 하나 집음(다른 워커와 중복 X)
  → 이 PC IP로 인기탭 스캔(공유캐시 있으면 재사용 → 스크랩 skip)
  → 결과를 요청.result + 공유캐시(cafe_kw_targets) 저장
[고객ERP·우리]는 캐시만 읽음
```

## 4. ⚠️ 규칙
1. **스캔 전용** — 이 PC엔 카페 발행·블로그 크롤 설치하지 말 것 (IP 격리)
2. **자기 IP 직접 스캔** — `--cf` 안 씀(그게 분산의 핵심). 이 PC IP가 하나의 레인
3. **차단 나면**(kw_worker.log에 code 0/차단) 잠시 멈췄다 재개 — 워커가 알아서 간격(2초)·캐시로 완화하지만, 과하면 요청 target을 줄여 접수
4. 리소스 거의 안 씀(HTTP만) — 다른 용도로 켜둬도 무방하나 발행/크롤만 금지

## 5. 워커 수동 실행/중지
```bat
:: 수동 1건만(테스트)
cd DDMKT_ERP\crawler & python cafe_kw_worker.py --once
:: 상시(자동시작이 이미 하지만 수동으로도)
cd DDMKT_ERP\crawler & python cafe_kw_worker.py
:: 중지: 작업관리자에서 python / wscript 종료, Startup의 ddmkt-kw-worker.vbs 삭제
```

## 6. 업데이트
```bat
cd DDMKT_ERP & git pull    :: 코드 최신화 후 워커 재시작
```

---
관련: `cafe_kw_probe_SETUP.md`(스캐너 방법론·플래그), `docs/cafe-kw-queue.sql`(큐·캐시 스키마).

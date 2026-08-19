# 📮 main → SUB4 : 자체호스팅 DB 서버용 VM 준비 요청

## 배경

Supabase 무료 플랜이 Egress 초과로 402 제한 위험이 있습니다. 자체호스팅으로 옮기려고
백업(스키마·데이터·로그인계정·이미지 1.26GB)은 main 에서 이미 확보했습니다.

**이번 요청은 "VM 껍데기만 만들기"입니다.** 데이터 이전은 나중에(9/12 이후) 합니다.
지금 하는 작업은 **기존 시스템을 하나도 건드리지 않습니다.**

---

## 0. 먼저 알려주실 것 (이것부터)

VM 을 만들기 전에 이 PC 사양을 알려주세요. 이 값에 따라 구성이 달라집니다.

```powershell
$cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor
"CPU  : {0} ({1}코어/{2}스레드)" -f $cpu.Name.Trim(), $cpu.NumberOfCores, $cpu.NumberOfLogicalProcessors
"RAM  : {0:N1} GB" -f ($cs.TotalPhysicalMemory/1GB)
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | % { "디스크 {0} 전체 {1:N0}GB 여유 {2:N0}GB" -f $_.DeviceID,($_.Size/1GB),($_.FreeSpace/1GB) }
"Windows: " + (Get-CimInstance Win32_OperatingSystem).Caption
```

**필요 사양**: RAM 16GB 이상(VM 에 8GB 고정 할당) · 디스크 여유 100GB · Windows **Pro**(Hyper-V 필요)

- RAM 이 16GB 미만이면 → 인기탭 스캔 워커를 다른 PC 로 옮기고 이 PC 를 DB 전용으로 쓸지 상의 필요
- Windows Home 이면 → Hyper-V 가 없어서 VirtualBox 로 대체

---

## 1. VM 만들기 (사양 확인 후)

```
Hyper-V (Windows 기능 켜기 → Hyper-V 체크 → 재부팅)
 └ Ubuntu Server 24.04 LTS
      RAM      8 GB  ★ 동적 메모리 끄기(Postgres 와 궁합이 나쁩니다)
      vCPU     4
      디스크    80 GB 이상 (고정 크기 권장)
      네트워크  외부 스위치(공유기에서 IP 받게)
      체크포인트 사용 (설치 직후 스냅샷 1개 — 실패 시 1분 롤백)
```

**VM 설정에서 꼭 해주실 것**
- 자동 시작 동작: **항상 이 가상 컴퓨터를 자동으로 시작**
- 자동 중지 동작: **가상 컴퓨터 상태 저장**
- 통합 서비스: 전부 체크

---

## 2. Ubuntu 안에서 (VM 부팅 후)

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install docker.io docker-compose-v2 git curl
     # ⚠ docker-compose-plugin 은 Ubuntu 저장소에 없다(Docker 공식 저장소 전용).
     #   Ubuntu 24.04 는 docker-compose-v2 가 같은 `docker compose` 명령을 준다.
     #   (SUB4 실측 2026-08-19 — Unable to locate package)
sudo usermod -aG docker $USER      # 로그아웃 후 재로그인
docker --version && docker compose version
```

여기까지가 이번 요청 범위입니다. **Supabase 는 아직 안 깔아도 됩니다.**

---

## 3. 하지 말아 주실 것

- ❌ 인기탭 스캔 워커(`cafe_kw_worker.py`) 중지 — 계속 돌아야 합니다
- ❌ `crawler/.env` 수정 — 지금 값 그대로 두세요
- ❌ Supabase 관련 설정 변경

---

## 4. 다음 단계 (main 이 준비 중)

VM 이 준비되면 main 에서 아래를 넘깁니다.

- `supabase/docker` 구성 + `.env`(키는 새로 생성)
- 백업 4종(스키마·데이터·auth·이미지) — **암호 zip 으로 전달**
- Cloudflare Tunnel 설정(공인 IP·포트포워딩 불필요)

⚠️ 백업에는 고객 네이버 계정·로그인 해시가 들어 있어 평문 전달은 안 합니다.

---

## 회신 부탁드릴 것

1. 위 0번 명령 결과(CPU·RAM·디스크·Windows 버전)
2. Hyper-V 사용 가능 여부
3. 이 PC 를 DB 전용으로 쓸 수 있는지(스캔 워커와 겸용해도 되는지)

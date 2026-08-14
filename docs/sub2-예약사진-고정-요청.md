# 📮 main → SUB2 : 예약 발행건에 사진 고정(스냅샷) 요청

## 1. 지금 증상

사진을 바꿔 저장하면 **아직 발행 안 된 예약건이 전부 새 사진으로 나갑니다.** 먼저 걸어둔 예약까지 소급됩니다.

```
8/14  사진A 저장 → 8/16 예약 5건
8/15  사진B 저장 → 8/18 예약 5건
      ↓
8/16 발행분 → 사진B   ← 사진A 로 나가야 함
8/18 발행분 → 사진B
```

## 2. 원인 (main 쪽 구조 · 확인 완료)

예약 행 `cafe_gen_requests` 에 들어가는 값은 이게 전부입니다.

```
company · client_id · region · keyword · popular_verified · scheduled_at · status
```

**사진이 없습니다.** 그래서 SUB2 가 처리 시점에 `cafe_studio_settings` 를 읽을 수밖에 없고,
그 테이블은 `client_id` 당 1행이라 저장하면 이전 값이 덮어써집니다. 예약별로 보관될 자리가 없습니다.

## 3. main 이 하는 것

**(a) 컬럼 추가** — `docs/cafe-gen-photo-snapshot.sql` (nullable 3개)

```sql
alter table public.cafe_gen_requests add column if not exists photos      jsonb;
alter table public.cafe_gen_requests add column if not exists banners     jsonb;
alter table public.cafe_gen_requests add column if not exists main_banner jsonb;
```

**(b) 예약을 걸 때 그 시점의 사진 경로를 이 컬럼에 박아 넣습니다.**

값 형식은 **`cafe_studio_settings` 의 같은 이름 컬럼과 100% 동일**합니다. R2 저장 경로 배열입니다.

```json
["studio-settings/6a07bb76-0350-4147-8a3f-a333413a7889/photos_0_msr5vrxr-dpnze8.jpg",
 "studio-settings/6a07bb76-0350-4147-8a3f-a333413a7889/photos_1_msr5vsne-4w9q2v.jpg"]
```

조회 URL 도 지금 쓰시는 것과 같습니다.

```
/api/img/cafe-images/<path>
```

즉 **형식·조회 방법은 하나도 안 바뀝니다. 읽는 위치만 바뀝니다.**

## 4. SUB2 가 해야 할 것 — 규칙 1줄

```python
photos      = row["photos"]      if row.get("photos")      is not None else settings.get("photos")
banners     = row["banners"]     if row.get("banners")     is not None else settings.get("banners")
main_banner = row["main_banner"] if row.get("main_banner") is not None else settings.get("main_banner")
```

판정은 **`is not None`** 입니다. truthy 검사(`if row["photos"]:`)로 하면 안 됩니다.

| 값 | 의미 | 동작 |
|---|---|---|
| `NULL` | 스냅샷 없음 | 기존대로 `cafe_studio_settings` 사용 |
| `[]` | 사진 없이 발행하려는 의도 | **설정으로 폴백 금지** — 사진 없이 발행 |
| `[...]` | 예약 시점 사진 | 그대로 사용 |

## 5. 이번 변경 대상이 아닌 것

아래는 **지금처럼 계속 `cafe_studio_settings` 에서 읽으시면 됩니다.** 손대지 않습니다.

```
naver_id · naver_pw · board_url · board_name · kakao_url
daily_cap · publish_gap_min · brand · business · homepage
```

## 6. 왜 안전한가

- **컬럼이 전부 nullable** — SUB2 가 아직 안 고쳐도 동작이 지금과 100% 동일합니다. 배포 순서를 안 맞춰도 사고가 안 납니다
- **R2 파일은 덮어써지지 않습니다** — 업로드마다 고유 파일명(`photos_0_<stamp>.jpg`)을 씁니다. 예약 시점에 박아둔 경로는 몇 주 뒤에도 그대로 유효합니다
- 옛 예약건(컬럼 추가 전에 걸린 것)은 `NULL` 이라 자동으로 기존 동작을 탑니다

## 7. 배포 순서

| 순서 | 주체 | 내용 | 그 사이 동작 |
|---|---|---|---|
| 1 | main | SQL 실행(컬럼 추가) | 변화 없음 |
| 2 | main | 예약 시 스냅샷 저장 시작 | 값은 쌓이지만 SUB2 가 안 읽음 = 지금과 동일 |
| 3 | SUB2 | 4번 규칙 반영 | 예약별 사진 적용 시작 |

**2와 3 사이에 시차가 있어도 무해합니다.** 서로 기다릴 필요 없습니다.

## 8. 검증 (SUB2 반영 후)

1. 사진 A 저장 → 10분 뒤로 예약 1건
2. 사진 B 로 바꿔 저장 → 20분 뒤로 예약 1건
3. **첫 건은 A, 둘째 건은 B 로 나가면 성공** (지금은 둘 다 B)
4. 컬럼 추가 전에 걸어둔 옛 예약건이 남아 있으면, 그건 설정 사진으로 정상 발행되는지 같이 확인

DB 로 바로 확인하실 수도 있습니다.

```sql
select keyword, scheduled_at, photos
  from cafe_gen_requests
 where client_id = '<client_id>' and status = 'pending'
 order by scheduled_at;
```

## 9. 회신 부탁드릴 것

- 4번 규칙으로 반영 가능한지 / 예상 소요
- `[]`(사진 없음) 케이스를 SUB2 가 지금 어떻게 처리하는지 — 사진 0장으로 원고가 정상 생성되는지

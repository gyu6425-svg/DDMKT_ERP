# -*- coding: utf-8 -*-
"""구글시트 → 누수탐지 ERP 이관 SQL 생성."""
import csv, re, io, sys

S = '/private/tmp/claude-501/-Users-jang-gyujin-Marketing-ERP-Dashboard/e7611c43-7ea3-4c2c-bfcb-38b1a2ab2077/scratchpad'
YEAR = 2026
MARK = '[시트이관]'

def q(v):
    if v is None or v == '':
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"

def money(v):
    if not v:
        return 0
    s = re.sub(r'[^\d\-]', '', str(v))
    return int(s) if s and s not in ('-',) else 0

def md(v):
    """'05-12' → '2026-05-12'. 이미 ISO면 그대로."""
    v = (v or '').strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
        return v
    m = re.fullmatch(r'(\d{1,2})-(\d{1,2})', v)
    return f'{YEAR}-{int(m.group(1)):02d}-{int(m.group(2)):02d}' if m else None

def phone_norm(v):
    return re.sub(r'\D', '', v or '')

# 시도 추론 — 확신할 수 있는 것만. 애매하면 None(사용자가 UI에서 지정).
SEOUL = ['가양', '강서구', '오류동', '사당동', '강동구', '암사', '양천구', '마포구', '구로', '고척']
GG    = ['과천', '동탄', '화성시', '부천', '남양주', '미사강변', '덕양구', '화정동', '권선구', '가평',
         '의정부', '용인시', '기흥', '수원', '광교']
IC    = ['을왕동', '청라', '영종도', '인천', '검암', '비응']
def sido_of(region):
    r = region or ''
    if any(k in r for k in IC):    return '인천'
    if any(k in r for k in SEOUL): return '서울'
    if any(k in r for k in GG):    return '경기'
    return None

out = io.StringIO()
w = out.write

w(f"""-- 누수탐지 ERP — 구글시트 실데이터 이관 (생성일 2026-08-06)
--   원본: 든든한누수탐지 구글시트 (상담DB 48건 / 작업 11건 / 통장원장 / 외주발주 66건)
--   ⚠️ docs/leak-erp.sql · docs/leak-erp-region.sql 를 먼저 실행한 뒤 이 파일을 실행할 것.
--
--   [재실행 안전] 모든 이관 행의 note 에 '{MARK}' 마커를 넣고, 시작 시 그 마커가 붙은 행만 지운다.
--     → 이 파일을 다시 실행해도 중복이 쌓이지 않는다. 단, 이관된 행을 UI 에서 수정하며
--        note 의 마커를 지웠다면 그 행은 삭제 대상에서 빠지므로 중복될 수 있다.
--
--   [이관 규칙 — docs/누수탐지-ERP-설계.md 검증 결과 반영]
--     · 날짜: 시트의 'MM-DD' 는 연도가 없다 → 통장원장 대조로 확인된 {YEAR}년으로 확정.
--     · 금액: '100,000원' 문자열 → 정수.
--     · 정산액: 재계산하지 않고 시트 값 그대로 저장. 규칙(30/70) 이탈 건은
--       is_rule_exception=true + exception_reason 에 근거를 남긴다.
--     · 지역: 시트의 '지역' 한 칸에 지역명과 현장명이 섞여 있어 자동 분리하지 않았다.
--       원문을 region 에 그대로 넣고, 시도(서울/경기/인천)만 확실한 것에 한해 채웠다.
--       → 필요하면 UI 에서 '시/구/동'과 '현장'으로 나누면 된다.
--     · 순서 열은 이관하지 않는다(중복·불일치로 식별자 역할 불가).

begin;

delete from public.leak_ledger      where memo like '%{MARK}%';
delete from public.leak_jobs        where note like '%{MARK}%';
delete from public.leak_inquiries   where note like '%{MARK}%';
delete from public.leak_outsourcing where note like '%{MARK}%';

""")

# ── ① 상담 48건 ────────────────────────────────────────────────────────────
rows = list(csv.reader(open(f'{S}/g1798011727.csv', encoding='utf-8')))[4:52]
w("-- ── 상담/문의 48건 ──────────────────────────────────────────────────────\n")
w("insert into public.leak_inquiries (counselor, sido, region, phone, phone_norm, inquired_on, leak_type, contracted, note) values\n")
vals = []
for r in rows:
    counselor = (r[2] or '').strip()
    region = (r[3] or '').strip()
    phone = (r[4] or '').strip()
    day = md(r[5])
    kind = (r[6] or '').strip()
    done = (r[7] or '').strip() == '진행'
    note = MARK
    # 지역 칸에 상담자명이 잘못 들어간 행(원본 오류) — 지역을 비우고 근거를 남긴다.
    if region and region == counselor:
        note = f'{MARK} 원본 지역칸에 상담자명이 입력돼 있어 비움'
        region = ''
    sido = sido_of(region)
    vals.append(f"  ({q(counselor)}, {q(sido)}, {q(region)}, {q(phone)}, {q(phone_norm(phone))}, "
                f"{q(day)}, {q(kind)}, {str(done).lower()}, {q(note)})")
w(',\n'.join(vals) + ';\n\n')

# ── ② 작업 11건 ────────────────────────────────────────────────────────────
sheet = list(csv.reader(open(f'{S}/sheet0.csv', encoding='utf-8')))
jobs = [r for r in sheet[7:18] if len(r) > 11 and (r[2] or '').strip()]
w("-- ── 작업 · 정산 11건 ────────────────────────────────────────────────────\n")
w("--   inquiry_id 는 연락처로 연결(시트에서 유일하게 검증된 조인 키 · 11/11 매칭 확인됨).\n")
for r in jobs:
    site = (r[2] or '').strip()
    phone = (r[3] or '').strip()
    worked = md(r[4])
    gross = money(r[5])
    vendor = (r[6] or '').strip()
    memo = (r[7] or '').strip()          # 헤더는 '업체 연락처'지만 실제로는 비고 텍스트
    our = money(r[8])
    partner = money(r[9])
    settled = md(r[10])
    invoice = (r[11] or '').strip() or '미발행'

    # ⚠️ 공제액은 시트에 '금액 칸'이 없고 비고 텍스트로만 있다. 여기서 숫자를 추출해 넣으면
    #    시트에 없던 공제액을 만들어내는 셈이라 원본 계산(결제 vs 든든+백준)과 어긋난다.
    #    → deduction_amount 는 0으로 두고 비고 원문만 보존한다. 실제 공제 규칙 확정 후 UI 에서 입력.
    ded, ded_note = 0, memo
    base = gross - ded
    rate = round(our / base * 100, 2) if base else None
    mismatch = (our + partner) - base
    off = mismatch != 0 or (rate is not None and abs(rate - 30) > 0.01)
    reasons = []
    if memo:
        reasons.append(memo)
    if mismatch:
        reasons.append(f'시트 합계 불일치 {mismatch:+,}원(원본 값 그대로 이관)')
    if rate is not None and abs(rate - 30) > 0.01:
        reasons.append(f'적용요율 {rate}% (정의 30%와 다름)')
    reason = ' · '.join(reasons) if reasons else None

    w("insert into public.leak_jobs (inquiry_id, site_name, sido, region, phone, phone_norm, worked_on, "
      "gross_amount, vendor, deduction_amount, deduction_note, base_amount, applied_rate, our_share, "
      "partner_share, is_rule_exception, exception_reason, settled_on, invoice_status, note) values (\n")
    w(f"  (select id from public.leak_inquiries where phone_norm = {q(phone_norm(phone))} and contracted "
      f"order by inquired_on desc limit 1),\n")
    w(f"  null, {q(sido_of(site))}, {q(site)}, {q(phone)}, {q(phone_norm(phone))}, {q(worked)},\n")
    w(f"  {gross}, {q(vendor)}, {ded}, {q(ded_note or None)}, {base}, "
      f"{rate if rate is not None else 'null'}, {our}, {partner},\n")
    w(f"  {str(off).lower()}, {q(reason)}, {q(settled)}, {q(invoice)}, {q(MARK)});\n")
w('\n')

# ── ③ 통장 원장 ────────────────────────────────────────────────────────────
w("-- ── 통장 원장 ───────────────────────────────────────────────────────────\n")
w("--   잔액 열은 이관하지 않는다 — 앱이 입출금으로 매번 누적 계산한다.\n")
w("--   (시트의 월합계 잔고는 손입력이라 4월·8월에 오류가 있었다.)\n")
led = []
for r in sheet:
    if len(r) < 18:
        continue
    d = (r[13] or '').strip()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', d):
        continue          # '시작일' · 'N월 총 금액' 등 제외
    inflow, outflow = money(r[14]), money(r[15])
    if not inflow and not outflow:
        continue          # 미래 일자 등 빈 행 제외
    memo = (r[17] or '').strip()
    kind = None
    if outflow:
        if '부가세' in memo or '세금' in memo:      kind = '세금'
        elif '정산' in memo and ('재현' in memo or '민경' in memo): kind = '급여'
        elif '대표' in memo:                        kind = '대표인출'
        else:                                       kind = '외주비'
    # 작업 정산 입금과 대응되지 않는 건은 미확인으로 표시(05-12 50,000 · 06-20 575).
    unrec = 'true' if (inflow and inflow in (50000, 575)) else 'false'
    memo_full = f'{memo} {MARK}'.strip() if memo else MARK
    led.append(f"  ({q(d)}, {inflow}, {outflow}, {q(kind)}, {q(memo_full)}, {unrec})")
w("insert into public.leak_ledger (entry_date, inflow, outflow, outflow_kind, memo, unreconciled) values\n")
w(',\n'.join(led) + ';\n\n')

# ── ④ 외주 발주 ────────────────────────────────────────────────────────────
# 품목명이 비어도 금액이 있으면 실데이터다(환불 1건이 이 형태) → 금액 기준으로도 포함.
orows = [r for r in list(csv.reader(open(f'{S}/g70199481.csv', encoding='utf-8')))[3:]
         if len(r) > 11 and ((r[2] or '').strip() or money(r[7]) or money(r[8]))]
w("-- ── 외주 발주 ───────────────────────────────────────────────────────────\n")
w("insert into public.leak_outsourcing (item_name, marketing_type, vendor, started_on, ended_on, "
  "amount, amount_vat, entry_kind, settled_to_vendor, settled_final, note) values\n")
ovals = []
for r in orows:
    amt = money(r[7])
    vat = money(r[8])
    kind = 'refund' if (amt < 0 or vat < 0) else 'order'
    note = (r[11] or '').strip()
    item = (r[2] or '').strip() or '(품목명 없음)'   # 원본에 품목명이 비어 있던 행
    ovals.append(
        f"  ({q(item)}, {q((r[3] or '').strip())}, {q((r[4] or '').strip())}, "
        f"{q(md(r[5]))}, {q(md(r[6]))}, {amt}, {vat}, {q(kind)}, "
        f"{str((r[9] or '').strip() == '정산완료').lower()}, {str((r[10] or '').strip() == '정산완료').lower()}, "
        f"{q((note + ' ' + MARK).strip())})")
w(',\n'.join(ovals) + ';\n\n')

w("""commit;

-- ── 이관 검증 ────────────────────────────────────────────────────────────
--   기대값: 상담 48 / 성사 11 / 작업 11 / 상담연결 11 / 결제 11,870,000 /
--           든든 2,507,400 / 백준 7,789,000 / 원장 입금 2,557,975 · 출금 5,557,975 / 외주 67
select
  (select count(*) from public.leak_inquiries)                            as 상담,
  (select count(*) from public.leak_inquiries where contracted)           as 성사,
  (select count(*) from public.leak_jobs)                                 as 작업,
  (select count(*) from public.leak_jobs where inquiry_id is not null)    as 상담연결,
  (select count(*) from public.leak_jobs where is_rule_exception)         as 정산예외,
  (select sum(gross_amount)  from public.leak_jobs)                       as 결제합계,
  (select sum(our_share)     from public.leak_jobs)                       as 든든합계,
  (select sum(partner_share) from public.leak_jobs)                       as 백준합계,
  (select sum(inflow)  from public.leak_ledger)                           as 원장입금,
  (select sum(outflow) from public.leak_ledger)                           as 원장출금,
  (select count(*) from public.leak_outsourcing)                          as 외주;

-- 롤백(이관분만 제거):
-- begin;
""")
w(f"-- delete from public.leak_ledger where memo like '%{MARK}%';\n")
w(f"-- delete from public.leak_jobs where note like '%{MARK}%';\n")
w(f"-- delete from public.leak_inquiries where note like '%{MARK}%';\n")
w(f"-- delete from public.leak_outsourcing where note like '%{MARK}%';\n-- commit;\n")

sql = out.getvalue()
open('/Users/jang-gyujin/Marketing ERP Dashboard/docs/leak-erp-seed.sql', 'w', encoding='utf-8').write(sql)
print('상담', len(rows), '· 작업', len(jobs), '· 원장', len(led), '· 외주', len(ovals))
print('bytes', len(sql))

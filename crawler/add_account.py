"""업체(blog_accounts) 터미널 등록 — 웹 '시트 붙여넣기 등록'과 같은 일을 CLI로.

사용법(둘 중 편한 것):
  1) 파일에서:   python add_account.py companies.txt
  2) 붙여넣기:   python add_account.py        ← 실행 후 시트 행을 붙여넣고 Ctrl+Z, Enter (윈도우)

한 줄 = 업체 하나. 칸 순서(탭 또는 / 구분, 빈 칸은 비워도 됨):
  업체명 / 계약일자 / 계약건수 / 잔여건수 / 총발행건수 / 발행URL / 기자단
  · 발행URL(blog.naver.com…)만 있어도 등록됨(업체명은 블로그ID로 대체).
  · 계약일자는 '7월 15일'처럼 월·일만 적으면 연도 자동(미래월=작년, 아니면 올해).
등록 = is_active=true(활성). 이미 있는 URL/업체명은 건너뜀. service_role 키로 직접 기록(.env).
"""
import os
import re
import sys
import truststore
truststore.inject_into_ssl()  # 윈도 백신 TLS 인터셉션 대응(없으면 SSL 검증 실패)
import requests
from dotenv import load_dotenv

load_dotenv()
URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not URL or not KEY:
    sys.exit(".env 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.")
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}


def extract_blog_id(url):
    m = re.search(r"blog\.naver\.com/([^/?#]+)", url or "", re.I)
    return m.group(1) if m else ""


def split_fields(line):
    """탭이 있으면 탭, 없으면 / 로 분리. URL/날짜 속 내부 / 는 보호 후 분리."""
    if "\t" in line:
        return [c.strip() for c in line.split("\t")]
    prot = []

    def mark(m):
        prot.append(m.group(0))
        return "%d" % (len(prot) - 1)

    s = re.sub(r"(?:https?://)?[\w.-]+\.[a-z]{2,}(?:/[^\s]*)?", mark, line, flags=re.I)
    s = re.sub(r"\d{1,4}/\d{1,2}/\d{1,4}", mark, s)
    return [re.sub(r"(\d+)", lambda x: prot[int(x.group(1))], c).strip()
            for c in s.split("/")]


def to_num(v):
    m = re.search(r"\d+", v or "")
    return int(m.group(0)) if m else None


def parse_contract_date(v):
    s = (v or "").strip()
    if not s:
        return None
    if re.search(r"\d{4}", s):
        return s
    m = re.search(r"(\d{1,2})\s*[월./-]\s*(\d{1,2})", s)
    if not m:
        return s
    month, day = int(m.group(1)), int(m.group(2))
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return s
    # 연도 자동(현재 월보다 크면 작년) — 인자로 안 넘기면 환경상 현재월 사용
    import datetime
    now = datetime.date.today()
    year = now.year - 1 if month > now.month else now.year
    return "%04d-%02d-%02d" % (year, month, day)


def main():
    raw = open(sys.argv[1], encoding="utf-8").read() if len(sys.argv) > 1 else sys.stdin.read()
    # 기존 업체(중복 방지)
    existing = requests.get(URL + "/rest/v1/blog_accounts", headers=H,
                            params={"select": "name,blog_url"}).json()
    urls = {a["blog_url"] for a in existing}
    names = {a["name"] for a in existing}

    payloads, skip_dup, skip_no_url = [], 0, 0
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        f = split_fields(line)
        if len(f) > 1 and re.fullmatch(r"\d+", f[0] or ""):
            f = f[1:]  # 맨 앞 행번호 제거
        url = next((c for c in f if "blog.naver.com" in c), "")
        if not url:
            skip_no_url += 1
            continue
        name = f[0] if (f and "http" not in f[0] and "blog.naver.com" not in f[0]) else (extract_blog_id(url) or "블로그")
        if url in urls or name in names or any(p["blog_url"] == url for p in payloads):
            skip_dup += 1
            continue
        payloads.append({
            "name": name,
            "blog_url": url,
            "blog_id": extract_blog_id(url),
            "contract_date": parse_contract_date(f[1]) if len(f) > 1 else None,
            "goal_count": to_num(f[2]) if len(f) > 2 else None,
            "remain_count": to_num(f[3]) if len(f) > 3 else None,
            "weekly": (f[4] or None) if len(f) > 4 else None,
            "reporter": (f[6] or None) if len(f) > 6 else None,
            "is_active": True,
        })

    if not payloads:
        print("등록할 항목 없음 (이미등록 %d · URL없음 %d)" % (skip_dup, skip_no_url))
        return
    r = requests.post(URL + "/rest/v1/blog_accounts", headers={**H, "Prefer": "return=representation"},
                      json=payloads)
    if not r.ok:
        sys.exit("등록 실패 %d: %s" % (r.status_code, r.text[:300]))
    print("✅ %d개 등록 완료 (건너뜀: 이미등록 %d · URL없음 %d)" % (len(payloads), skip_dup, skip_no_url))
    for a in r.json():
        print("   -", a.get("name"), "|", a.get("blog_url"))
    print("\n담당자·금액·연락처 등은 웹 '편집'에서 채우면 됩니다. 8시 자동측정에 자동 포함됩니다.")


if __name__ == "__main__":
    main()

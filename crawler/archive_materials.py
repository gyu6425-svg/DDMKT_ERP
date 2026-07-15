# 블로그 자료 로컬 아카이브 — 클라우드(Supabase)엔 블로그별 최신 N건만 유지, 초과분은 PC로 내려받고 클라우드에서 삭제.
#   무료 티어(저장 1GB) 유지 목적. PC가 켜져 있을 때 실행(크롤 데몬과 함께 돌리거나 주기 실행).
#   실행: python archive_materials.py   (KEEP=5 기본, 인자로 조절 가능)
import sys, os, re, json, pathlib, datetime, requests
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
try:
    import truststore; truststore.inject_into_ssl()
except Exception:
    pass
requests.packages.urllib3.disable_warnings()

KEEP = int(sys.argv[1]) if len(sys.argv) > 1 else 5          # 클라우드에 남길 최신 자료 수(블로그별)
ARCHIVE_ROOT = pathlib.Path("C:/Users/ddmkt/DDMKT_자료보관")   # 로컬 보관 폴더
BUCKET = "blog-materials"

HERE = os.path.dirname(os.path.abspath(__file__))
env = pathlib.Path(os.path.join(HERE, ".env")).read_text(encoding="utf-8", errors="ignore")
def ev(k):
    m = re.search(rf'^{k}\s*=\s*"?([^"\n\r]+)"?', env, re.M)
    return m.group(1).strip() if m else None
URL, KEY = ev("SUPABASE_URL"), ev("SUPABASE_SERVICE_KEY")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}

def safe(s):
    return re.sub(r'[<>:"/\\|?*]+', "_", (s or "")).strip() or "무제"

def rest_get(path):
    r = requests.get(f"{URL}/rest/v1/{path}", headers=H, timeout=60, verify=False)
    r.raise_for_status(); return r.json()

def storage_download(obj_path):
    r = requests.get(f"{URL}/storage/v1/object/{BUCKET}/{obj_path}", headers=H, timeout=120, verify=False)
    return r.content if r.ok else None

def storage_remove(obj_path):
    return requests.delete(f"{URL}/storage/v1/object/{BUCKET}/{obj_path}", headers=H, timeout=60, verify=False).ok

def row_delete(mid):
    return requests.delete(f"{URL}/rest/v1/blog_materials?id=eq.{mid}", headers=H, timeout=60, verify=False).ok

# 1) 전체 자료 조회 → 블로그별 그룹
rows = rest_get("blog_materials?select=id,blog_account_id,company_name,round,category,main_keyword,sub_keywords,photos,created_at&order=created_at.desc")
by_blog = {}
for r in rows:
    by_blog.setdefault(r["blog_account_id"], []).append(r)

archived = 0
for blog_id, mats in by_blog.items():
    mats.sort(key=lambda m: m.get("created_at") or "", reverse=True)  # 최신순
    old = mats[KEEP:]  # 최신 KEEP건 제외 = 아카이브 대상
    for m in old:
        company = safe(m.get("company_name") or blog_id[:8])
        dest = ARCHIVE_ROOT / company / f'{(m.get("created_at") or "")[:10]}_{m["id"][:8]}'
        dest.mkdir(parents=True, exist_ok=True)
        ok_all = True
        for i, p in enumerate(m.get("photos") or []):
            data = storage_download(p["path"])
            if data is None:
                ok_all = False; print(f"  ! 다운로드 실패 {p['path']}"); continue
            (dest / safe(p.get("name") or f"photo_{i}.jpg")).write_bytes(data)
        # 메타 저장
        (dest / "meta.json").write_text(json.dumps({
            "category": m.get("category"), "round": m.get("round"),
            "main_keyword": m.get("main_keyword"), "sub_keywords": m.get("sub_keywords"),
            "company_name": m.get("company_name"), "created_at": m.get("created_at"),
        }, ensure_ascii=False, indent=1), encoding="utf-8")
        if not ok_all:
            print(f"  · 일부 사진 실패 → 클라우드 삭제 보류: {m['id']}"); continue
        # 클라우드 정리(사진 → 행)
        for p in (m.get("photos") or []):
            storage_remove(p["path"])
        if row_delete(m["id"]):
            archived += 1
            print(f"  ✓ 아카이브: {company} · {m.get('main_keyword')} → {dest}")

print(f"=== 완료: {archived}건 로컬 아카이브(블로그별 최신 {KEEP}건 클라우드 유지) · {datetime.datetime.now():%Y-%m-%d %H:%M} ===")

# -*- coding: utf-8 -*-
"""카페 댓글 고정 템플릿 풀 (파이썬판 — 워처가 자동 댓글 생성용).
   src/lib/cafeCommentTemplates.ts 와 동일 로직. {지역}/{키워드} 치환 + 오프너/클로저 조합으로 매번 다르게.
   (웹 수동 입력은 TS판, 자동 크롤링은 이 파이썬판 — 두 경로 모두 sub 전용)."""
import random
import re

OPENERS = ['', '', '오, ', '와, ', '우와 ', '오호, ', '아, ', '헐 ']

# 사장님 제공 원본 5개 기준(모두 '{지역} {키워드}' 포함) + 동일 스타일 변형 3개.
#   ★모든 템플릿에 지역+키워드가 반드시 들어감(예: 안양 누수탐지).
TEMPLATES = [
    '{지역} {키워드}의 좋은 후기 잘 보고갑니다.',
    '{지역} {키워드} 알아보려고 하다가 보니까 큰 도움되는 정보였어요.',
    '아래층 젖으면 진짜 멘붕인데 원인 깔끔하게 잡아주나 봐요. {지역} {키워드}에 대한 정보 공유 감사합니다!',
    '안그래도 {지역} 이사와서 {키워드} 알아보고 있었는데! 기억하고 있다가 꼭 써먹어야겠어요.',
    '필요한 정보였는데 {지역} {키워드}에 대해서 깔끔하게 정리해주셔서 잘 읽었습니다. 감사합니다!',
    '이런 정보 찾고 있었는데 잘 보고 갑니다. {지역} {키워드} 참고할게요!',
    '{지역} {키워드} 후기 잘 봤습니다. 깔끔하게 잘 해주시나 봐요!',
    '정리 깔끔하게 잘 해주셨네요. {지역} {키워드} 필요하면 참고하겠습니다.',
]

# 더맨시스템(시설경비·경호) 전용 — 사장님 지정 스타일:
#   "~~지역에서 믿고 맡길 건물보안업체를 찾고있었는데 정보 감사합니다"
#   → '{지역}에서 ~업체를 찾던 중이었다 + 감사' 구조. 누수 쪽의 '{지역} {키워드}' 나열형과 다르다.
#   ⚠️ 지역은 '서초 회사' 가 아니라 '서초' 여야 한다("서초 회사에서 믿고 맡길…" 은 어색).
#      → region_from_title 이 업종어(회사/사무실…)를 걷어낸다.
#   ⚠️ 업종어('보안')는 모든 문구에 들어간다 — 지역+키워드가 항상 붙어야 한다는 원칙 유지.
TEMPLATES_SECURITY = [
    '{지역}에서 믿고 맡길 건물보안업체를 찾고있었는데 정보 감사합니다',
    '{지역}에서 건물보안업체 알아보고 있었는데 도움 많이 됐습니다',
    '{지역} 쪽에 믿을만한 보안업체 찾고 있었는데 좋은 정보 감사합니다',
    '{지역}에서 사무실 보안 맡길 데를 찾고 있었는데 참고하겠습니다',
    '{지역} 건물보안업체 후기가 별로 없었는데 깔끔하게 정리해주셔서 잘 읽었습니다',
    '{지역}에서 보안업체 알아보는 중이었는데 잘 보고 갑니다',
    '{지역} 쪽 건물보안업체 정보 찾고 있었는데 딱 필요한 내용이었어요',
    '{지역}에서 건물보안 맡길 곳 고민이었는데 도움 많이 됐습니다 감사합니다',
]

# 소방(소방시설·소방점검) 전용 — '지역+키워드' 를 항상 붙여 쓰는 누수 스타일.
#   ⚠️ 임시 문구다(사장님 확정 원본 없음). 확정 문구 받으면 교체.
TEMPLATES_FIRE = [
    '{지역} 소방점검의 좋은 후기 잘 보고갑니다.',
    '{지역} 소방점검 알아보려고 하다가 보니까 큰 도움되는 정보였어요.',
    '{지역} 소방업체 후기 잘 봤습니다. 꼼꼼하게 잘 해주시나 봐요!',
    '안그래도 {지역} 소방점검 알아보고 있었는데! 기억하고 있다가 꼭 써먹어야겠어요.',
    '필요한 정보였는데 {지역} 소방점검에 대해서 깔끔하게 정리해주셔서 잘 읽었습니다. 감사합니다!',
    '이런 정보 찾고 있었는데 잘 보고 갑니다. {지역} 소방시설 점검 참고할게요!',
    '{지역} 소방점검 후기가 별로 없었는데 깔끔하게 정리해주셔서 잘 읽었습니다.',
    '정리 깔끔하게 잘 해주셨네요. {지역} 소방점검 필요하면 참고하겠습니다.',
]

# 입주청소(더티클리닉) 전용 — '지역+키워드' 를 항상 붙여 쓰는 누수 스타일.
#   ⚠️ 임시 문구다(사장님 확정 원본 받으면 교체). 브랜드는 더티클리닉, 서비스어는 입주청소.
TEMPLATES_CLEANING = [
    '{지역} 입주청소의 좋은 후기 잘 보고갑니다.',
    '{지역} 입주청소 알아보려고 하다가 보니까 큰 도움되는 정보였어요.',
    '이사철에 청소가 제일 골치인데 꼼꼼하게 해주시나 봐요. {지역} 입주청소에 대한 정보 공유 감사합니다!',
    '안그래도 {지역} 입주청소 알아보고 있었는데! 기억하고 있다가 꼭 써먹어야겠어요.',
    '필요한 정보였는데 {지역} 입주청소에 대해서 깔끔하게 정리해주셔서 잘 읽었습니다. 감사합니다!',
    '이런 정보 찾고 있었는데 잘 보고 갑니다. {지역} 입주청소 참고할게요!',
    '{지역} 입주청소 후기 잘 봤습니다. 꼼꼼하게 잘 해주시나 봐요!',
    '정리 깔끔하게 잘 해주셨네요. {지역} 입주청소 필요하면 참고하겠습니다.',
]

# 업종(키워드) → 문구 풀. 감시행의 keyword 로 고른다.
#   여기에 없는 키워드는 기본(누수) 풀 대신 '업종 무관' 문구만 쓰는 게 아니라,
#   아예 등록을 요구한다(엉뚱한 업종 문구가 나가는 것보다 안 다는 게 낫다).
POOLS = {
    '누수탐지': TEMPLATES,
    '보안': TEMPLATES_SECURITY,
    '소방': TEMPLATES_FIRE,
    '입주청소': TEMPLATES_CLEANING,
}

# 게시판 '전체 잡기'용 업종 자동판별 — 제목/댓글 문구에 이 말들이 있으면 그 업종으로 본다.
#   발행 제목 형식이 바뀌어도('누수탐지'→'천장 누수') 업종을 놓치지 않게 넓게 잡는다.
#   순서 = 우선순위(먼저 매칭되는 업종). 두 업종 말이 겹치는 경우는 없다.
BUSINESS_TERMS = [
    ('입주청소', ('입주청소', '이사청소', '준공청소', '더티클리닉', '청소')),
    ('소방',     ('소방', '소방점검', '소방시설', '소화기', '화재', '피난')),
    ('보안',     ('보안', '경비', '경호', '출입', '시설경비', 'cctv', 'CCTV', '건물관리')),
    ('누수탐지', ('누수탐지', '천장 누수', '누수', '물샘', '누수감지', '방수', '결로')),
]
# 어느 업종에도 안 걸리는 글: 예전엔 누수로 기본 처리했다가 '소방업체' 글에
#   '누수탐지' 댓글이 달리는 사고가 났다(2026-07-21). 이제 기본으로 우기지 않고
#   호출부에서 '건너뛰고 경고' 한다 → 새 업종은 템플릿 추가 후 다시 잡는다.
DEFAULT_BUSINESS = None


def classify_business(text):
    """제목이나 댓글 문구를 보고 업종 키워드('누수탐지'/'보안')를 고른다.
    아무 것도 안 걸리면 None(호출부가 기본값/스킵을 정한다)."""
    t = (text or '')
    for kw, terms in BUSINESS_TERMS:
        if any(term in t for term in terms):
            return kw
    return None

CLOSERS = ['', '', ' 감사합니다!', ' 좋은 정보 감사해요.', ' 도움 많이 됐어요!']


# 키워드 앞에 붙지만 지역이 아닌 말 — '서초 회사 보안' 의 '회사' 같은 것.
#   안 걸러내면 "서초 회사에서 믿고 맡길 건물보안업체를…" 처럼 어색해진다.
#   (reply_templates 도 이걸 가져다 쓴다 — 규칙이 갈리면 댓글/답글 지역이 달라진다)
GENERIC_HEAD = {"회사", "사무실", "빌딩", "건물", "공장", "상가", "매장", "점포",
                "아파트", "빌라", "오피스텔", "주택", "원룸", "우리", "저희", "그", "이", "저",
                "더티클리닉"}   # 브랜드명이 지역+키워드 사이에 끼면 지역으로 오인 → 걸러냄


def _lead_region(title):
    """제목 맨 앞의 지역 토큰. '광진 천장 누수 …' → '광진', '안산 단원구 …' → '안산 단원구'."""
    toks = [t for t in (title or "").strip(" \t[]【】「」<>()-–—·,.…‘’\"'").split() if t]
    toks = [t for t in toks if not t.startswith("[")]     # [테스트] 같은 머리 태그 제거
    if not toks:
        return ""
    cand = toks[0]
    # 둘째 토큰이 행정구역 접미사(구/시/군/읍/면/동)면 '안산 단원구' 처럼 붙인다
    if len(toks) >= 2 and toks[1] and toks[1][-1] in "구시군읍면동":
        cand = toks[0] + " " + toks[1]
    cand = cand.strip(" ,.·")
    if 2 <= len(cand) <= 12 and all(("가" <= c <= "힣") or c == " " for c in cand):
        return cand
    return ""


def region_from_title(title, keyword, fallback=""):
    """글 제목에서 '<지역> <키워드>' 패턴의 지역을 뽑는다.

    예) '강남 누수탐지, 누수로 골치였다면'      → '강남'
        '안산 단원구 누수탐지 직접 불러본 후기' → '안산 단원구'
        '과천 누수탐지 아파트 빌라 …'          → '과천'
    키워드가 제목에 없거나 앞부분이 지역 같지 않으면 fallback(등록 지역)을 쓴다.
    → 댓글에 항상 '그 글의 지역 + 키워드'가 들어가게 하기 위함.
    """
    if not title or not keyword:
        return fallback
    title = re.sub(r"^\s*\[[^\]]*\]\s*", "", title)   # 머리 태그 '[테스트] ' 제거
    idx = title.find(keyword)
    if idx <= 0:
        # 키워드가 제목에 없거나 맨 앞 → 제목 맨 앞의 '지역 토큰'을 쓴다.
        #   발행 제목 형식이 '광진 누수탐지 …' 에서 '광진 천장 누수 …' 로 바뀌어(키워드가
        #   제목에 없음) 지역까지 못 뽑던 문제. 지역은 어느 형식이든 항상 맨 앞에 온다.
        lead = _lead_region(title)
        return lead or fallback
    head = title[:idx].strip(" \t[]【】「」<>()-–—·,.…‘’\"'")
    toks = [t for t in head.split() if t]
    # 업종어는 지역이 아니다: '서초 회사 보안' → '서초'
    while toks and toks[-1] in GENERIC_HEAD:
        toks.pop()
    if not toks:
        return fallback
    # '안산 단원구' 같은 2단 지역 우선, 너무 길면 마지막 한 토큰만
    cand = " ".join(toks[-2:]) if len(toks) >= 2 else toks[-1]
    if len(cand) > 12:
        cand = toks[-1]
    if not (2 <= len(cand) <= 12):
        return fallback
    return cand


def _fill(tpl, region, keyword):
    out = tpl.replace('{지역}', (region or '').strip()).replace('{키워드}', (keyword or '').strip())
    return re.sub(r'\s{2,}', ' ', out).strip()


def region_from_comment(body, keyword, fallback=""):
    """'우리가 단 댓글'에서 지역을 되짚는다 — 답글 문구에 같은 지역을 쓰기 위해.

    ⚠️ 정규식으로 '<지역> <키워드>' 를 찾는 방식(reply_templates.region_from_text)은
       누수 문구('안양 누수탐지 …')엔 통하지만, 보안 문구는 지역과 키워드가 떨어져 있어
       '믿을만한 보안업체' 의 '믿을만한', '서초에서 보안' 의 '서초에서' 를 집는다.
       우리가 쓴 문장은 우리가 만든 템플릿이므로, 템플릿을 역매칭하면 추측할 필요가 없다.
    """
    pool = pool_for(keyword)
    if not pool or not body:
        return fallback
    # 오프너('오호, ', '헐 ')를 먼저 떼어낸다. {지역} 으로 시작하는 템플릿은 캡처가
    #   문장 맨 앞부터 시작해, 안 떼면 지역이 '오호, 서초' 가 된다.
    b = body.strip()
    for op in sorted((o for o in OPENERS if o), key=len, reverse=True):
        if b.startswith(op):
            b = b[len(op):].strip()
            break
    for tpl in pool:
        if '{지역}' not in tpl:
            continue
        # {지역} 자리만 캡처그룹으로 두고 나머지는 그대로 맞춘다
        pat = re.escape(_fill(tpl, '\x00', keyword)).replace(re.escape('\x00'), r'(.+?)')
        m = re.search(pat, b)
        if m:
            cand = m.group(1).strip()
            if 2 <= len(cand) <= 12:
                return cand
    return fallback


def pool_for(keyword):
    """업종별 문구 풀. 등록 안 된 키워드면 None — 호출부가 댓글을 안 달게 한다."""
    return POOLS.get((keyword or '').strip())


def build_comment(region, keyword, avoid=None):
    """랜덤 댓글 1건 — 오프너+템플릿+클로저 조합.

    avoid: 피할 문구. 문자열 하나 또는 여러 개(리스트/셋). 같은 글에 여러 계정이 달 때
      '직전 하나'만 피하면 1번째와 3번째가 같아질 수 있으므로, 그 글에 이미 쓴 문구를
      전부 넘겨 피한다. 오프너/클로저만 다른 '사실상 같은 문장'도 막으려고 템플릿(base)
      단위로도 비교한다(2026-07-21 dog6425·kkfesh 문구가 거의 같게 나간 사고 방지)."""
    pool = pool_for(keyword)
    if pool is None:
        # 업종 문구가 없는데 아무거나 쓰면 보안 글에 '아래층 젖으면…' 이 달린다.
        raise RuntimeError(f"댓글 템플릿 없음: 키워드 '{keyword}' — comment_templates.POOLS 에 추가 필요")

    if avoid is None:
        avoid_set = set()
    elif isinstance(avoid, str):
        avoid_set = {avoid.strip()}
    else:
        avoid_set = {a.strip() for a in avoid if a}
    # 피할 문구들의 '핵심 문장'(오프너/클로저 뗀 base) 집합 — 사실상 같은 문장 차단용.
    avoid_bases = {_strip_affix(a) for a in avoid_set}

    def compose():
        opener = random.choice(OPENERS)
        base = _fill(random.choice(pool), region, keyword)
        closer = random.choice(CLOSERS)
        if re.search(r'[!~]$|감사', base):
            closer = ''
        elif '도움' in closer and '도움' in base:
            closer = ''
        elif '보고' in closer and '보고' in base:
            closer = ''
        return re.sub(r'\s{2,}', ' ', (opener + base + closer)).strip()

    out = compose()
    for _ in range(12):
        # 완성문구가 겹치지 않고, 오프너/클로저 뗀 '핵심 문장'도 겹치지 않아야 통과.
        if out not in avoid_set and _strip_affix(out) not in avoid_bases:
            break
        out = compose()
    return out


def _strip_affix(text):
    """오프너/클로저를 떼어 '핵심 문장'만 남긴다 — 사실상 같은 문장 비교용."""
    t = (text or '').strip()
    for op in sorted((o for o in OPENERS if o), key=len, reverse=True):
        if t.startswith(op):
            t = t[len(op):].strip()
            break
    for cl in sorted((c for c in CLOSERS if c), key=len, reverse=True):
        if t.endswith(cl.strip()):
            t = t[:len(t) - len(cl.strip())].strip()
            break
    return t

# -*- coding: utf-8 -*-
"""카페 대댓글(답글) 템플릿 — **글 작성자가 댓글에 답하는** 톤.

⚠️ 답글 계정(rlawhddls25)은 그 글을 쓴 본인이다. 그래서 "저도 알아보던 중이었는데
   감사합니다" 같은 제3자 톤을 쓰면 자기 글에 자기가 관심 있는 척하는 꼴이라 어색하다.
   → 댓글 달아준 사람에게 **응답하는** 말투로 쓴다.

너무 딱딱한 업체 응대체("문의 감사합니다. 담당자가 안내드리겠습니다")도 피하고,
카페 글 쓴 사람이 편하게 답하는 정도로.
"""
import random
import re

# 지역/키워드가 안 들어가는 순수 응답 (대부분 이걸로 — 자연스러움 우선)
PLAIN = [
    '감사합니다~ 도움 되셨다면 다행이네요',
    '읽어주셔서 감사합니다!',
    '도움이 됐다니 다행이에요 :)',
    '네 저도 겪어보니 미리 알아두는 게 낫더라구요',
    '맞아요, 그때 진짜 당황스러웠어요 ㅎㅎ',
    '공감해주셔서 감사합니다~',
    '아랫집 연락이 제일 곤란하더라구요.. 참고되셨으면 좋겠어요',
    '별거 아닌데 봐주셔서 감사해요!',
    '궁금한 거 있으시면 편하게 물어보세요~',
    '도움 되셨다니 저도 뿌듯하네요 :)',
]

# 지역/키워드를 자연스럽게 섞는 응답 (가끔만)
WITH_REGION = [
    '{지역}쪽도 출장 되는 걸로 알고 있어요~',
    '{지역} 근처시면 참고하시면 좋을 것 같아요!',
    '{키워드}{은는} 원인 잡는 게 반이더라구요. 도움 되셨으면 좋겠어요',
    '{지역}에서도 비슷한 사례 많다고 하시더라구요~',
    '{키워드} 알아보실 때 참고되셨으면 좋겠습니다!',
]

# --- 더맨시스템(시설경비·경호) 전용 -------------------------------------------
#   누수 문구에는 '아랫집 연락', '원인 잡는 게 반' 처럼 업종에 묶인 표현이 있어 그대로 못 쓴다.
PLAIN_SECURITY = [
    '감사합니다~ 도움 되셨다면 다행이네요',
    '읽어주셔서 감사합니다!',
    '도움이 됐다니 다행이에요 :)',
    '네 저도 겪어보니 미리 챙겨두는 게 낫더라구요',
    '공감해주셔서 감사합니다~',
    '현장마다 상황이 달라서 점검이 중요하더라구요',
    '별거 아닌데 봐주셔서 감사해요!',
    '궁금한 거 있으시면 편하게 물어보세요~',
    '도움 되셨다니 저도 뿌듯하네요 :)',
    '사람 없는 시간대가 제일 걱정이죠.. 참고되셨으면 좋겠어요',
]

WITH_REGION_SECURITY = [
    '{지역}쪽도 출장 되는 걸로 알고 있어요~',
    '{지역} 근처시면 참고하시면 좋을 것 같아요!',
    '{키워드}{은는} 현장 파악이 반이더라구요. 도움 되셨으면 좋겠어요',
    '{지역}에서도 비슷한 문의 많다고 하시더라구요~',
    '{키워드} 알아보실 때 참고되셨으면 좋겠습니다!',
]

# --- 소방(소방시설·소방점검) 전용 — 보안 톤과 동일(임시, 확정 문구 받으면 교체) ------
PLAIN_FIRE = [
    '감사합니다~ 도움 되셨다면 다행이네요',
    '읽어주셔서 감사합니다!',
    '도움이 됐다니 다행이에요 :)',
    '네 저도 겪어보니 미리 챙겨두는 게 낫더라구요',
    '공감해주셔서 감사합니다~',
    '현장마다 상황이 달라서 점검이 중요하더라구요',
    '별거 아닌데 봐주셔서 감사해요!',
    '궁금한 거 있으시면 편하게 물어보세요~',
    '도움 되셨다니 저도 뿌듯하네요 :)',
    '미리 점검해두면 마음이 놓이더라구요 참고되셨으면 좋겠어요',
]

WITH_REGION_FIRE = [
    '{지역}쪽도 출장 되는 걸로 알고 있어요~',
    '{지역} 근처시면 참고하시면 좋을 것 같아요!',
    '{키워드}{은는} 미리 챙겨두는 게 낫더라구요. 도움 되셨으면 좋겠어요',
    '{지역}에서도 비슷한 문의 많다고 하시더라구요~',
    '{키워드} 알아보실 때 참고되셨으면 좋겠습니다!',
]

# 업종(키워드) → (순수응답, 지역포함) 풀
POOLS = {
    '누수탐지': (PLAIN, WITH_REGION),
    '보안': (PLAIN_SECURITY, WITH_REGION_SECURITY),
    '소방': (PLAIN_FIRE, WITH_REGION_FIRE),
}

# 지역 문구가 섞일 확률
REGION_RATE = float(__import__("os").environ.get("CAFE_CMT_REPLY_REGION_RATE", "0.35"))


# 지역이 아닌 업종어 목록은 댓글 쪽과 반드시 같아야 한다(다르면 같은 글인데
#   댓글은 '서초', 답글은 '서초 회사' 가 되어 티가 난다) → 한 곳에서 가져다 쓴다.
from comment_templates import GENERIC_HEAD  # noqa: E402


def region_from_text(text, keyword, fallback=""):
    """댓글/제목 문장에서 '<지역> <키워드>' 의 지역만 정확히 뽑는다.

    키워드 바로 앞에 '붙어 있는 한글 덩어리'만 취해서, 앞 문장의 끝("~갑니다.")이
    지역으로 잘못 잡히는 문제를 막는다(마침표·공백에서 자연히 끊긴다).
    업종어가 끼는 경우('서초 회사 보안')를 위해 최대 두 덩어리까지 보고 뒤에서부터 걷어낸다.
    """
    if not text or not keyword:
        return fallback
    m = re.search(r"((?:[가-힣]{2,6}\s+)?[가-힣]{2,6})\s*" + re.escape(keyword), text)
    if not m:
        return fallback
    toks = [t for t in m.group(1).split() if t]
    while toks and toks[-1] in GENERIC_HEAD:
        toks.pop()
    if not toks:
        return fallback
    cand = toks[-1]
    # 문장 어미가 잡힌 경우는 지역이 아니다
    if re.search(r"(니다|습니|어요|아요|네요|세요|해요|지요|군요|더라|겠어)$", cand):
        return fallback
    return cand


def _josa_eun_neun(word):
    """받침 유무로 은/는 선택. '누수탐지는' 은 맞지만 '보안는' 은 틀리다(→ '보안은')."""
    w = (word or "").strip()
    if not w:
        return "는"
    ch = w[-1]
    if "가" <= ch <= "힣":
        return "은" if (ord(ch) - 0xAC00) % 28 else "는"
    return "는"


def build_reply(region, keyword, avoid=None):
    """답글 1건 — 대부분 순수 응답, 가끔 지역/키워드를 섞는다."""
    pools = POOLS.get((keyword or "").strip())
    if pools is None:
        raise RuntimeError(f"답글 템플릿 없음: 키워드 '{keyword}' — reply_templates.POOLS 에 추가 필요")
    plain_pool, region_pool = pools

    def compose():
        if region and random.random() < REGION_RATE:
            t = random.choice(region_pool)
            kw = (keyword or "").strip()
            out = (t.replace("{지역}", region.strip())
                    .replace("{키워드}", kw)
                    .replace("{은는}", _josa_eun_neun(kw)))
        else:
            out = random.choice(plain_pool)
        return re.sub(r"\s{2,}", " ", out).strip()

    out = compose()
    for _ in range(6):
        if not avoid or out != avoid.strip():
            break
        out = compose()
    return out

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
    '{키워드}는 원인 잡는 게 반이더라구요. 도움 되셨으면 좋겠어요',
    '{지역}에서도 비슷한 사례 많다고 하시더라구요~',
    '{키워드} 알아보실 때 참고되셨으면 좋겠습니다!',
]

# 지역 문구가 섞일 확률
REGION_RATE = float(__import__("os").environ.get("CAFE_CMT_REPLY_REGION_RATE", "0.35"))


def region_from_text(text, keyword, fallback=""):
    """댓글/제목 문장에서 '<지역> <키워드>' 의 지역만 정확히 뽑는다.

    키워드 바로 앞에 '붙어 있는 한글 덩어리'만 취해서, 앞 문장의 끝("~갑니다.")이
    지역으로 잘못 잡히는 문제를 막는다(마침표·공백에서 자연히 끊긴다).
    """
    if not text or not keyword:
        return fallback
    m = re.search(r"([가-힣]{2,6})\s*" + re.escape(keyword), text)
    if not m:
        return fallback
    cand = m.group(1)
    # 문장 어미가 잡힌 경우는 지역이 아니다
    if re.search(r"(니다|습니|어요|아요|네요|세요|해요|지요|군요|더라|겠어)$", cand):
        return fallback
    return cand


def build_reply(region, keyword, avoid=None):
    """답글 1건 — 대부분 순수 응답, 가끔 지역/키워드를 섞는다."""
    def compose():
        if region and random.random() < REGION_RATE:
            t = random.choice(WITH_REGION)
            out = t.replace("{지역}", region.strip()).replace("{키워드}", (keyword or "").strip())
        else:
            out = random.choice(PLAIN)
        return re.sub(r"\s{2,}", " ", out).strip()

    out = compose()
    for _ in range(6):
        if not avoid or out != avoid.strip():
            break
        out = compose()
    return out

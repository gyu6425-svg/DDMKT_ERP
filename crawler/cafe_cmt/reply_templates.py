# -*- coding: utf-8 -*-
"""카페 대댓글(답글) 템플릿 풀 — 발행 계정이 우리 댓글에 답글을 단다.

톤: 업체 응대체(딱딱함)가 아니라 **관심 있는 일반 회원처럼** 가볍게.
    사장님 제공 예시: "부천쪽에 누수탐지 안그래도 보고있었는데 좋은 정보 감사합니다!!"
{지역}/{키워드}는 그 글 제목에서 뽑은 값으로 치환된다.
"""
import random
import re

OPENERS = ['', '', '오 ', '아 ', '와 ', '헐 ']

TEMPLATES = [
    # 사장님 제공 예시(기준)
    '{지역}쪽에 {키워드} 안그래도 보고있었는데 좋은 정보 감사합니다!!',
    # 같은 결의 변형
    '저도 {지역} {키워드} 알아보던 중이었는데 도움 많이 됐어요!',
    '마침 {지역}쪽 {키워드} 찾고 있었는데 감사합니다~',
    '{지역} {키워드} 정보가 별로 없어서 답답했는데 덕분에 감 잡았네요!',
    '{지역}에서 {키워드} 알아보고 있었거든요, 좋은 정보 감사해요!!',
    '{지역} {키워드} 후기 찾고 있었는데 딱 필요한 내용이네요 감사합니다!',
    '{지역}쪽 {키워드} 어디가 괜찮나 고민이었는데 참고할게요~',
    '{지역} {키워드} 이런 정보 진짜 도움돼요! 잘 보고 갑니다',
]

CLOSERS = ['', '', ' 감사합니다~', ' 참고할게요!', ' 도움 됐어요!']


def _fill(tpl, region, keyword):
    out = tpl.replace('{지역}', (region or '').strip()).replace('{키워드}', (keyword or '').strip())
    return re.sub(r'\s{2,}', ' ', out).strip()


def build_reply(region, keyword, avoid=None):
    """답글 1건 — 오프너+템플릿+클로저 조합. avoid 와 같으면 다시 뽑음."""
    def compose():
        opener = random.choice(OPENERS)
        base = _fill(random.choice(TEMPLATES), region, keyword)
        closer = random.choice(CLOSERS)
        # 이미 '!'/'~'로 끝나거나 '감사'가 있으면 클로저 생략(어색함 방지)
        if re.search(r'[!~]$|감사', base):
            closer = ''
        return re.sub(r'\s{2,}', ' ', (opener + base + closer)).strip()

    out = compose()
    for _ in range(6):
        if not avoid or out != avoid.strip():
            break
        out = compose()
    return out

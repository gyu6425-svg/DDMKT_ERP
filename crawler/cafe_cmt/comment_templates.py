# -*- coding: utf-8 -*-
"""카페 댓글 고정 템플릿 풀 (파이썬판 — 워처가 자동 댓글 생성용).
   src/lib/cafeCommentTemplates.ts 와 동일 로직. {지역}/{키워드} 치환 + 오프너/클로저 조합으로 매번 다르게.
   (웹 수동 입력은 TS판, 자동 크롤링은 이 파이썬판 — 두 경로 모두 sub 전용)."""
import random
import re

OPENERS = ['', '', '오, ', '와, ', '우와 ', '오호, ', '아, ', '헐 ']

TEMPLATES = [
    '{지역} {키워드}의 좋은 후기 잘 보고갑니다.',
    '{지역} {키워드} 알아보려고 하다가 보니까 큰 도움되는 정보였어요.',
    '필요한 정보였는데 {키워드}에 대해서 깔끔하게 정리해주셔서 잘 읽었습니다.',
    '안그래도 {지역} 쪽에서 {키워드} 알아보고 있었는데! 기억하고 있다가 꼭 써먹어야겠어요.',
    '{지역} {키워드}에 대한 정보 공유 감사합니다. 큰 도움 됐어요!',
    '{키워드} 관련해서 고민 많았는데 이 글 보고 감 잡았네요. {지역} 쪽 알아봐야겠어요.',
    '이런 정보 찾고 있었는데 잘 보고 갑니다. {지역} {키워드} 참고할게요!',
    '{지역} {키워드} 후기 잘 봤습니다. 깔끔하게 잘 해주시나 봐요!',
    '글 잘 읽었어요. {키워드} 알아보다가 {지역} 업체 연락해봐야겠네요.',
    '정리 깔끔하게 잘 해주셨네요. {지역} {키워드} 필요하면 참고하겠습니다.',
    '{지역}에서 {키워드} 어디가 괜찮나 찾고 있었는데 잘 봤어요. 참고할게요!',
    '{키워드} 이런 건 미리 알아두는 게 좋겠네요. {지역} 정보 감사합니다.',
    '마침 {지역} {키워드} 필요했는데 딱 좋은 글이네요. 잘 보고 갑니다.',
]

CLOSERS = ['', '', ' 감사합니다!', ' 좋은 정보 감사해요.', ' 도움 많이 됐어요!']


def _fill(tpl, region, keyword):
    out = tpl.replace('{지역}', (region or '').strip()).replace('{키워드}', (keyword or '').strip())
    return re.sub(r'\s{2,}', ' ', out).strip()


def build_comment(region, keyword, avoid=None):
    """랜덤 댓글 1건 — 오프너+템플릿+클로저 조합. avoid 와 같으면 몇 번 다시 뽑음."""
    def compose():
        opener = random.choice(OPENERS)
        base = _fill(random.choice(TEMPLATES), region, keyword)
        closer = random.choice(CLOSERS)
        if re.search(r'[!~]$|감사', base):
            closer = ''
        elif '도움' in closer and '도움' in base:
            closer = ''
        elif '보고' in closer and '보고' in base:
            closer = ''
        return re.sub(r'\s{2,}', ' ', (opener + base + closer)).strip()

    out = compose()
    for _ in range(6):
        if not avoid or out != avoid.strip():
            break
        out = compose()
    return out

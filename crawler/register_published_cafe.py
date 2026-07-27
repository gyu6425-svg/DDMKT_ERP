# -*- coding: utf-8 -*-
"""레거시 호환 래퍼.

발행완료 등록 경로를 cafe_rank_sync 하나로 통일해 board/company/account 정보 누락을 방지한다.
"""
from cafe_rank_sync import main

if __name__ == "__main__":
    main()
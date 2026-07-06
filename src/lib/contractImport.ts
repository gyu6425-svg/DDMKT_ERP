// 판매(매출) 시트 붙여넣기 파싱 — 계약 관리 일괄 등록과 상세페이지 계약 추가에서 공용.
//   품목명 → 카테고리·세부유형 자동 분류, 외주단가=외주비÷수량, 알려진 브랜드면 외주업체 자동 기입.

export const num = (s: string) => Number((s || '').replace(/[^\d.-]/g, '')) || 0;
export const normCompany = (s: string) => (s || '').trim().replace(/\s+/g, '').toLowerCase();
// 품목명 '슈퍼뭉치 외 1건' → '슈퍼뭉치'(외 N건 앞부분만). 분류에 이 기준값 사용.
export const productBase = (s: string) => (s || '').replace(/\s*외\s*\d+\s*건.*$/, '').trim();
// 머리글 행에서 컬럼을 이름으로 찾기(순서/개수 무관). 첫 매칭 열 인덱스.
export const findCol = (headers: string[], keys: string[]) =>
    headers.findIndex((h) => {
        const x = h.replace(/\s/g, '');
        return keys.some((k) => x.includes(k));
    });
export const parseDate = (s: string) => {
    const m = (s || '').match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};

// 따옴표 인식 TSV 파서 — 엑셀에서 여러 줄 셀(예: 특이사항)을 복사하면 "..."로 감싸지고 셀 안에 줄바꿈이
//   들어오는데, 그걸 한 셀로 올바르게 묶는다. 반환: 행 배열 × 셀 배열.
export function parseTsvGrid(text: string): string[][] {
    const t = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (inQ) {
            if (ch === '"') {
                if (t[i + 1] === '"') {
                    field += '"';
                    i++;
                } else inQ = false;
            } else field += ch;
        } else if (ch === '"') {
            inQ = true;
        } else if (ch === '\t') {
            row.push(field);
            field = '';
        } else if (ch === '\n') {
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else field += ch;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

// 미리 채워둘 머리글(탭 구분) — 실제 시트 컬럼과 동일. 사용자는 아래에 데이터만 붙여넣음.
// 실제 판매 시트 열 순서와 동일해야 함(데이터만 붙여넣으므로 이 순서가 파싱 기준).
//   실제 시트는 합계 다음 '외주비'(큰 값) → '순매출'(작은 값) 순서. 외주단가=외주비÷수량.
export const SALES_HEADER =
    '일자-No.\t회계전표일자-No.\t거래처명\t품목명(규격)\t업체명\t수량\t단가\t공급가액\t부가세\t합계\t외주비\t순매출\t사원(담당)명';

// 알려진 외주업체·리워드 업체명(품목명이 이 브랜드면 외주업체명 자동 기입 → 카드 우측 배지).
//   그 외 품목은 외주업체 공란(나중 입력).
const VENDORS = ['슈퍼뭉치', '저인망', '247', '고스트', '저스트', '라인', '실계'];
// 흔한 단어라 부분일치하면 다른 품목(예: '숏폼 마케팅')까지 오탐 → 정확히 일치할 때만 리워드 업체명으로.
const VENDORS_EXACT = ['마케팅'];
export const vendorFromProduct = (base: string): string | null => {
    const b = (base || '').trim();
    if (VENDORS_EXACT.includes(b)) return b;
    for (const v of VENDORS) {
        if (b === v || b.includes(v)) return v;
    }
    return null;
};

export type Mapped = { category: string; subtype: string } | { exclude: true };

// 품목명 → 카테고리·세부유형. 매핑 밖/애매 품목은 제외.
export function mapProduct(nameRaw: string, unit = 0): Mapped {
    const p = (nameRaw || '').trim();
    const has = (k: string) => p.includes(k);
    const EXCLUDE = [
        '종합광고대행',
        '대행 수수료',
        '대행수수료',
        '사진촬영',
        '영상제작',
        '숏폼 마케팅',
        '숏품 마케팅',
        '클립 업로드',
        '월관리 패키지',
        '90패키지',
        '서비스',
    ];
    if (!p) return { exclude: true };
    if (EXCLUDE.some((e) => p.includes(e))) return { exclude: true };
    if (['고스트', '저스트', '슈퍼뭉치', '라인', '마케팅'].includes(p) || p === '리워드')
        return { category: '플레이스', subtype: '플레이스 리워드' };
    if (has('실계')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('247')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('저인망')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('ai') || has('AI')) return { category: '블로그', subtype: 'AI 블로그 배포' };
    if (has('상위노출') || has('월보장')) return { category: '플레이스', subtype: '상위노출 보장형' };
    if (has('영수증')) return { category: '플레이스', subtype: '영수증 리뷰' };
    if (has('프리미엄')) return { category: '플레이스', subtype: '플레이스용 블로그 배포' };
    if (has('이미지')) return { category: '블로그', subtype: '브랜드블로그 유료이미지' };
    if (has('브랜드블로그') || has('브랜드 블로그')) return { category: '블로그', subtype: '브랜드 블로그' };
    if (has('준최적화')) return { category: '블로그', subtype: '준최적화 블로그 배포' };
    if (has('최적화')) return { category: '블로그', subtype: '최적화 블로그 배포' };
    // 일반 블로그 배포/리뷰: 단가 10,000원 미만이면 플레이스용, 이상이면 브랜드 블로그.
    if (has('블로그'))
        return unit < 10000
            ? { category: '플레이스', subtype: '플레이스용 블로그 배포' }
            : { category: '블로그', subtype: '브랜드 블로그' };
    if (has('인스타그램')) return { category: '인스타', subtype: '브랜드 인스타' };
    if (has('인스타') || has('릴스')) return { category: '인스타', subtype: '인스타 배포' };
    if (has('파워링크')) return { category: '파워링크', subtype: '파워링크' };
    if (has('스마트스토어') || has('슬롯') || has('가구매') || has('실구매') || has('체험단'))
        return { category: '쇼핑', subtype: '쇼핑' };
    return { exclude: true };
}

export type ParsedRow = {
    date: string | null;
    partner: string; // 매출 시트 거래처명 = 고객 청구명
    product: string;
    company: string;
    qty: number;
    unit: number; // 판매단가
    amount: number; // 매출(공급가액)
    outsource: number; // 외주비(매출 시트)
    outUnit: number | null; // 외주단가 = 외주비 ÷ 수량
    vendor: string | null; // 외주업체명(알려진 브랜드면 자동)
    manager: string;
    map: Mapped;
    dup: boolean;
};

// 판매(주) 시트 파싱(헤더 기반). 일자·품목명·업체명·수량·단가·공급가액·거래처명·담당자를 이름으로.
export function parseSalesRows(salesText: string): ParsedRow[] {
    const out: ParsedRow[] = [];
    const lines = salesText.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
    if (lines.length < 2) return out;
    const H = lines[0].split('\t').map((s) => s.trim());
    const iDate = findCol(H, ['일자', '날짜']);
    const iProduct = findCol(H, ['품목']);
    const iCompany = findCol(H, ['업체명']);
    const iPartner = findCol(H, ['거래처']);
    const iQty = findCol(H, ['수량']);
    const iUnit = findCol(H, ['단가']);
    const iAmount = findCol(H, ['공급가']);
    const iOut = findCol(H, ['외주비']);
    const iManager = findCol(H, ['담당', '사원']);
    if (iCompany < 0 || iProduct < 0 || iQty < 0) return out;
    const seen = new Set<string>();
    for (const line of lines.slice(1)) {
        const c = line.split('\t');
        const company = (c[iCompany] || '').trim();
        const product = (c[iProduct] || '').trim();
        if (!company || !product) continue;
        const qty = num(c[iQty]);
        const amount = iAmount >= 0 ? num(c[iAmount]) : 0;
        const outsource = iOut >= 0 ? num(c[iOut]) : 0;
        const unit = iUnit >= 0 ? num(c[iUnit]) : 0;
        const base = productBase(product);
        const mp = mapProduct(base, unit);
        // 상위노출 보장형 부모는 외주비 무시(0) — 외주비는 2차 등록 하위에서만 입력.
        const isBoost = !('exclude' in mp) && mp.subtype === '상위노출 보장형';
        const key = `${iDate >= 0 ? (c[iDate] || '').trim() : ''}|${company}|${product}|${qty}|${amount}`;
        const dup = seen.has(key);
        seen.add(key);
        out.push({
            amount,
            company,
            date: iDate >= 0 ? parseDate(c[iDate]) : null,
            dup,
            manager: iManager >= 0 ? (c[iManager] || '').trim() : '',
            map: mp, // 단가 전달(블로그 배포 10,000원 임계값)
            // 외주단가 = 외주비 ÷ 수량. 상위노출 보장형 부모는 0(하위에서 입력).
            outUnit: isBoost ? null : qty > 0 && outsource > 0 ? Math.round(outsource / qty) : null,
            outsource: isBoost ? 0 : outsource,
            partner: iPartner >= 0 ? (c[iPartner] || '').trim() : '',
            product,
            qty,
            unit,
            vendor: vendorFromProduct(base),
        });
    }
    return out;
}

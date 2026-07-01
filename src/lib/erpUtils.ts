// ERP 공용 유틸 (포맷·상수·붙여넣기 자동 파서)

export function formatAmount(value: number | null | undefined): string {
    if (value === null || value === undefined) {
        return '--';
    }

    const num = Number(value);

    if (Number.isNaN(num)) {
        return '--';
    }

    if (num === 0) {
        return '0원';
    }

    if (num >= 100000000) {
        return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
    }

    if (num >= 10000) {
        return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`;
    }

    return `${num.toLocaleString()}원`;
}

export function todayStr(): string {
    return new Date()
        .toLocaleDateString('ko-KR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .replace(/\. /g, '-')
        .replace('.', '-')
        .trim();
}

export function ym(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export const STATUS_OPTIONS = ['신규문의', '상담중', '제안완료', '계약완료', '보류'];
// 업태 / 업종 (세금계산서용) — 필요 시 추가.
export const INDUSTRY_OPTIONS = [
    '서비스업 / 세무사업',
    '서비스업 / 홍보대행업',
    '서비스업 / 광고대행업',
    '서비스업 / 경영컨설팅',
    '서비스업 / 마케팅',
    '도소매업 / 전자상거래',
    '도소매업 / 통신판매업',
    '제조업 / 식품',
    '음식점업 / 일반음식점',
    '부동산업 / 부동산중개',
    '보건업 / 병의원',
    '교육서비스업 / 학원',
    '건설업 / 인테리어',
    '기타',
];
export const SOURCE_OPTIONS = [
    '검색',
    '카카오톡',
    '이메일',
    '인스타그램',
    '네이버',
    '지인소개',
    '홈페이지',
    '기타',
];

export const STATUS_BADGE: Record<string, string> = {
    계약완료: 'bg-[#d1fae5] text-[#059669]',
    계약종료: 'bg-[#e5e7eb] text-[#475569]',
    보류: 'bg-[#e2e8f0] text-[#64748b]',
    상담중: 'bg-[#fed7aa] text-[#d97706]',
    신규문의: 'bg-[#dbeafe] text-[#1e40af]',
    제안완료: 'bg-[#ede9fe] text-[#7c3aed]',
};

export const SOURCE_BADGE: Record<string, string> = {
    네이버: 'bg-[#d1fae5] text-[#059669]',
    이메일: 'bg-[#fed7aa] text-[#d97706]',
    인스타그램: 'bg-[#ede9fe] text-[#7c3aed]',
    카카오톡: 'bg-[#fef3c7] text-[#ca8a04]',
    검색: 'bg-[#dbeafe] text-[#1e40af]',
};

// ── 계약 재무 계산 ──────────────────────────────────────
import type { ErpContractData } from '../api/erp';

export type ContractFinancials = {
    revenue: number; // 매출(부가세 포함 가능)
    supply: number; // 공급가(부가세 제외)
    outsource: number; // 외주비
    net: number; // 순수익 = 공급가 - 외주비
    incentivePct: number; // 적용 인센티브율(%)
    incentive: number; // 인센티브 금액
    unpaid: number; // 미수금
    billed: number; // 청구 합계
    paid: number; // 수금 합계
};

// commission_rate가 0.1(비율) / 10(퍼센트) 어느 쪽이든 퍼센트로 정규화
export function normalizeRate(rate: number | null | undefined): number {
    const value = Number(rate) || 0;
    return value > 0 && value <= 1 ? value * 100 : value;
}

export function calcContract(
    cd: ErpContractData,
    commissionRate: number | null | undefined,
): ContractFinancials {
    const products = Array.isArray(cd.contract_products) ? cd.contract_products : [];
    const autoRevenue = products.reduce(
        (sum, p) => sum + (Number(p.unit_price) || 0) * (Number(p.quantity) || 0),
        0,
    );
    const autoOutsource = products.reduce(
        (sum, p) => sum + (Number(p.unit_outsource) || 0) * (Number(p.quantity) || 0),
        0,
    );

    const revenue = Number(cd.manual_revenue) > 0 ? Number(cd.manual_revenue) : autoRevenue;
    const outsource = Number(cd.manual_outsource) > 0 ? Number(cd.manual_outsource) : autoOutsource;
    const supply = cd.vat_included ? Math.round(revenue / 1.1) : revenue;
    const net = supply - outsource;

    const incentivePct = normalizeRate(commissionRate);
    const incentive = Math.round((net * incentivePct) / 100);

    const records = Array.isArray(cd.billing_records) ? cd.billing_records : [];
    const billed = records.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const paid = records.filter((r) => r.paid).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const unpaid = billed - paid;

    return { billed, incentive, incentivePct, net, outsource, paid, revenue, supply, unpaid };
}

export type ParsedClient = {
    company?: string;
    manager?: string;
    contact?: string;
    email?: string;
    product?: string;
    budget?: string;
    inquiry?: string;
    source?: string;
};

const FIELD_MAP: Record<string, keyof ParsedClient> = {
    업체명: 'company',
    상호명: 'company',
    회사명: 'company',
    담당자: 'manager',
    담당자명: 'manager',
    이름: 'manager',
    성함: 'manager',
    연락처: 'contact',
    전화번호: 'contact',
    핸드폰: 'contact',
    휴대폰: 'contact',
    전화: 'contact',
    이메일: 'email',
    email: 'email',
    메일: 'email',
    마케팅상품: 'product',
    '마케팅 상품': 'product',
    상품: 'product',
    서비스: 'product',
    광고예산: 'budget',
    '광고 예산': 'budget',
    예산: 'budget',
    문의내용: 'inquiry',
    '문의 내용': 'inquiry',
    내용: 'inquiry',
    문의사항: 'inquiry',
    문의경로: 'source',
    유입경로: 'source',
    경로: 'source',
    문의: 'source',
};

const MULTILINE: Record<string, boolean> = { inquiry: true };

// 카카오·메일 등 붙여넣은 텍스트를 필드로 자동 분리
export function parsePaste(text: string): ParsedClient {
    const result: ParsedClient = {};
    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return result;
    }

    // ── 탭/여러 칸으로 구분된 한 줄 형식 ──
    const parts = lines[0].split('\t');
    if (parts.length >= 3) {
        const remaining: string[] = [];
        parts.forEach((raw) => {
            const part = raw.trim();
            if (!part) {
                return;
            }
            if (!result.contact && /^0[1-9][0-9]{7,9}$/.test(part.replace(/[-\s]/g, ''))) {
                result.contact = part;
                return;
            }
            if (!result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) {
                result.email = part;
                return;
            }
            if (!result.budget && /(만원|억|~|원\/월|원$)/.test(part) && part.length < 20) {
                result.budget = part;
                return;
            }
            remaining.push(part);
        });
        const order: Array<keyof ParsedClient> = ['company', 'manager', 'product', 'inquiry'];
        remaining.forEach((part, index) => {
            if (index < order.length && !result[order[index]]) {
                result[order[index]] = part;
            }
        });
        if (remaining.length > order.length) {
            const extra = remaining.slice(order.length).join(' ');
            if (extra) {
                result.inquiry = (result.inquiry ? `${result.inquiry} ` : '') + extra;
            }
        }
        return result;
    }

    // ── 라벨:값 또는 라벨\n값 형식 ──
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line) {
            i += 1;
            continue;
        }
        let matched: keyof ParsedClient | null = null;
        let value: string | null = null;
        let isML = false;
        const colon = line.indexOf(':');

        if (colon > 0) {
            const key = line.slice(0, colon).trim().toLowerCase();
            for (const k in FIELD_MAP) {
                if (key === k.toLowerCase()) {
                    matched = FIELD_MAP[k];
                    value = line.slice(colon + 1).trim();
                    isML = MULTILINE[matched] || false;
                    break;
                }
            }
        }

        if (!matched) {
            const lower = line.toLowerCase();
            for (const k in FIELD_MAP) {
                if (lower === k.toLowerCase()) {
                    matched = FIELD_MAP[k];
                    isML = MULTILINE[matched] || false;
                    const vals: string[] = [];
                    let j = i + 1;
                    while (j < lines.length) {
                        const next = lines[j];
                        if (!next) {
                            j += 1;
                            if (!isML) break;
                            continue;
                        }
                        let isLabel = false;
                        const nextLow = next.toLowerCase();
                        for (const k2 in FIELD_MAP) {
                            if (
                                nextLow === k2.toLowerCase() ||
                                nextLow.indexOf(`${k2.toLowerCase()}:`) === 0
                            ) {
                                isLabel = true;
                                break;
                            }
                        }
                        if (isLabel) break;
                        vals.push(next);
                        j += 1;
                        if (!isML) break;
                    }
                    value = vals.join('\n').trim();
                    i = j - 1;
                    break;
                }
            }
        }

        if (matched && value) {
            if (isML && result[matched]) {
                result[matched] = `${result[matched]}\n${value}`;
            } else if (!result[matched]) {
                result[matched] = value;
            }
        }
        i += 1;
    }

    // ── 패턴 보강 ──
    lines.forEach((line) => {
        if (!result.contact && /^0[1-9][0-9]{7,9}$/.test(line.replace(/[-\s]/g, ''))) {
            result.contact = line;
        }
        if (!result.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) {
            result.email = line;
        }
        if (!result.company && /(주식회사|\(주\)|㈜|유한회사)/i.test(line)) {
            result.company = line;
        }
    });

    return result;
}

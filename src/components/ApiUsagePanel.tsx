import { useEffect, useMemo, useState } from 'react';
import { getApiUsageRecent, type ApiUsageRecord } from '../api/apiUsage';
import {
    computeRecordCostUsd,
    extractTokenBreakdown,
    formatKrw,
    formatUsd,
} from '../lib/apiPricing';
import Button from './Button';

function formatDateTime(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString('ko-KR', {
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

type UsageKind = 'all' | 'banner' | 'blog' | 'post' | 'image';

// 배너(이미지) = banner_size 있음, 블로그(텍스트) = model 'blog'.
// 카페: 원고 = model 'cafe-post'(텍스트), 이미지 = model 'cafe-card'.
function isBanner(record: ApiUsageRecord) {
    return Boolean(record.banner_size);
}
function isBlog(record: ApiUsageRecord) {
    return record.model === 'blog';
}
function isCafePost(record: ApiUsageRecord) {
    return record.model === 'cafe-post';
}
function isCafeCard(record: ApiUsageRecord) {
    return record.model === 'cafe-card' || record.model === 'cafe-card-mini';
}
function isCafe(record: ApiUsageRecord) {
    return isCafePost(record) || isCafeCard(record);
}

const KIND_TABS_ALL: Array<{ id: UsageKind; label: string }> = [
    { id: 'all', label: '전체' },
    { id: 'banner', label: '배너' },
    { id: 'blog', label: '블로그' },
];
const KIND_TABS_CAFE: Array<{ id: UsageKind; label: string }> = [
    { id: 'all', label: '전체' },
    { id: 'post', label: '원고' },
    { id: 'image', label: '이미지' },
];

// scope='cafe' 면 카페 기록만(원고/이미지) 보여주는 '카페 원고 생성기' 비용 탭.
function ApiUsagePanel({ scope = 'all' }: { scope?: 'all' | 'cafe' } = {}) {
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [records, setRecords] = useState<ApiUsageRecord[]>([]);
    const [kind, setKind] = useState<UsageKind>('all');
    const KIND_TABS = scope === 'cafe' ? KIND_TABS_CAFE : KIND_TABS_ALL;

    const load = async () => {
        setLoading(true);
        setErrorMessage('');

        const { data, error } = await getApiUsageRecent(500);

        if (error) {
            setErrorMessage(
                'API 사용량을 불러오지 못했습니다. Supabase에 api_usage 테이블이 생성되어 있는지 확인하세요. (docs/api-usage-table.sql)',
            );
            setRecords([]);
            setLoading(false);
            return;
        }

        setRecords(data);
        setLoading(false);
    };

    useEffect(() => {
        void load();
    }, []);

    const filtered = useMemo(
        () =>
            records.filter((record) => {
                if (scope === 'cafe' && !isCafe(record)) return false;
                if (kind === 'banner') return isBanner(record);
                if (kind === 'blog') return isBlog(record);
                if (kind === 'post') return isCafePost(record);
                if (kind === 'image') return isCafeCard(record);
                return true;
            }),
        [records, kind, scope],
    );

    const summary = useMemo(() => {
        let success = 0;
        let error = 0;
        let tokens = 0;
        let cost = 0;
        for (const record of filtered) {
            if (record.status === 'success') success += 1;
            else error += 1;
            tokens += extractTokenBreakdown(record.usage_raw).total;
            cost += computeRecordCostUsd(record);
        }
        return { cost, error, success, tokens, total: filtered.length };
    }, [filtered]);

    const summaryCards: Array<{ label: string; value: string; note?: string }> = [
        { label: '호출', value: summary.total.toLocaleString('ko-KR') },
        { label: '성공', value: summary.success.toLocaleString('ko-KR') },
        { label: '실패', value: summary.error.toLocaleString('ko-KR') },
        { label: '총 토큰', value: summary.tokens.toLocaleString('ko-KR') },
        {
            label: '실제 비용',
            note: formatKrw(summary.cost),
            value: formatUsd(summary.cost),
        },
    ];

    return (
        <div className="grid gap-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="m-0 text-[18px] font-semibold text-[#111111]">
                        {scope === 'cafe' ? '카페 원고 생성기 — API 비용' : 'API 사용량'}
                    </h3>
                    <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                        {scope === 'cafe'
                            ? '카페 원고(텍스트) · 첫 장 이미지 생성의 실제 토큰·비용 기록입니다. (최근 500건 · 2~8 고정이미지는 비용 없음)'
                            : '배너·블로그 생성의 실제 토큰·비용 기록입니다. (최근 500건)'}
                    </p>
                </div>
                <Button
                    className="inline-flex h-10 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading}
                    onClick={() => {
                        void load();
                    }}
                    type="button"
                >
                    {loading ? '불러오는 중...' : '새로고침'}
                </Button>
            </div>

            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {KIND_TABS.map((tab) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            kind === tab.id
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={tab.id}
                        onClick={() => setKind(tab.id)}
                        type="button"
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {errorMessage ? (
                <p className="m-0 rounded-[8px] bg-[#fef2f2] px-4 py-3 text-sm leading-6 text-[#b91c1c]">
                    {errorMessage}
                </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {summaryCards.map((card) => (
                    <div
                        className="rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3"
                        key={card.label}
                    >
                        <span className="block text-xs font-medium text-[#6b7280]">
                            {card.label}
                        </span>
                        <strong className="mt-1 block text-[22px] font-semibold text-[#111111]">
                            {card.value}
                        </strong>
                        {card.note ? (
                            <span className="mt-0.5 block text-xs text-[#9ca3af]">{card.note}</span>
                        ) : null}
                    </div>
                ))}
            </div>

            <p className="m-0 text-xs leading-5 text-[#9ca3af]">
                ※ 비용 = API가 돌려준 실제 토큰 수(입력/캐시/출력) × 단가 + 이미지 1장 단가(size·quality).
                토큰 수는 실측값이며, 단가는 src/lib/apiPricing.ts(TOKEN_RATES_USD_PER_M / IMAGE_PRICE_USD)에서
                실제 OpenAI 요금으로 맞추면 과거 기록까지 자동 재계산됩니다.
            </p>

            <div className="overflow-x-auto rounded-[8px] border border-[#e5e7eb]">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-[#e5e7eb] bg-[#f9fafb] text-xs text-[#6b7280]">
                            <th className="px-3 py-2 font-semibold">시간</th>
                            <th className="px-3 py-2 font-semibold">작업자</th>
                            <th className="px-3 py-2 font-semibold">종류</th>
                            <th className="px-3 py-2 font-semibold">사이즈/품질</th>
                            <th className="px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold" title="입력 토큰">
                                입력
                            </th>
                            <th className="px-3 py-2 font-semibold" title="캐시된 입력 토큰">
                                캐시
                            </th>
                            <th className="px-3 py-2 font-semibold" title="출력 토큰">
                                출력
                            </th>
                            <th className="px-3 py-2 font-semibold" title="추론 토큰(출력에 포함)">
                                추론
                            </th>
                            <th className="px-3 py-2 font-semibold">실제 비용</th>
                            <th className="px-3 py-2 font-semibold">오류</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length > 0 ? (
                            filtered.map((record) => {
                                const b = extractTokenBreakdown(record.usage_raw);
                                const cell = (n: number) => (n ? n.toLocaleString('ko-KR') : '-');
                                return (
                                    <tr
                                        className="border-b border-[#f3f4f6] last:border-b-0"
                                        key={record.id}
                                    >
                                        <td className="whitespace-nowrap px-3 py-2 text-[#111827]">
                                            {formatDateTime(record.created_at)}
                                        </td>
                                        <td className="px-3 py-2 text-[#374151]">
                                            {record.operator_name || record.user_email || '-'}
                                        </td>
                                        <td className="px-3 py-2 text-[#374151]">
                                            {isCafePost(record)
                                                ? '원고'
                                                : isCafeCard(record)
                                                  ? '이미지'
                                                  : isBanner(record)
                                                    ? '배너'
                                                    : isBlog(record)
                                                      ? '블로그'
                                                      : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-[#374151]">
                                            {record.banner_size
                                                ? `${record.banner_size}${
                                                      record.image_quality
                                                          ? ` · ${record.image_quality}`
                                                          : ''
                                                  }`
                                                : '-'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                                    record.status === 'success'
                                                        ? 'bg-[#ecfdf5] text-[#047857]'
                                                        : 'bg-[#fef2f2] text-[#b91c1c]'
                                                }`}
                                            >
                                                {record.status === 'success' ? '성공' : '실패'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-[#374151]">{cell(b.input)}</td>
                                        <td className="px-3 py-2 text-[#9ca3af]">{cell(b.cached)}</td>
                                        <td className="px-3 py-2 text-[#374151]">{cell(b.output)}</td>
                                        <td className="px-3 py-2 text-[#9ca3af]">
                                            {cell(b.reasoning)}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-[#111827]">
                                            {formatUsd(computeRecordCostUsd(record))}
                                        </td>
                                        <td className="max-w-[280px] truncate px-3 py-2 text-[#6b7280]">
                                            {record.error_message || '-'}
                                        </td>
                                    </tr>
                                );
                            })
                        ) : (
                            <tr>
                                <td
                                    className="px-3 py-6 text-center text-sm text-[#6b7280]"
                                    colSpan={11}
                                >
                                    {loading ? '불러오는 중...' : '기록이 없습니다.'}
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default ApiUsagePanel;

import { useEffect, useState } from 'react';
import {
    getApiUsageRecent,
    getApiUsageStats,
    type ApiUsageRecord,
    type ApiUsageStats,
} from '../api/apiUsage';
import { formatKrw, formatUsd } from '../lib/apiPricing';

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

const emptyStats: ApiUsageStats = {
    error: 0,
    estimatedCostUsd: 0,
    gemini: 0,
    openai: 0,
    success: 0,
    today: 0,
    total: 0,
};

function ApiUsagePanel() {
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const [stats, setStats] = useState<ApiUsageStats>(emptyStats);
    const [records, setRecords] = useState<ApiUsageRecord[]>([]);

    const load = async () => {
        setLoading(true);
        setErrorMessage('');

        const [statsResult, recentResult] = await Promise.all([
            getApiUsageStats(),
            getApiUsageRecent(100),
        ]);

        if (statsResult.error || recentResult.error) {
            setErrorMessage(
                'API 사용량을 불러오지 못했습니다. Supabase에 api_usage 테이블이 생성되어 있는지 확인하세요. (docs/api-usage-table.sql)',
            );
            setStats(emptyStats);
            setRecords([]);
            setLoading(false);
            return;
        }

        setStats(statsResult.data);
        setRecords(recentResult.data);
        setLoading(false);
    };

    useEffect(() => {
        void load();
    }, []);

    const recentActualCostUsd = records.reduce((sum, record) => sum + (record.cost_usd || 0), 0);

    const summaryCards: Array<{ label: string; value: string; note?: string }> = [
        { label: '총 호출', value: stats.total.toLocaleString('ko-KR') },
        { label: '성공', value: stats.success.toLocaleString('ko-KR') },
        { label: '실패', value: stats.error.toLocaleString('ko-KR') },
        { label: '오늘', value: stats.today.toLocaleString('ko-KR') },
        { label: 'OpenAI', value: stats.openai.toLocaleString('ko-KR') },
        { label: 'Gemini', value: stats.gemini.toLocaleString('ko-KR') },
        {
            label: '실제 비용(최근 100건)',
            note: formatKrw(recentActualCostUsd),
            value: formatUsd(recentActualCostUsd),
        },
    ];

    return (
        <div className="grid gap-6">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="m-0 text-[18px] font-semibold text-[#111111]">API 사용량</h3>
                    <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                        AI 카드 이미지 생성 호출 기록입니다.
                    </p>
                </div>
                <button
                    className="inline-flex h-10 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={loading}
                    onClick={() => {
                        void load();
                    }}
                    type="button"
                >
                    {loading ? '불러오는 중...' : '새로고침'}
                </button>
            </div>

            {errorMessage ? (
                <p className="m-0 rounded-md bg-[#fef2f2] px-4 py-3 text-sm leading-6 text-[#b91c1c]">
                    {errorMessage}
                </p>
            ) : null}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {summaryCards.map((card) => (
                    <div
                        className="rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-4 py-3"
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
                ※ 실제 비용은 API가 돌려준 실제 토큰 사용량 × 단가(src/lib/apiPricing.ts의
                TOKEN_PRICE_USD_PER_M) 기준입니다. 정확한 금액은 단가를 실제 OpenAI 요금으로 맞추세요.
            </p>

            <div className="overflow-x-auto rounded-md border border-[#e5e7eb]">
                <table className="w-full border-collapse text-left text-sm">
                    <thead>
                        <tr className="border-b border-[#e5e7eb] bg-[#f9fafb] text-xs text-[#6b7280]">
                            <th className="px-3 py-2 font-semibold">시간</th>
                            <th className="px-3 py-2 font-semibold">사용자</th>
                            <th className="px-3 py-2 font-semibold">제공자</th>
                            <th className="px-3 py-2 font-semibold">사이즈</th>
                            <th className="px-3 py-2 font-semibold">상태</th>
                            <th className="px-3 py-2 font-semibold">소요(ms)</th>
                            <th className="px-3 py-2 font-semibold">토큰</th>
                            <th className="px-3 py-2 font-semibold">실제 비용</th>
                            <th className="px-3 py-2 font-semibold">오류</th>
                        </tr>
                    </thead>
                    <tbody>
                        {records.length > 0 ? (
                            records.map((record) => (
                                <tr
                                    className="border-b border-[#f3f4f6] last:border-b-0"
                                    key={record.id}
                                >
                                    <td className="whitespace-nowrap px-3 py-2 text-[#111827]">
                                        {formatDateTime(record.created_at)}
                                    </td>
                                    <td className="px-3 py-2 text-[#374151]">
                                        {record.user_email || '-'}
                                    </td>
                                    <td className="px-3 py-2 text-[#374151]">{record.provider}</td>
                                    <td className="px-3 py-2 text-[#374151]">
                                        {record.banner_size || '-'}
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
                                    <td className="px-3 py-2 text-[#374151]">
                                        {record.elapsed_ms ?? '-'}
                                    </td>
                                    <td className="px-3 py-2 text-[#374151]">
                                        {record.total_tokens
                                            ? record.total_tokens.toLocaleString('ko-KR')
                                            : '-'}
                                    </td>
                                    <td className="px-3 py-2 text-[#374151]">
                                        {record.cost_usd != null ? formatUsd(record.cost_usd) : '-'}
                                    </td>
                                    <td className="max-w-[280px] truncate px-3 py-2 text-[#6b7280]">
                                        {record.error_message || '-'}
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td
                                    className="px-3 py-6 text-center text-sm text-[#6b7280]"
                                    colSpan={9}
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

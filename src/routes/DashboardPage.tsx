import { useEffect, useState } from 'react';
import { getDashboardSummary, type DashboardSummary } from '../api/dashboard';

function DashboardPage() {
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [summary, setSummary] = useState<DashboardSummary | null>(null);

    useEffect(() => {
        getDashboardSummary().then(({ data, error }) => {
            if (error) {
                setErrorMessage('대시보드 데이터를 불러오지 못했습니다.');
            } else {
                setSummary(data);
            }

            setLoading(false);
        });
    }, []);

    return (
        <section className="min-h-[320px] rounded-[50px] border border-[#e5e7eb] p-12">
            {loading ? <p>불러오는 중...</p> : null}
            {errorMessage ? <p className="text-[#b91c1c]">{errorMessage}</p> : null}
            {summary ? (
                <div className="grid gap-4 md:grid-cols-4">
                    <div>
                        <p className="m-0 text-sm text-[#666666]">고객사</p>
                        <strong className="text-[28px]">{summary.activeCustomers}</strong>
                    </div>
                    <div>
                        <p className="m-0 text-sm text-[#666666]">계약</p>
                        <strong className="text-[28px]">{summary.activeContracts}</strong>
                    </div>
                    <div>
                        <p className="m-0 text-sm text-[#666666]">총 매출</p>
                        <strong className="text-[28px]">
                            {summary.grossRevenue.toLocaleString()}
                        </strong>
                    </div>
                    <div>
                        <p className="m-0 text-sm text-[#666666]">순매출</p>
                        <strong className="text-[28px]">
                            {summary.netRevenue.toLocaleString()}
                        </strong>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

export default DashboardPage;

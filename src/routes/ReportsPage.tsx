import AdminOnly from '../components/AdminOnly'
import Button from '../components/Button'

function ReportsPage() {
  return (
    <section className="min-h-[320px] rounded-[50px] border border-[#e5e7eb] p-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 text-[28px]">리포트</h1>
        <AdminOnly>
          <Button type="button" variant="secondary">
            CSV 다운로드
          </Button>
        </AdminOnly>
      </div>
    </section>
  )
}

export default ReportsPage

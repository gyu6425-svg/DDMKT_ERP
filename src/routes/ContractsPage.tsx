import { useEffect, useState } from 'react'
import { getContracts } from '../api/contracts'
import type { Contract } from '../types'

function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getContracts().then(({ data, error }) => {
      if (error) {
        setErrorMessage('계약 데이터를 불러오지 못했습니다.')
      } else {
        setContracts(data ?? [])
      }

      setLoading(false)
    })
  }, [])

  return (
    <section className="min-h-[320px] rounded-[40px] border border-[#e5e7eb] bg-white p-12">
      {loading ? <p>불러오는 중...</p> : null}
      {errorMessage ? <p className="text-[#b91c1c]">{errorMessage}</p> : null}
      {!loading && !errorMessage ? (
        <div className="grid gap-3">
          <p className="m-0 text-sm text-[#666666]">총 {contracts.length}개</p>
          {contracts.map((contract) => (
            <article className="border-b border-[#e5e7eb] py-3" key={contract.id}>
              <strong>{contract.company_name}</strong>
              <p className="m-0 text-sm text-[#666666]">
                {contract.contract_start_date ?? '-'} ~ {contract.contract_end_date ?? '-'} ·{' '}
                {contract.total_contract_amount.toLocaleString()}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default ContractsPage

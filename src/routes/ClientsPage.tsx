import { useEffect, useState } from 'react'
import { getCustomers } from '../api/customers'
import type { Customer } from '../types'

function ClientsPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [errorMessage, setErrorMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getCustomers().then(({ data, error }) => {
      if (error) {
        setErrorMessage('고객사 데이터를 불러오지 못했습니다.')
      } else {
        setCustomers(data ?? [])
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
          <p className="m-0 text-sm text-[#666666]">총 {customers.length}개</p>
          {customers.map((customer) => (
            <article className="border-b border-[#e5e7eb] py-3" key={customer.id}>
              <strong>{customer.company_name}</strong>
              <p className="m-0 text-sm text-[#666666]">
                {customer.contact_name ?? '-'} · {customer.phone ?? '-'} · {customer.status}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}

export default ClientsPage

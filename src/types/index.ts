export type ClientStatus =
    | '신규문의'
    | '상담중'
    | '제안완료'
    | '계약진행중'
    | '계약완료'
    | '보류'
    | '종료'
    | '부재중';

// viewer = 고객 ERP(업체 전용 열람), reporter = 기자단 ERP(본인 담당 블로그 열람)
export type UserRole = 'admin' | 'manager' | 'sales' | 'viewer' | 'reporter';

export type Profile = {
    id: string;
    user_id: string;
    name: string;
    email: string;
    role: UserRole;
    is_active: boolean;
    duties?: string[] | null; // 업무별 액션 권한(client.register/contract.approve/sheet.manage 등)
    sheet_categories?: string[] | null; // 담당 카테고리 시트(블로그/영상 등)
    must_change_password?: boolean | null; // 첫 로그인 시 비밀번호 변경 강제(초기 비번=아이디)
    client_id: string | null; // 고객 계정 → 본인 업체(clients.id). 내부 직원은 null.
    department: string | null;
    position: string | null;
    phone: string | null;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
};

export type SalesPerson = {
    id: string;
    profile_id: string | null;
    name: string;
    email: string | null;
    role: string | null;
    phone: string | null;
    commission_rate: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
};

export type Customer = {
    id: string;
    salesperson_id: string | null;

    company_name: string;
    source: string | null;
    contact_name: string | null;
    phone: string | null;
    main_phone: string | null;
    email: string | null;

    product: string | null;
    ad_budget: number;
    contract_amount: number;

    status: string;
    recent_history: string | null;
    next_contact_date: string | null;
    inquiry_date: string | null;

    contract_start_date: string | null;
    contract_end_date: string | null;

    memo: string | null;
    is_favorite: boolean;

    inquiry_content: string | null;
    kakao_name: string | null;
    business_type: string | null;
    region: string | null;
    priority: string | null;
    last_contacted_at: string | null;
    converted_at: string | null;

    deleted_at: string | null;
    created_at: string;
    updated_at: string;

    sales_people?: {
        name: string;
    } | null;
};

export type CustomerHistory = {
    id: string;
    customer_id: string;
    user_id: string | null;
    history_type: string;
    content: string;
    next_contact_date: string | null;
    contact_method: string | null;
    status_after: string | null;
    created_by_name: string | null;
    created_at: string;
};

export type Contract = {
    id: string;

    customer_id: string | null;
    salesperson_id: string | null;

    company_name: string;
    contact_name: string | null;
    phone: string | null;
    main_phone: string | null;
    email: string | null;

    payment_method: string;
    contract_type: string;

    contract_start_date: string | null;
    contract_end_date: string | null;

    total_contract_amount: number;
    total_paid_amount: number;
    outsourcing_cost: number;
    net_sales: number;

    payment_status: string;

    business_number: string | null;
    invoice_email: string | null;
    business_address: string | null;
    business_category: string | null;

    memo: string | null;

    deleted_at: string | null;
    deleted_by?: string | null;

    created_at: string;
    updated_at: string;

    sales_people?: {
        name: string;
    } | null;

    customers?: {
        company_name: string;
        contact_name: string | null;
        phone: string | null;
    } | null;
};

export type ContractProduct = {
    id: string;
    contract_id: string;

    product_name: string;
    product_type: string | null;
    quantity: number;
    unit_price: number;
    total_price: number;
    status: string;
    memo: string | null;

    created_at: string;
    updated_at: string;
};

export type Payment = {
    id: string;
    contract_id: string;

    payment_date: string | null;
    expected_payment_date: string | null;
    amount: number;
    payment_status: string;
    payment_method: string;
    payment_round: number;
    memo: string | null;

    deleted_at?: string | null;
    deleted_by?: string | null;

    created_at: string;
    updated_at: string;
};

export type ContractTask = {
    id: string;
    contract_id: string;
    customer_id: string | null;
    salesperson_id: string | null;

    task_title: string;
    task_type: string | null;
    task_status: string;
    priority: string;

    start_date: string | null;
    due_date: string | null;
    completed_at: string | null;

    assignee_name: string | null;
    reviewer_name: string | null;

    description: string | null;
    memo: string | null;

    deleted_at: string | null;

    created_at: string;
    updated_at: string;
};

export type Memo = {
    id: string;
    user_id: string | null;
    customer_id: string | null;
    contract_id: string | null;

    title: string | null;
    content: string;

    memo_type: string;
    color: string;

    is_pinned: boolean;
    is_done: boolean;

    deleted_at: string | null;

    created_at: string;
    updated_at: string;
};

export type ActivityLog = {
    id: string;
    user_id: string | null;

    action: string;
    target_table: string;
    target_id: string | null;

    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown> | null;

    description: string | null;

    created_at: string;
};

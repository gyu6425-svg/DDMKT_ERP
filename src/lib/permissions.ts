// 권한 모델 — 역할(등급) + duty(업무별 액션 권한). 워크플로 단계별 담당 분리.
//   role = 접근 등급(admin/manager/sales/viewer), duties = 부여된 세부 액션, sheetCategories = 담당 시트.
//   최종 계정: 어드민2 · 중간(manager)2 · 사원3(블로그1, 영상2[팀장·사원]) + 고객ERP(viewer).
import type { UserRole } from '../types';

// 업무별 액션 권한(duty).
export const DUTIES = {
    CLIENT_REGISTER: 'client.register', // 고객사 관리 등록(문의/신규)
    CONTRACT_APPROVE: 'contract.approve', // 계약완료 승인(고객사 → 계약 관리)
    CONTRACT_DOCS: 'contract.docs', // 계약서 관리
    PAYMENT_MANAGE: 'payment.manage', // 입금 관리
    OUTSOURCE_MANAGE: 'outsource.manage', // 외주비 관리
    SHEET_MANAGE: 'sheet.manage', // 카테고리 시트 승인/진행·기자단 관리(대상=sheetCategories)
    ACCOUNT_MANAGE: 'account.manage', // 계정/권한 관리
} as const;

export type Duty = (typeof DUTIES)[keyof typeof DUTIES];

export const DUTY_LABELS: Record<Duty, string> = {
    'client.register': '고객사 등록',
    'contract.approve': '계약완료 승인',
    'contract.docs': '계약서 관리',
    'payment.manage': '입금 관리',
    'outsource.manage': '외주비 관리',
    'sheet.manage': '카테고리 시트 관리',
    'account.manage': '계정·권한 관리',
};

// 권한 판정에 필요한 최소 정보.
export type Grant = {
    role: UserRole;
    duties: Duty[]; // 부여된 액션. 빈 배열 + admin = 전체 허용(슈퍼 어드민).
    sheetCategories: string[]; // 담당 카테고리 시트(블로그/영상 등). 빈 배열 + 권한 = 전체.
};

// 슈퍼 어드민 = admin 이면서 duty 제한이 없는 계정(전권).
const isSuper = (g: Grant) => g.role === 'admin' && g.duties.length === 0;

// 특정 액션 권한 보유 여부.
export function canDo(g: Grant, duty: Duty): boolean {
    if (g.role === 'viewer') return false; // 열람전용은 어떤 액션도 불가
    if (isSuper(g)) return true;
    return g.duties.includes(duty);
}

// 카테고리 시트(블로그/영상 등) 승인·진행 관리 가능 여부.
export function canManageSheet(g: Grant, category: string): boolean {
    if (g.role === 'viewer') return false;
    if (isSuper(g)) return true;
    if (!g.duties.includes(DUTIES.SHEET_MANAGE)) return false;
    return g.sheetCategories.length === 0 || g.sheetCategories.includes(category);
}

// 수정 가능 여부(뷰어=열람전용은 모든 수정 불가).
export function canEdit(g: Grant): boolean {
    return g.role !== 'viewer';
}

// ── 개발용 역할 시뮬레이터 ────────────────────────────────
//   auth 켜기 전(AUTH_DISABLED)까지, 각 역할을 전환하며 UI 게이팅을 테스트한다.
export type RolePreset = { key: string; label: string } & Grant;

const B = DUTIES;
export const ROLE_PRESETS: RolePreset[] = [
    { key: 'super', label: '슈퍼 어드민(전권)', role: 'admin', duties: [], sheetCategories: [] },
    {
        key: 'admin_reg',
        label: '어드민A · 고객 등록',
        role: 'admin',
        duties: [B.CLIENT_REGISTER, B.ACCOUNT_MANAGE],
        sheetCategories: [],
    },
    {
        key: 'admin_appr',
        label: '어드민B · 계약완료 승인',
        role: 'admin',
        duties: [B.CONTRACT_APPROVE, B.ACCOUNT_MANAGE],
        sheetCategories: [],
    },
    {
        key: 'mgr_docs',
        label: '중간A · 계약서·입금 (+플레이스/인스타/카페/쇼핑/파워링크 시트)',
        role: 'manager',
        duties: [B.CONTRACT_DOCS, B.PAYMENT_MANAGE, B.SHEET_MANAGE],
        sheetCategories: ['플레이스', '인스타', '카페', '쇼핑', '파워링크'],
    },
    {
        key: 'mgr_out',
        label: '중간B · 외주비 (+플레이스/인스타/카페/쇼핑/파워링크 시트)',
        role: 'manager',
        duties: [B.OUTSOURCE_MANAGE, B.SHEET_MANAGE],
        sheetCategories: ['플레이스', '인스타', '카페', '쇼핑', '파워링크'],
    },
    {
        key: 'sales_blog',
        label: '사원 · 블로그 시트',
        role: 'sales',
        duties: [B.SHEET_MANAGE],
        sheetCategories: ['블로그'],
    },
    {
        key: 'sales_video_lead',
        label: '영상 팀장 · 영상 시트',
        role: 'sales',
        duties: [B.SHEET_MANAGE],
        sheetCategories: ['영상'],
    },
    {
        key: 'sales_video',
        label: '영상 사원 · 영상 시트',
        role: 'sales',
        duties: [B.SHEET_MANAGE],
        sheetCategories: ['영상'],
    },
    { key: 'viewer', label: '고객 ERP · 열람전용', role: 'viewer', duties: [], sheetCategories: [] },
];

export const presetByKey = (key: string | null): RolePreset | null =>
    ROLE_PRESETS.find((p) => p.key === key) ?? null;

// 특정 계정만 허용 — 이메일 기준(직함 개념). 관리자페이지=대표·테스트, 금액표시=대표·테스트·조재현.
const emailIn = (email: string | null | undefined, list: string[]) =>
    list.includes((email || '').toLowerCase());
export const canSeeAdminPage = (email?: string | null) =>
    emailIn(email, ['rlawhddls@ddmkt.com', 'gyu6425@gmail.com']); // 김종인(대표), 장규진(테스트)
export const canSeeAmounts = (email?: string | null) =>
    emailIn(email, ['rlawhddls@ddmkt.com', 'gyu6425@gmail.com', 'ddmkt1@ddmkt.com']); // + 조재현

const SIM_KEY = 'erp_role_sim';
export function readRoleSim(): string | null {
    try {
        return localStorage.getItem(SIM_KEY);
    } catch {
        return null;
    }
}
export function writeRoleSim(key: string | null) {
    try {
        if (key) localStorage.setItem(SIM_KEY, key);
        else localStorage.removeItem(SIM_KEY);
    } catch {
        /* ignore */
    }
}

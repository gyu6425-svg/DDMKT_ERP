// 작업물 분류용 공용 카테고리(배너·블로그 공통). 배너 CATEGORY_PRESETS 의 id/name 과 동일.
export type WorkCategory = { id: string; name: string };

export const WORK_CATEGORIES: WorkCategory[] = [
    { id: 'education', name: '교육' },
    { id: 'medical', name: '의료' },
    { id: 'food', name: '음식' },
    { id: 'appliance', name: '가전' },
    { id: 'beauty', name: '뷰티' },
    { id: 'interior', name: '인테리어/부동산' },
    { id: 'fashion', name: '패션' },
    { id: 'service', name: '생활서비스' },
];

export function categoryLabel(id: string): string {
    return WORK_CATEGORIES.find((c) => c.id === id)?.name || '';
}

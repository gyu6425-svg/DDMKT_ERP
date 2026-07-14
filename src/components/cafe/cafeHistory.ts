// 카페 생성 히스토리(IndexedDB) — 생성할 때마다 저장, '저장' 탭에서 조회·재다운로드. 새로고침해도 유지.
export type CafeHistoryEntry = {
    id: string;
    at: number; // 생성 시각(ms)
    cardMode: 'default' | 'hero' | 'banner'; // banner = 테스트(배너) 탭(독립)
    bannerCount?: number; // 테스트(배너) 탭 — 생성한 AI 배너 장수(1~9)
    region: string;
    district: string;
    keyword: string;
    business: string;
    phone: string;
    tone: string;
    title: string;
    reviewBody: string;
    firstCard: string | null; // 첫 장 dataURL(1·마지막)
    fixedImages: string[]; // 2~N 고정 이미지 URL
};

import { openCafeDb } from './cafeDb';

const STORE = 'history';
const openDb = openCafeDb;

// 저장 실패를 조용히 삼키지 않고 던진다 — 호출부에서 "저장됨" 거짓 표시를 막기 위함.
export async function saveHistory(entry: CafeHistoryEntry): Promise<void> {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error);
    });
}

export async function listHistory(): Promise<CafeHistoryEntry[]> {
    try {
        const db = await openDb();
        return await new Promise((res) => {
            const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
            r.onsuccess = () => {
                const arr = (r.result as CafeHistoryEntry[]) || [];
                arr.sort((a, b) => b.at - a.at); // 최신순
                res(arr);
            };
            r.onerror = () => res([]);
        });
    } catch {
        return [];
    }
}

export async function delHistory(id: string): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((res) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(id);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
        });
    } catch {
        /* 무시 */
    }
}

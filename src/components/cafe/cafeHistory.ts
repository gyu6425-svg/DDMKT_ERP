// 카페 생성 히스토리(IndexedDB) — 생성할 때마다 저장, '저장' 탭에서 조회·재다운로드. 새로고침해도 유지.
export type CafeHistoryEntry = {
    id: string;
    at: number; // 생성 시각(ms)
    cardMode: 'default' | 'hero';
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

const DB_NAME = 'ddmkt-cafe';
const STORE = 'history';

function openDb(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
        // cardCache와 같은 DB지만 버전 올려 history 스토어 추가.
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('first-cards')) db.createObjectStore('first-cards');
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}

export async function saveHistory(entry: CafeHistoryEntry): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((res) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(entry);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
        });
    } catch {
        /* 저장 실패 무시 */
    }
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

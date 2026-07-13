// 지역별 첫 장 카드 캐시(IndexedDB) — 같은 조건(지역·전화 등)은 재생성 없이 재사용 → 이미지 비용 0.
//   새로고침·재접속해도 유지(브라우저 로컬). 값 = 카드 이미지 dataURL. 키 = 카드 조건 문자열.
import { openCafeDb } from './cafeDb';

const STORE = 'first-cards';
const openDb = openCafeDb;

export async function getCachedCard(key: string): Promise<string | null> {
    try {
        const db = await openDb();
        return await new Promise((res) => {
            const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            r.onsuccess = () => res((r.result as string) ?? null);
            r.onerror = () => res(null);
        });
    } catch {
        return null;
    }
}

export async function setCachedCard(key: string, dataUrl: string): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((res) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(dataUrl, key);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
        });
    } catch {
        /* 캐시는 부가기능 — 실패해도 무시 */
    }
}

export async function delCachedCard(key: string): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((res) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => res();
            tx.onerror = () => res();
        });
    } catch {
        /* 무시 */
    }
}

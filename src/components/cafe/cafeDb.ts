// 카페 생성기 공용 IndexedDB — 첫 장 캐시('first-cards') + 생성 히스토리('history').
//   두 스토어를 한 곳에서 관리해 버전 경합/스토어 누락을 방지한다.
//   과거 v1 DB('first-cards'만 존재)가 남아 있으면 v2 업그레이드가 다른 탭에 blocked돼
//   'history' 스토어가 안 생긴 채로 열리는 사례가 있었음 → v3로 올려 두 스토어를 강제 보장 + 자가치유.
const DB_NAME = 'ddmkt-cafe';
const DB_VERSION = 3;

function ensureStores(db: IDBDatabase) {
    if (!db.objectStoreNames.contains('first-cards')) db.createObjectStore('first-cards');
    if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' });
}

export function openCafeDb(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => ensureStores(req.result);
        // 다른 탭이 옛 버전 커넥션을 잡고 있어 업그레이드가 막히면 무한 대기 대신 실패로 알림.
        req.onblocked = () => rej(new Error('IndexedDB 업그레이드 차단 — 이 사이트의 다른 탭을 닫고 새로고침하세요.'));
        req.onsuccess = () => {
            const db = req.result;
            // 두 스토어가 모두 있으면 정상. 하나라도 없으면(옛 DB 잔존) 버전을 올려 강제 재생성.
            if (db.objectStoreNames.contains('first-cards') && db.objectStoreNames.contains('history')) {
                res(db);
                return;
            }
            const nextV = db.version + 1;
            db.close();
            const req2 = indexedDB.open(DB_NAME, nextV);
            req2.onupgradeneeded = () => ensureStores(req2.result);
            req2.onblocked = () => rej(new Error('IndexedDB 스토어 복구 차단 — 다른 탭을 닫고 새로고침하세요.'));
            req2.onsuccess = () => res(req2.result);
            req2.onerror = () => rej(req2.error);
        };
        req.onerror = () => rej(req.error);
    });
}

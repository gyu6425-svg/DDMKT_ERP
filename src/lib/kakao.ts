// 카카오 JavaScript SDK 로더 + 공유 헬퍼.
//   '바로 카톡' = OS 공유창 없이 카카오톡 채팅방 선택창이 바로 뜨게 한다.
//   필요: 카카오 개발자센터(developers.kakao.com)에서 ① 앱 생성 → ② JavaScript 키 발급 →
//         ③ [플랫폼 > Web] 사이트 도메인에 https://ddmkt-erp.pages.dev (및 로컬테스트면 http://localhost:5173) 등록.
//   아래 KAKAO_JS_KEY 에 그 JavaScript 키를 넣으면 활성화. 비어 있으면 기존 공유(navigator.share/복사)로 자동 폴백.
export const KAKAO_JS_KEY = 'b6992ad148e994c2022d648fdb386ca8'; // 카카오 JavaScript 키(도메인 등록: ddmkt-erp.pages.dev)

type KakaoSDK = {
    isInitialized: () => boolean;
    init: (key: string) => void;
    Share: { sendDefault: (o: unknown) => void };
};

declare global {
    interface Window {
        Kakao?: KakaoSDK;
    }
}

export function kakaoEnabled(): boolean {
    return !!KAKAO_JS_KEY;
}

let ready: Promise<KakaoSDK> | null = null;

function loadKakao(): Promise<KakaoSDK> {
    if (!KAKAO_JS_KEY) return Promise.reject(new Error('no kakao key'));
    if (ready) return ready;
    ready = new Promise<KakaoSDK>((resolve, reject) => {
        const finish = () => {
            const k = window.Kakao;
            if (!k) return reject(new Error('kakao sdk missing'));
            try {
                if (!k.isInitialized()) k.init(KAKAO_JS_KEY);
                resolve(k);
            } catch (e) {
                reject(e as Error);
            }
        };
        if (window.Kakao) return finish();
        const s = document.createElement('script');
        s.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js';
        s.crossOrigin = 'anonymous';
        s.onload = finish;
        s.onerror = () => reject(new Error('kakao sdk load fail'));
        document.head.appendChild(s);
    });
    return ready;
}

// 텍스트 + 링크를 카카오톡으로 바로 공유(채팅방 선택창이 즉시 뜸). 성공 true, 미설정/실패 false(폴백용).
export async function shareKakaoText(text: string, linkUrl: string): Promise<boolean> {
    if (!KAKAO_JS_KEY) return false;
    try {
        const Kakao = await loadKakao();
        Kakao.Share.sendDefault({
            objectType: 'text',
            text,
            link: { mobileWebUrl: linkUrl || undefined, webUrl: linkUrl || undefined },
        });
        return true;
    } catch {
        return false;
    }
}

// 보고서 카드(피드) 공유 — 제목/설명/이미지 + '보고서 열기' 버튼.
export async function shareKakaoFeed(args: {
    title: string;
    description: string;
    imageUrl: string;
    linkUrl: string;
}): Promise<boolean> {
    if (!KAKAO_JS_KEY) return false;
    try {
        const Kakao = await loadKakao();
        Kakao.Share.sendDefault({
            objectType: 'feed',
            content: {
                title: args.title,
                description: args.description,
                imageUrl: args.imageUrl,
                link: { mobileWebUrl: args.linkUrl, webUrl: args.linkUrl },
            },
            buttons: [{ title: '보고서 열기', link: { mobileWebUrl: args.linkUrl, webUrl: args.linkUrl } }],
        });
        return true;
    } catch {
        return false;
    }
}

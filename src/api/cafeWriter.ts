import type { CafeContent } from '../components/cafe/cafeContent';

// 카페 원고 자동생성 클라이언트 — /api/generate-cafe 호출. 반환 content = Partial<CafeContent>.

export type CafeTokenUsage = {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    [key: string]: unknown;
};

export type GenerateCafeInput = {
    keyword: string;
    region?: string;
    brand?: string;
    branch?: string;
    phone?: string;
    business?: string;
    signal?: AbortSignal;
};

export type GenerateCafeResult = {
    content: Partial<CafeContent>;
    prompt: string;
    usage?: CafeTokenUsage | null;
};

function getUrl() {
    return import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe' : '/api/generate-cafe';
}

function getEditUrl() {
    return import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe-edit' : '/api/generate-cafe-edit';
}

// 원본 이미지 글자 교체(실험) — 업로드한 완성 카드 이미지에서 텍스트만 Gemini로 교체.
export async function editCafeImage(input: {
    image: string;
    region?: string;
    keyword?: string;
    phone?: string;
    services?: string;
    signal?: AbortSignal;
}): Promise<string> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    if (input.signal) {
        if (input.signal.aborted) controller.abort();
        else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const res = await fetch(getEditUrl(), {
            body: JSON.stringify({
                image: input.image,
                keyword: input.keyword,
                phone: input.phone,
                region: input.region,
                services: input.services,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const text = await res.text();
        let data: { imageDataUrl?: string; message?: string } = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('편집 응답을 해석하지 못했습니다(로컬은 api:dev 실행 확인).');
            }
        }
        if (!res.ok) throw new Error(data.message || '이미지 편집에 실패했습니다.');
        if (!data.imageDataUrl) throw new Error('편집된 이미지가 없습니다.');
        return data.imageDataUrl;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('이미지 편집이 중단되었습니다(최대 2분 초과 또는 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

// 공통 POST — mode/content 에 따라 카드 원고 또는 후기 본문 생성.
async function postCafe(
    body: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 120000);
    if (signal) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const response = await fetch(getUrl(), {
            body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const responseText = await response.text();
        let result: Record<string, unknown> & { message?: string } = {};
        if (responseText) {
            try {
                result = JSON.parse(responseText);
            } catch {
                throw new Error(
                    response.ok
                        ? '원고 응답을 해석하지 못했습니다.'
                        : '원고 API 응답을 해석하지 못했습니다. 로컬 API 서버(npm run api:dev)가 실행 중인지 확인하세요.',
                );
            }
        }
        if (!response.ok) throw new Error(result?.message || '원고 생성에 실패했습니다.');
        return result;
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('원고 생성이 중단되었습니다(최대 2분 초과 또는 사용자 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

export async function generateCafe(input: GenerateCafeInput): Promise<GenerateCafeResult> {
    const result = await postCafe(
        {
            brand: input.brand,
            branch: input.branch,
            business: input.business,
            keyword: input.keyword,
            phone: input.phone,
            region: input.region,
        },
        input.signal,
    );
    if (!result.content) throw new Error('생성된 원고가 없습니다.');
    return result as GenerateCafeResult;
}

export type GenerateCafeReviewResult = { title: string; reviewBody: string; topics?: string[]; usage?: CafeTokenUsage | null; model?: string | null; check?: { ok: boolean; problems: string[] } | null };

// 인기글 필터 — 브라우저는 CORS 로 네이버를 못 부르므로 로컬 서버(:8787)가 대신 검사한다.
export type PopularReason = 'ok' | 'no_popular' | 'no_review_block' | 'serp_fetch_failed';
export async function checkPopular(keyword: string, signal?: AbortSignal): Promise<{ hasPopular: boolean; reason: PopularReason }> {
    const url = import.meta.env.DEV ? 'http://127.0.0.1:8787/api/cafe-popular-check' : '/api/cafe-popular-check';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword }),
        signal,
    });
    if (!res.ok) throw new Error(`인기글 검사 실패(${res.status})`);
    const d = await res.json();
    return { hasPopular: !!d.hasPopular, reason: d.reason as PopularReason };
}

// GPT 카드 이미지 1장 생성 — 지역/제목/전화/서비스 + 참고사진(refs). 레퍼런스 무드로 렌더.
export async function generateCafeCard(input: {
    region?: string;
    district?: string;
    topic?: string;
    phone?: string;
    services?: string;
    refs?: string[];
    mode?: 'fixed' | 'hero';
    quality?: 'low' | 'medium' | 'high'; // 이미지 화질(비용) — 서버 기본 high. low≈$0.01/medium≈$0.04/high≈$0.16.
    model?: 'gpt-5.5' | 'gpt-5-mini'; // 오케스트레이션 모델(A/B용). 미지정 시 서버 기본 gpt-5.5.
    signal?: AbortSignal;
}): Promise<{ imageDataUrl: string; usage: Record<string, unknown> | null; model: string }> {
    const url = import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-cafe-card' : '/api/generate-cafe-card';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 240000); // 이미지 생성은 오래 걸림
    if (input.signal) {
        if (input.signal.aborted) controller.abort();
        else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const res = await fetch(url, {
            body: JSON.stringify({
                district: input.district,
                mode: input.mode,
                model: input.model,
                phone: input.phone,
                quality: input.quality,
                refs: input.refs,
                region: input.region,
                services: input.services,
                topic: input.topic,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const text = await res.text();
        let data: { imageDataUrl?: string; message?: string; usage?: Record<string, unknown> | null; model?: string } = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('카드 응답을 해석하지 못했습니다(로컬은 api:dev 실행 확인).');
            }
        }
        if (!res.ok) throw new Error(data.message || '카드 생성에 실패했습니다.');
        if (!data.imageDataUrl) throw new Error('생성된 카드가 없습니다.');
        return { imageDataUrl: data.imageDataUrl, model: data.model ?? 'gpt-5.5', usage: data.usage ?? null };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('카드 생성이 중단되었습니다(최대 4분 초과 또는 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

// 보안업체(더맨시스템) 배너 — 지역·보안종류·제목(3줄) → 하단 3개 자동(프리셋/AI) + 저화질 이미지 1장.
//   반환 usage 2종(textUsage=하단3개 AI생성 시만, imageUsage=이미지 요청 텍스트 토큰) → 프론트가 정확 비용 산출.
export type SecurityBannerItem = { title: string; subtitle: string; icon: string };
export async function generateSecurityBanner(input: {
    region: string;
    secType: string;
    titleLines: string[];
    quality?: 'low' | 'medium' | 'high';
    style?: 'green' | 'blue';
    items?: SecurityBannerItem[]; // 하단 3개 직접 입력(선택). 3개 채우면 자동/프리셋 대신 이걸 사용.
    model?: 'gpt-5.5' | 'gpt-5-mini'; // 오케스트레이션 모델(A/B용). 미지정 시 서버 기본 gpt-5.5.
    signal?: AbortSignal;
}): Promise<{
    imageDataUrl: string;
    items: SecurityBannerItem[];
    source: 'preset' | 'ai' | 'manual';
    textUsage: Record<string, unknown> | null;
    imageUsage: Record<string, unknown> | null;
    model: string;
}> {
    const url = import.meta.env.DEV ? 'http://127.0.0.1:8787/api/generate-security-banner' : '/api/generate-security-banner';
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 240000);
    if (input.signal) {
        if (input.signal.aborted) controller.abort();
        else input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    try {
        const res = await fetch(url, {
            body: JSON.stringify({
                items: input.items,
                model: input.model,
                quality: input.quality,
                region: input.region,
                secType: input.secType,
                style: input.style,
                titleLines: input.titleLines,
            }),
            headers: { 'Content-Type': 'application/json' },
            method: 'POST',
            signal: controller.signal,
        });
        const text = await res.text();
        let data: {
            imageDataUrl?: string;
            items?: SecurityBannerItem[];
            source?: 'preset' | 'ai' | 'manual';
            textUsage?: Record<string, unknown> | null;
            imageUsage?: Record<string, unknown> | null;
            model?: string;
            message?: string;
        } = {};
        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error('배너 응답을 해석하지 못했습니다(로컬은 api:dev 실행 확인).');
            }
        }
        if (!res.ok) throw new Error(data.message || '보안 배너 생성에 실패했습니다.');
        if (!data.imageDataUrl) throw new Error('생성된 배너가 없습니다.');
        return {
            imageDataUrl: data.imageDataUrl,
            items: data.items ?? [],
            source: data.source ?? 'preset',
            textUsage: data.textUsage ?? null,
            imageUsage: data.imageUsage ?? null,
            model: data.model ?? 'gpt-5.5',
        };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error('배너 생성이 중단되었습니다(최대 4분 초과 또는 취소).', { cause: error });
        }
        throw error;
    } finally {
        window.clearTimeout(timeoutId);
    }
}

// 후기성 카페 본문 생성 — 현재 카드 콘텐츠(content)를 소재로 후기/경험 형식 글 + 「사진 N」 마커.
export type CafeReviewTone = 'review' | 'info' | 'story' | 'talk' | 'notice';

export async function generateCafeReview(
    input: GenerateCafeInput & {
        content: Partial<CafeContent>;
        tone?: CafeReviewTone;
        count?: number;
        layout?: 'markers' | 'bottom';
        variant?: 'info-guide';   // 더맨시스템 정보형 — 서버가 별도 프롬프트를 탄다
        facts?: string[];         // 자격·허가 등 '확인된 사실'. 비면 모델이 자격 서술을 못 한다.
    },
): Promise<GenerateCafeReviewResult> {
    const result = await postCafe(
        {
            brand: input.brand,
            branch: input.branch,
            business: input.business,
            content: input.content,
            count: input.count,
            facts: input.facts,
            keyword: input.keyword,
            layout: input.layout,
            mode: 'review',
            phone: input.phone,
            region: input.region,
            tone: input.tone || 'review',
            variant: input.variant,
        },
        input.signal,
    );
    if (result.reviewBody == null) throw new Error('생성된 본문이 없습니다.');
    return result as GenerateCafeReviewResult;
}

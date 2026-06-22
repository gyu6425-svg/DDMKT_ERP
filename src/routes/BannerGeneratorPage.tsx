import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { removeBackground } from '@imgly/background-removal';
import { generateAiCardImage } from '../api/aiCardImage';
import { logApiUsage } from '../api/apiUsage';
import {
    getBannerOperators,
    getBannerOutputImage,
    getBannerOutputs,
    saveBannerOutput,
    type BannerOutput,
} from '../api/bannerOutputs';
import { computeRecordCostUsd, formatKrw, formatUsd } from '../lib/apiPricing';
import { useAuth } from '../hooks/useAuth';
import Button from '../components/Button';

const CANVAS_SIZE = 1254;
const fontFamily = 'Pretendard, "Malgun Gothic", Arial, sans-serif';

type TemplateId = 'template-1' | 'template-2' | 'template-3' | 'template-4';
type LayoutVariant = 'education' | 'product' | 'photo' | 'compact' | 'chalkboard' | 'playful';
type BannerSizeId = 'square' | 'bottom';

export type BannerSize = {
    height: number;
    id: BannerSizeId;
    label: string;
    name: string;
    width: number;
};

const bannerSizes: BannerSize[] = [
    { height: 1080, id: 'square', label: '1080 x 1080', name: '정사각형', width: 1080 },
    { height: 941, id: 'bottom', label: '1672 x 941', name: '하단배너', width: 1672 },
];

type BannerTemplate = {
    aiDirection: string;
    disabled?: boolean;
    id: TemplateId;
    layoutVariant?: LayoutVariant;
    name: string;
    category: string;
    description: string;
};

export type BannerForm = {
    title: string;
    subtitle: string;
    emphasis: string;
    badge: string;
    cta: string;
    backgroundColor: string;
    accentColor: string;
    textColor: string;
    layoutVariant: LayoutVariant;
};

type ImageMeta = {
    width: number;
    height: number;
};

type LogoAsset = {
    dataUrl: string;
    image: HTMLImageElement;
    name: string;
};

type AiGenerationHistoryItem = {
    id: string;
    badge: string;
    createdAt: string;
    imageDataUrl?: string;
    message: string;
    prompt?: string;
    status: 'loading' | 'success' | 'error';
    title: string;
};

type CardNewsPage = {
    bannerSizeId: BannerSizeId;
    form: BannerForm;
    id: string;
    imageDataUrls: string[];
    imageMetas: Array<ImageMeta | null>;
    imageUrls: string[];
    rawText: string;
    resultImageUrl: string;
    status: 'idle' | 'loading' | 'success' | 'error';
    statusMessage: string;
};

type ImageProvider = 'gemini' | 'openai';
type ImageQuality = 'low' | 'medium' | 'high';

const templates: BannerTemplate[] = [
    {
        aiDirection:
            'Template 1: Choose the best card-news visual style automatically based on the copy and uploaded image.',
        id: 'template-1',
        name: '템플릿 1',
        category: '기본 카드형',
        description: '이미지와 원고를 분석해 가장 적절한 레이아웃을 자동으로 구성합니다.',
    },
    {
        aiDirection:
            'Template 2: Use a clean editorial illustration style. Use flat vector-like illustrations, soft icons, simple character or object illustrations, bright whitespace, and friendly Korean card-news composition. Avoid photorealism and heavy 3D rendering.',
        id: 'template-2',
        layoutVariant: 'playful',
        name: '템플릿 2',
        category: '일러스트형',
        description: '부드러운 일러스트, 아이콘, 여백 중심의 카드뉴스 스타일로 구성합니다.',
    },
    {
        aiDirection:
            'Template 3: Use a polished 3D visual style. Create soft 3D objects, dimensional icons, rounded forms, studio lighting, subtle shadows, and modern product-card composition. Avoid flat vector illustration and raw photography.',
        id: 'template-3',
        layoutVariant: 'product',
        name: '템플릿 3',
        category: '3D 오브젝트형',
        description: '입체 오브젝트와 부드러운 조명 중심의 3D 카드뉴스 스타일로 구성합니다.',
    },
    {
        aiDirection: '',
        disabled: true,
        id: 'template-4',
        layoutVariant: 'product',
        name: '템플릿 4',
        category: '기존 작업형',
        description: '제작했던 작업물을 저장할 공간입니다. 추후 활성화 예정입니다.',
    },
];

const defaultForm: BannerForm = {
    title: '',
    subtitle: '',
    emphasis: '',
    badge: '',
    cta: '',
    backgroundColor: '#f6f8fc',
    accentColor: '#1457ff',
    textColor: '#081b44',
    layoutVariant: 'education',
};

function createCardNewsPage(
    index: number,
    baseForm: BannerForm = defaultForm,
    bannerSizeId: BannerSizeId = 'square',
): CardNewsPage {
    return {
        bannerSizeId,
        form: {
            ...baseForm,
            title: '',
            subtitle: '',
            emphasis: '',
            cta: '',
        },
        id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        imageDataUrls: ['', ''],
        imageMetas: [null, null],
        imageUrls: ['', ''],
        rawText: '',
        resultImageUrl: '',
        status: 'idle',
        statusMessage: '대기 중',
    };
}

function getSeriesLayoutVariant(pages: CardNewsPage[]) {
    return (
        pages.find((page) => page.rawText.trim())?.form.layoutVariant ||
        pages[0]?.form.layoutVariant ||
        'education'
    );
}

function normalizeSeriesLayout(pages: CardNewsPage[]) {
    if (pages.length <= 1) {
        return pages;
    }

    const layoutVariant = getSeriesLayoutVariant(pages);

    return pages.map((page) => ({
        ...page,
        form: {
            ...page.form,
            layoutVariant,
        },
    }));
}

function applyTemplateLayout(pages: CardNewsPage[], template?: BannerTemplate) {
    if (!template?.layoutVariant) {
        return pages;
    }

    const layoutVariant = template.layoutVariant;

    return pages.map((page) => ({
        ...page,
        form: {
            ...page.form,
            layoutVariant,
        },
    }));
}

const layoutLabels: Record<LayoutVariant, string> = {
    education: '교육/브랜드형',
    product: '제품 홍보형',
    photo: '사진 중심형',
    compact: '간격 강조형',
    chalkboard: '칠판 교육형',
    playful: '퀴즈/상담형',
};

const colorPresets = [
    {
        accentColor: '#1457ff',
        backgroundColor: '#f6f8fc',
        textColor: '#081b44',
    },
    {
        accentColor: '#0f9f6e',
        backgroundColor: '#f0fdf4',
        textColor: '#102a43',
    },
    {
        accentColor: '#d20f18',
        backgroundColor: '#fff7ed',
        textColor: '#111827',
    },
    {
        accentColor: '#7c3aed',
        backgroundColor: '#faf5ff',
        textColor: '#1f2937',
    },
    {
        accentColor: '#b45309',
        backgroundColor: '#fffbeb',
        textColor: '#222222',
    },
];

// 업종(카테고리)별 무드 프리셋. 드롭다운에서 선택하면 (1) 색 팔레트를 폼에 적용하고
// (2) directive(영문 무드 지시)를 프롬프트의 [업종·분위기] 블록으로 주입한다.
// directive는 색감/이미지 무드에만 반영되며, 이미지에 글자로 렌더되지 않도록 프롬프트에서 명시한다.
// 템플릿=어떻게 보이나(렌더 스타일), 카테고리=무엇에 관한가(업종 무드+색).
export type BannerCategory = {
    id: string;
    name: string;
    directive: string;
    palette: { backgroundColor: string; accentColor: string; textColor: string };
};

const CATEGORY_PRESETS: BannerCategory[] = [
    {
        id: 'education',
        name: '교육',
        directive:
            'Education & learning brand mood: trustworthy, clean and academic. Cool blue/teal palette, crisp geometric sans typography feel, subtle book/pencil/graduation motifs only as light decoration.',
        palette: { backgroundColor: '#eef4ff', accentColor: '#1d4ed8', textColor: '#0f1f3d' },
    },
    {
        id: 'medical',
        name: '의료',
        directive:
            'Healthcare & clinic mood: calm, clean, hygienic and reassuring. Soft sky-blue and white with a touch of mint, gentle rounded shapes, cross/heart/shield motifs as light accents. Warm but professional, never cold.',
        palette: { backgroundColor: '#f0f8ff', accentColor: '#0ea5e9', textColor: '#0b2540' },
    },
    {
        id: 'food',
        name: '음식',
        directive:
            'Food & beverage mood: warm, appetizing and inviting. Cream, warm orange and deep red tones, cozy lighting feel, fresh ingredient or steam motifs as light decoration. Make it look delicious.',
        palette: { backgroundColor: '#fff5ea', accentColor: '#ea580c', textColor: '#4a2a17' },
    },
    {
        id: 'appliance',
        name: '가전',
        directive:
            'Home appliance & electronics mood: modern, sleek and high-tech. Cool neutral grays with one crisp accent, clean product-spotlight lighting, minimal premium look.',
        palette: { backgroundColor: '#f4f5f7', accentColor: '#2563eb', textColor: '#111827' },
    },
    {
        id: 'beauty',
        name: '뷰티',
        directive:
            'Beauty & cosmetics mood: elegant, soft and premium. Blush pink, rose and champagne-gold tones, refined airy composition, glossy/silky texture feel.',
        palette: { backgroundColor: '#fdf2f4', accentColor: '#db2777', textColor: '#3b1f2b' },
    },
    {
        id: 'interior',
        name: '인테리어/부동산',
        directive:
            'Interior & real estate mood: warm, sophisticated and spacious. Natural beige, warm wood and muted earth tones, clean architectural feel, soft natural light.',
        palette: { backgroundColor: '#f6f1ea', accentColor: '#b45309', textColor: '#2a2118' },
    },
    {
        id: 'fashion',
        name: '패션',
        directive:
            'Fashion & apparel mood: chic, bold and editorial. High-contrast monochrome with one striking accent, magazine-like minimal typography feel, confident and stylish.',
        palette: { backgroundColor: '#f5f5f5', accentColor: '#111111', textColor: '#111111' },
    },
    {
        id: 'service',
        name: '생활서비스',
        directive:
            'Local home-service mood (repair, cleaning, leak detection, moving): reliable, fast and reassuring. Confident blue with a strong action accent, bold clear typography feel, clean trustworthy look.',
        palette: { backgroundColor: '#eef5ff', accentColor: '#1457ff', textColor: '#0b1f44' },
    },
];

// 생성할 때마다 랜덤으로 하나를 골라 프롬프트에 주입하는 레이아웃 아키타입 풀.
// 다양성은 레이아웃/구성/장식에만 적용하고 색상·문구는 입력값을 유지한다.
// 전문적이고 깔끔한 가로형 레이아웃만 사용(세로 텍스트·조잡한 구성 유발 프리셋 제거).
// 모든 한글은 가로쓰기 전제. 강조 문구는 포인트 컬러 하이라이트 박스(알약형)에.
const STYLE_PRESETS: string[] = [
    'Left editorial: a strong left-aligned bold Korean headline, concise supporting copy below it, and one clean relevant photo or simple graphic balanced on the right. Generous margins, clear hierarchy, modern and professional.',
    'Bold hero: a large bold Korean headline in the upper-left, short supporting copy beneath, and a clean relevant photo on one side. Lots of clean whitespace, crisp and premium.',
    'Top headline + highlight: a large bold headline across the top, supporting copy below, and the key emphasis phrase inside a colored rounded highlight pill; one clean photo to a side. Modern editorial look.',
    'Diagonal split: a soft diagonal band separates a bold headline area from a clean photo/graphic area; crisp, modern, not busy.',
    'Big visual focus: one clean dominant photo or object on one side, a bold headline and short copy on the other side; modern, spacious editorial layout.',
    'Airy minimal: very spacious, a bold but compact headline, lots of clean negative space, and a single subtle accent shape; premium and modern.',
    'Question and highlight: pose the headline at the top, then place the key emphasis phrase inside a colored rounded highlight box (pill) for punch; clean, professional, balanced.',
];

function pickRandomStylePreset() {
    return STYLE_PRESETS[Math.floor(Math.random() * STYLE_PRESETS.length)];
}

function normalizeCopyText(text: string) {
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .join('\n')
        .trim();
}

function splitCopyBlocks(text: string) {
    return normalizeCopyText(text)
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((block) =>
            block
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .join('\n'),
        );
}

function splitCopySegments(text: string) {
    const blocks = splitCopyBlocks(text);
    const segments = blocks.flatMap((block) => {
        const normalizedBlock = block.replace(/\s+(\d+[.)]\s*)/g, '\n$1');
        const lines = normalizedBlock
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        if (lines.length > 1) {
            return lines;
        }

        return normalizedBlock
            .split(/(?<=[.!?])\s+|[|]/)
            .map((segment) => segment.trim())
            .filter(Boolean);
    });

    return Array.from(new Set(segments));
}

function scoreTitleSegment(segment: string, index: number) {
    let score = Math.max(0, 8 - index);
    const length = segment.length;

    if (length >= 12 && length <= 34) {
        score += 6;
    }

    if (/선택|기준|이유|방법|소개|추천|필수|상담|왜|무엇|차이/.test(segment)) {
        score += 4;
    }

    if (/무료|할인|혜택|이벤트|한정|문의|상담|예약|신청/.test(segment)) {
        score -= 3;
    }

    if (length > 48) {
        score -= 4;
    }

    return score;
}

function scoreEmphasisSegment(segment: string, index: number, total: number) {
    let score = index === total - 1 ? 3 : 0;

    if (
        /무료|할인|혜택|이벤트|한정|특전|증정|쿠폰|최대|마감|기간|오늘|이번|상담|예약|신청|문의/.test(
            segment,
        )
    ) {
        score += 8;
    }

    if (/\d+\s*(%|만\s*원|명|개월|주|일)/.test(segment)) {
        score += 5;
    }

    if (/결과|차이|인증|전문|1등|상위|검증|보장|후기|만족|성공/.test(segment)) {
        score += 4;
    }

    if (segment.length <= 24) {
        score += 3;
    }

    if (segment.length > 46) {
        score -= 3;
    }

    return score;
}

function pickBestSegment(
    segments: string[],
    scorer: (segment: string, index: number, total: number) => number,
    excludedSegments: Set<string> = new Set(),
) {
    return segments
        .map((segment, index) => ({
            index,
            score: excludedSegments.has(segment)
                ? Number.NEGATIVE_INFINITY
                : scorer(segment, index, segments.length),
            segment,
        }))
        .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.segment;
}

function isQuestionSegment(segment: string) {
    return /[?？]$|까$|나요$|을까$|무엇일까$/.test(segment.trim());
}

function isNumberedListSegment(segment: string) {
    return /^\d+[.)]\s*/.test(segment.trim());
}

function normalizeConditionLabel(text: string) {
    const hasDiabetes = /당뇨/.test(text);
    const hasHypertension = /고혈압/.test(text);

    if (hasDiabetes && hasHypertension) {
        return '당뇨·고혈압';
    }

    if (hasDiabetes) {
        return '당뇨';
    }

    if (hasHypertension) {
        return '고혈압';
    }

    return '건강';
}

function analyzeClinicalTrialCopy(text: string) {
    if (!/임상시험|연구/.test(text) || !/당뇨|고혈압|질환|환자/.test(text)) {
        return null;
    }

    const segments = splitCopySegments(text);
    const numberedSegments = segments.filter(isNumberedListSegment);
    const introSegment =
        segments.find(
            (segment) =>
                !isQuestionSegment(segment) && /진행 중|진행중|모집|참여|대상|임상시험|연구/.test(segment),
        ) || '';
    const eligibilitySegment =
        segments.find(
            (segment) =>
                /참여 가능|대상|성인|조건|기준/.test(segment) &&
                !isNumberedListSegment(segment) &&
                !/자세한 기준|확인 가능/.test(segment),
        ) || '';
    const conditionLabel = normalizeConditionLabel(text);
    const title = `현재 진행 중인\n${conditionLabel} 관련 임상시험`;
    const subtitleSegments = [
        introSegment,
        ...numberedSegments.slice(0, 3),
        numberedSegments.length === 0 ? eligibilitySegment : '',
    ].filter(Boolean);

    return {
        emphasis: eligibilitySegment || '자세한 참여 기준은 메디25에서 확인 가능',
        subtitle: subtitleSegments.join('\n'),
        title,
    };
}

function analyzeCopyText(text: string) {
    const clinicalTrialCopy = analyzeClinicalTrialCopy(text);

    if (clinicalTrialCopy) {
        return clinicalTrialCopy;
    }

    const blocks = splitCopyBlocks(text);
    const segments = splitCopySegments(text);
    const firstBlock = blocks[0] || segments[0] || '';
    const title =
        pickBestSegment(
            segments,
            (segment, index, total) =>
                scoreTitleSegment(segment, index) -
                (isQuestionSegment(segment) && total > 1 ? 3 : 0),
        ) ||
        firstBlock;
    const excludedSegments = new Set([title]);
    const emphasis =
        pickBestSegment(
            segments,
            (segment, index, total) => scoreEmphasisSegment(segment, index, total),
            excludedSegments,
        ) || '';

    if (emphasis) {
        excludedSegments.add(emphasis);
    }

    const subtitleSegments = segments
        .filter((segment) => !excludedSegments.has(segment))
        .filter((segment) => !/문의|상담|예약|신청하기|전화/.test(segment))
        .sort((a, b) => Number(isNumberedListSegment(b)) - Number(isNumberedListSegment(a)))
        .slice(0, 3);

    return {
        emphasis,
        subtitle: subtitleSegments.join('\n'),
        title,
    };
}

function inferCta(text: string) {
    if (/문의|상담|전화|예약/.test(text)) {
        return '상담 문의';
    }

    if (/구매|제품|서비스|설치|견적|냉장고|오븐|믹서|기계/.test(text)) {
        return '제품 문의';
    }

    if (/수업|학원|성적|영어|입시|강사/.test(text)) {
        return '수업 상담';
    }

    return '';
}

function inferLayoutVariant(text: string, imageMeta: ImageMeta | null): LayoutVariant {
    const normalizedText = normalizeCopyText(text);
    const lineCount = normalizedText.split('\n').filter(Boolean).length;
    const imageRatio = imageMeta ? imageMeta.width / imageMeta.height : 1;

    if (/엄마|부모|아이|영어|육아|감정|상담|발달|대상|어린이/.test(normalizedText)) {
        return 'playful';
    }

    if (/교육|전문가|지도|소개|시스템|학원|인증/.test(normalizedText)) {
        return 'chalkboard';
    }

    if (/제품|서비스|전화|견적|구매|냉장고|오븐|믹서|기계|설치/.test(normalizedText)) {
        return 'product';
    }

    if (/인테리어|시공|공간|리모델링|포트폴리오|현장|아파트|상가/.test(normalizedText)) {
        return 'photo';
    }

    if (imageRatio > 1.28) {
        return 'photo';
    }

    if (lineCount <= 4) {
        return 'compact';
    }

    return 'education';
}

function inferColors(text: string, layoutVariant: LayoutVariant) {
    if (layoutVariant === 'chalkboard') {
        return {
            backgroundColor: '#2d633b',
            accentColor: '#ffb703',
            textColor: '#ffffff',
        };
    }

    if (layoutVariant === 'playful') {
        return {
            backgroundColor: '#ffda8a',
            accentColor: '#ff9f1c',
            textColor: '#222222',
        };
    }

    if (layoutVariant === 'product') {
        return {
            backgroundColor: '#f7f7f8',
            accentColor: '#d20f18',
            textColor: '#111827',
        };
    }

    if (layoutVariant === 'photo') {
        return {
            backgroundColor: '#f7f3ee',
            accentColor: '#a5673f',
            textColor: '#1f2937',
        };
    }

    if (/병원|의료|상담|진료|클리닉/.test(text)) {
        return {
            backgroundColor: '#f5faff',
            accentColor: '#1570ef',
            textColor: '#102a43',
        };
    }

    return {
        backgroundColor: '#f6f8fc',
        accentColor: '#1457ff',
        textColor: '#081b44',
    };
}

function createFormFromRawText(
    rawText: string,
    currentForm: BannerForm,
    imageMeta: ImageMeta | null,
    categoryPalette?: BannerCategory['palette'],
): BannerForm {
    const normalizedText = normalizeCopyText(rawText);

    if (!normalizedText) {
        return currentForm;
    }

    const analyzedCopy = analyzeCopyText(normalizedText);
    const layoutVariant = inferLayoutVariant(normalizedText, imageMeta);
    // 카테고리가 선택돼 있으면 그 팔레트를 색의 원천으로 쓰고 자동 색추론(inferColors)은 건너뛴다.
    const colors = categoryPalette ?? inferColors(normalizedText, layoutVariant);

    return {
        ...currentForm,
        ...colors,
        title: analyzedCopy.title || currentForm.title,
        subtitle: analyzedCopy.subtitle || currentForm.subtitle,
        emphasis: analyzedCopy.emphasis || currentForm.emphasis,
        cta: inferCta(normalizedText),
        layoutVariant,
    };
}

function drawWrappedText(
    context: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
) {
    const hasSpaces = text.includes(' ');
    const words = hasSpaces ? text.split(' ') : text.split('');
    const separator = hasSpaces ? ' ' : '';
    const lines: string[] = [];
    let line = '';

    words.forEach((word) => {
        const testLine = line ? `${line}${separator}${word}` : word;
        const width = context.measureText(testLine).width;

        if (width > maxWidth && line) {
            lines.push(line);
            line = word;
        } else {
            line = testLine;
        }
    });

    if (line) {
        lines.push(line);
    }

    lines.slice(0, maxLines).forEach((textLine, index) => {
        context.fillText(textLine, x, y + index * lineHeight);
    });
}

function drawRoundedRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function fillRoundedRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    color: string,
) {
    context.fillStyle = color;
    drawRoundedRect(context, x, y, width, height, radius);
    context.fill();
}

function drawCoverImage(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement,
    x: number,
    y: number,
    width: number,
    height: number,
) {
    const imageRatio = image.width / image.height;
    const targetRatio = width / height;
    let sourceWidth = image.width;
    let sourceHeight = image.height;
    let sourceX = 0;
    let sourceY = 0;

    if (imageRatio > targetRatio) {
        sourceWidth = image.height * targetRatio;
        sourceX = (image.width - sourceWidth) / 2;
    } else {
        sourceHeight = image.width / targetRatio;
        sourceY = (image.height - sourceHeight) / 2;
    }

    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
}

function drawImageArea(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement | null,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    placeholderColor = '#e5e7eb',
) {
    context.save();
    drawRoundedRect(context, x, y, width, height, radius);
    context.clip();

    if (image) {
        drawCoverImage(context, image, x, y, width, height);
    } else {
        context.fillStyle = placeholderColor;
        context.fillRect(x, y, width, height);
        context.fillStyle = '#b7bdc8';
        context.font = `600 38px ${fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('이미지를 업로드하세요', x + width / 2, y + height / 2);
    }

    context.restore();
}

function drawCta(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    x: number,
    y: number,
    width: number,
    height: number,
    radius = 20,
) {
    if (!form.cta) {
        return;
    }

    fillRoundedRect(context, x, y, width, height, radius, form.accentColor);
    context.fillStyle = '#ffffff';
    context.font = `700 32px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(form.cta, x + width / 2, y + height / 2);
}

function drawTopBrand(context: CanvasRenderingContext2D, form: BannerForm) {
    context.strokeStyle = form.textColor;
    context.globalAlpha = 0.24;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(74, 116);
    context.lineTo(416, 116);
    context.moveTo(838, 116);
    context.lineTo(1180, 116);
    context.stroke();
    context.globalAlpha = 1;

    if (form.badge) {
        context.fillStyle = form.textColor;
        context.font = `800 44px ${fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(form.badge, CANVAS_SIZE / 2, 112);
    }
}

function drawFooterBar(context: CanvasRenderingContext2D, text = 'MAKES THE DIFFERENCE') {
    fillRoundedRect(context, 0, 1186, CANVAS_SIZE, 68, 0, '#061b46');
    context.fillStyle = '#ffffff';
    context.font = `500 22px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, CANVAS_SIZE / 2, 1220);
}

function drawChalkLineIcon(context: CanvasRenderingContext2D, x: number, y: number) {
    context.save();
    context.strokeStyle = '#ffffff';
    context.lineWidth = 4;
    context.globalAlpha = 0.86;
    context.beginPath();
    context.rect(x, y, 130, 94);
    context.moveTo(x + 20, y);
    context.lineTo(x + 56, y - 36);
    context.lineTo(x + 112, y);
    context.moveTo(x + 44, y + 34);
    context.lineTo(x + 44, y + 56);
    context.moveTo(x + 74, y + 34);
    context.lineTo(x + 74, y + 56);
    context.moveTo(x + 104, y + 34);
    context.lineTo(x + 104, y + 56);
    context.stroke();
    context.restore();
}

function drawChalkboardLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, '#2d633b');
    drawChalkLineIcon(context, 118, 164);

    if (form.badge) {
        context.fillStyle = '#ffffff';
        context.font = `800 30px ${fontFamily}`;
        context.textAlign = 'right';
        context.textBaseline = 'middle';
        context.fillText(form.badge, 1168, 70);
    }

    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    context.fillStyle = '#ffffff';
    context.font = `500 54px ${fontFamily}`;
    drawWrappedText(context, form.subtitle, CANVAS_SIZE / 2, 536, 880, 74, 2);

    context.fillStyle = form.accentColor;
    context.font = `900 92px ${fontFamily}`;
    drawWrappedText(context, form.title, CANVAS_SIZE / 2, 656, 920, 108, 2);

    context.fillStyle = '#ffffff';
    context.font = `500 40px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, CANVAS_SIZE / 2, 810, 740, 56, 2);

    if (image) {
        drawImageArea(context, image, 820, 790, 260, 260, 130, '#f6f8fc');
    }

    context.strokeStyle = '#ffffff';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(1030, 740);
    context.quadraticCurveTo(1080, 690, 1130, 744);
    context.stroke();

    fillRoundedRect(context, 0, 1136, CANVAS_SIZE, 118, 0, '#b66a3c');
    context.strokeStyle = '#7f4123';
    context.globalAlpha = 0.35;
    for (let y = 1160; y < 1240; y += 18) {
        context.beginPath();
        context.moveTo(0, y);
        context.bezierCurveTo(280, y - 22, 620, y + 26, 1254, y - 6);
        context.stroke();
    }
    context.globalAlpha = 1;
}

function drawEducationLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, '#ffffff');
    drawTopBrand(context, form);

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = form.textColor;
    context.font = `800 86px ${fontFamily}`;
    drawWrappedText(context, form.title, 86, 330, 730, 98, 3);

    context.strokeStyle = form.accentColor;
    context.lineWidth = 12;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(90, 560);
    context.quadraticCurveTo(370, 548, 650, 562);
    context.stroke();

    context.fillStyle = '#111827';
    context.font = `700 42px ${fontFamily}`;
    drawWrappedText(context, form.subtitle, 92, 670, 620, 64, 4);

    context.fillStyle = form.accentColor;
    context.font = `800 54px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, 92, 940, 670, 68, 2);

    fillRoundedRect(context, 720, 470, 444, 520, 34, '#f3f4f6');
    drawImageArea(context, image, 740, 490, 404, 480, 28);
    drawCta(context, form, 92, 1064, 300, 82);
    drawFooterBar(context);
}

function drawProductLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, '#ffffff');
    fillRoundedRect(context, 0, 0, 500, 1254, 0, '#f3f4f6');
    drawImageArea(context, image, 40, 120, 480, 760, 26, '#e5e7eb');

    if (form.badge) {
        context.fillStyle = form.textColor;
        context.font = `800 42px ${fontFamily}`;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        context.fillText(form.badge, 580, 134);
    }

    context.strokeStyle = '#d1d5db';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(580, 176);
    context.lineTo(1148, 176);
    context.stroke();

    context.fillStyle = form.accentColor;
    context.font = `900 88px ${fontFamily}`;
    drawWrappedText(context, form.title, 580, 330, 560, 100, 3);

    context.fillStyle = '#374151';
    context.font = `700 40px ${fontFamily}`;
    drawWrappedText(context, form.subtitle, 580, 650, 540, 58, 4);

    fillRoundedRect(context, 580, 848, 530, 130, 20, '#fff1f2');
    context.fillStyle = form.accentColor;
    context.font = `800 44px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, 610, 924, 470, 52, 2);

    drawCta(context, form, 580, 1040, 300, 82);
    drawFooterBar(context, 'TRUSTED PRODUCT SOLUTION');
}

function drawPhotoLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, '#ffffff');
    drawTopBrand(context, form);
    drawImageArea(context, image, 50, 286, 1154, 620, 4, '#ece7df');

    context.strokeStyle = form.textColor;
    context.globalAlpha = 0.45;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(50, 250);
    context.lineTo(1204, 250);
    context.moveTo(50, 946);
    context.lineTo(1204, 946);
    context.stroke();
    context.globalAlpha = 1;

    context.fillStyle = form.textColor;
    context.font = `900 82px ${fontFamily}`;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    drawWrappedText(context, form.title, 62, 1050, 820, 90, 2);

    context.fillStyle = form.accentColor;
    context.font = `800 42px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, 930, 1048, 260, 52, 2);
}

function drawCompactLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, '#ffffff');
    drawImageArea(context, image, 728, 360, 410, 520, 34, '#f3f4f6');
    drawTopBrand(context, form);

    context.fillStyle = form.textColor;
    context.font = `900 98px ${fontFamily}`;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    drawWrappedText(context, form.title, 86, 420, 760, 112, 3);

    context.fillStyle = form.accentColor;
    context.font = `900 62px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, 92, 814, 610, 74, 2);

    context.strokeStyle = form.accentColor;
    context.lineWidth = 10;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(92, 870);
    context.quadraticCurveTo(330, 858, 570, 872);
    context.stroke();

    drawCta(context, form, 92, 1012, 300, 82);
    drawFooterBar(context);
}

function drawPlayfulLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    fillRoundedRect(context, 0, 0, CANVAS_SIZE, CANVAS_SIZE, 0, form.backgroundColor);
    fillRoundedRect(context, 84, 84, 1086, 1086, 54, '#ffffff');

    context.fillStyle = '#111827';
    context.font = `500 30px ${fontFamily}`;
    context.textAlign = 'center';
    context.textBaseline = 'alphabetic';
    drawWrappedText(context, form.subtitle, CANVAS_SIZE / 2, 470, 760, 48, 2);

    context.fillStyle = form.accentColor;
    context.font = `900 72px ${fontFamily}`;
    drawWrappedText(context, form.title, CANVAS_SIZE / 2, 590, 900, 84, 2);

    context.fillStyle = '#333333';
    context.font = `500 38px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, CANVAS_SIZE / 2, 760, 820, 54, 3);

    context.fillStyle = form.accentColor;
    context.globalAlpha = 0.16;
    context.beginPath();
    context.arc(230, 250, 56, 0, Math.PI * 2);
    context.arc(1040, 300, 42, 0, Math.PI * 2);
    context.arc(240, 930, 44, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    context.strokeStyle = '#222222';
    context.lineWidth = 6;
    context.beginPath();
    context.moveTo(890, 360);
    context.bezierCurveTo(960, 390, 880, 432, 940, 470);
    context.stroke();

    if (image) {
        drawImageArea(context, image, 694, 822, 320, 260, 34, '#f8fafc');
    } else {
        fillRoundedRect(context, 762, 860, 210, 170, 36, '#ffe4e6');
        context.fillStyle = form.accentColor;
        context.font = `900 78px ${fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('?', 867, 944);
    }

    if (form.badge) {
        context.fillStyle = form.accentColor;
        context.font = `600 22px ${fontFamily}`;
        context.textAlign = 'center';
        context.fillText(form.badge, CANVAS_SIZE / 2, 1088);
    }
}

function drawTemplateOne(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    context.fillStyle = form.backgroundColor;
    context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (form.layoutVariant === 'product') {
        drawProductLayout(context, form, image);
        return;
    }

    if (form.layoutVariant === 'photo') {
        drawPhotoLayout(context, form, image);
        return;
    }

    if (form.layoutVariant === 'compact') {
        drawCompactLayout(context, form, image);
        return;
    }

    if (form.layoutVariant === 'chalkboard') {
        drawChalkboardLayout(context, form, image);
        return;
    }

    if (form.layoutVariant === 'playful') {
        drawPlayfulLayout(context, form, image);
        return;
    }

    drawEducationLayout(context, form, image);
}

function drawBottomBannerLayout(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
    bannerSize: BannerSize,
) {
    const { height, width } = bannerSize;

    fillRoundedRect(context, 0, 0, width, height, 0, form.backgroundColor || '#ffffff');
    fillRoundedRect(context, 56, 56, width - 112, height - 112, 42, '#ffffff');

    context.fillStyle = form.accentColor;
    context.globalAlpha = 0.1;
    context.beginPath();
    context.arc(width - 210, 170, 190, 0, Math.PI * 2);
    context.arc(width - 90, height - 70, 260, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;

    if (form.badge) {
        fillRoundedRect(context, 96, 92, 220, 54, 16, '#f3f4f6');
        context.fillStyle = form.textColor;
        context.font = `700 24px ${fontFamily}`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(form.badge, 206, 119);
    }

    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillStyle = form.accentColor;
    context.font = `800 42px ${fontFamily}`;
    drawWrappedText(context, form.subtitle, 104, 238, 720, 58, 2);

    context.fillStyle = form.textColor;
    context.font = `900 86px ${fontFamily}`;
    drawWrappedText(context, form.title, 104, 360, 840, 98, 3);

    context.fillStyle = '#374151';
    context.font = `700 38px ${fontFamily}`;
    drawWrappedText(context, form.emphasis, 108, 700, 760, 52, 2);

    if (form.cta) {
        drawCta(context, form, 108, 760, 300, 72);
    }

    drawImageArea(context, image, 1030, 150, 500, 640, 36, '#f3f4f6');

    context.strokeStyle = form.accentColor;
    context.globalAlpha = 0.75;
    context.lineWidth = 8;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(108, 626);
    context.quadraticCurveTo(360, 604, 620, 626);
    context.stroke();
    context.globalAlpha = 1;
}

function drawBanner(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
    bannerSize: BannerSize = bannerSizes[0],
    logo?: HTMLImageElement | null,
) {
    context.clearRect(0, 0, bannerSize.width, bannerSize.height);

    if (bannerSize.id === 'bottom') {
        drawBottomBannerLayout(context, form, image, bannerSize);
        if (logo) {
            drawLogoOverlay(context, logo, bannerSize);
        }
        return;
    }

    // 수동 레이아웃은 CANVAS_SIZE(1254) 좌표계로 그려져 있어, 정사각 출력 크기가 바뀌어도
    // 캔버스 크기에 맞게 스케일해 미리보기가 잘리지 않게 한다. (AI 출력은 composeFinalCardImage가 별도 처리)
    const squareScale = bannerSize.width / CANVAS_SIZE;
    context.save();
    context.scale(squareScale, squareScale);
    drawTemplateOne(context, form, image);
    context.restore();
    if (logo) {
        drawLogoOverlay(context, logo, bannerSize);
    }
}

function loadImageFromDataUrl(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('생성된 이미지를 읽지 못했습니다.'));
        image.src = dataUrl;
    });
}

// 브라우저 Canvas로 로고 배경 제거(누끼) + 투명 여백 트림.
// 서버 sharp 기반 makeLogoOverlayBuffer 알고리즘을 포팅해 Cloudflare/로컬 어디서나 동일하게 동작.
function removeLogoBackground(image: HTMLImageElement): string | null {
    if (!image.width || !image.height) {
        return null;
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
        return null;
    }

    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0);

    let imageData: ImageData;

    try {
        imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
        // 교차 출처 이미지 등으로 캔버스가 오염된 경우 원본 유지.
        return null;
    }

    const { data, height, width } = imageData;
    const cornerPoints = [
        [0, 0],
        [width - 1, 0],
        [0, height - 1],
        [width - 1, height - 1],
    ];
    const background = cornerPoints.reduce(
        (color, [x, y]) => {
            const index = (y * width + x) * 4;

            return {
                blue: color.blue + data[index + 2] / cornerPoints.length,
                green: color.green + data[index + 1] / cornerPoints.length,
                red: color.red + data[index] / cornerPoints.length,
            };
        },
        { blue: 0, green: 0, red: 0 },
    );

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const backgroundDistance = Math.hypot(
            red - background.red,
            green - background.green,
            blue - background.blue,
        );

        if (backgroundDistance < 26 || (red > 245 && green > 245 && blue > 245 && max - min < 12)) {
            data[index + 3] = 0;
        } else if (
            backgroundDistance < 48 ||
            (red > 235 && green > 235 && blue > 235 && max - min < 18)
        ) {
            data[index + 3] = Math.min(
                data[index + 3],
                Math.max(20, Math.round((backgroundDistance - 26) * 5)),
            );
        }

        if (data[index + 3] > 8) {
            const pixelIndex = index / 4;
            const x = pixelIndex % width;
            const y = Math.floor(pixelIndex / width);

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    }

    context.putImageData(imageData, 0, 0);

    if (maxX < minX || maxY < minY) {
        // 불투명 픽셀이 없으면 트림 없이 반환.
        return canvas.toDataURL('image/png');
    }

    const trimmedWidth = maxX - minX + 1;
    const trimmedHeight = maxY - minY + 1;

    if (trimmedWidth === width && trimmedHeight === height) {
        return canvas.toDataURL('image/png');
    }

    const trimmedCanvas = document.createElement('canvas');
    const trimmedContext = trimmedCanvas.getContext('2d');

    if (!trimmedContext) {
        return canvas.toDataURL('image/png');
    }

    trimmedCanvas.width = trimmedWidth;
    trimmedCanvas.height = trimmedHeight;
    trimmedContext.drawImage(
        canvas,
        minX,
        minY,
        trimmedWidth,
        trimmedHeight,
        0,
        0,
        trimmedWidth,
        trimmedHeight,
    );

    return trimmedCanvas.toDataURL('image/png');
}

// 투명 여백을 잘라 PNG dataURL 로 내보낸다.
function exportTrimmedTransparent(canvas: HTMLCanvasElement, data: Uint8ClampedArray): string {
    const w = canvas.width;
    const h = canvas.height;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;

    for (let p = 0; p < w * h; p += 1) {
        if (data[p * 4 + 3] > 8) {
            const x = p % w;
            const y = (p - x) / w;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < minX || maxY < minY) {
        return canvas.toDataURL('image/png');
    }

    const tw = maxX - minX + 1;
    const th = maxY - minY + 1;
    if (tw === w && th === h) {
        return canvas.toDataURL('image/png');
    }

    const out = document.createElement('canvas');
    const ctx = out.getContext('2d');
    if (!ctx) return canvas.toDataURL('image/png');
    out.width = tw;
    out.height = th;
    ctx.drawImage(canvas, minX, minY, tw, th, 0, 0, tw, th);
    return out.toDataURL('image/png');
}

// 이미 투명 배경(누끼된 PNG)인지 검사하고, 맞으면 재처리 없이 여백만 트림해 그대로 반환.
// 모드 2(누끼 이미지 첨부): 사용자가 이미 처리한 PNG 를 손대지 않고 고정 합성하기 위함.
function useTransparentLogoAsIs(image: HTMLImageElement): string | null {
    if (!image.width || !image.height) return null;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0);

    let data: Uint8ClampedArray;
    try {
        data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
        return null;
    }

    let transparent = 0;
    let total = 0;
    const stride = 4 * Math.max(1, Math.floor((canvas.width * canvas.height) / 40000));
    for (let i = 3; i < data.length; i += stride) {
        total += 1;
        if (data[i] < 240) transparent += 1;
    }

    // 투명 픽셀이 5% 이상이면 이미 누끼된 PNG 로 보고 원본 그대로 사용(트림만).
    if (total > 0 && transparent / total > 0.05) {
        return exportTrimmedTransparent(canvas, data);
    }
    return null;
}

// 테두리에서 시작하는 flood-fill 로 '바깥 배경'만 투명 처리한다(로고 내부의 흰색은 보존).
// 단색/근단색 배경 로고에 강함. 테두리가 균일하지 않으면(사진·복잡 배경) null 반환 → ML 폴백.
function removeBackgroundByFloodFill(image: HTMLImageElement): string | null {
    if (!image.width || !image.height) return null;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    const w = (canvas.width = image.width);
    const h = (canvas.height = image.height);
    context.drawImage(image, 0, 0);

    let imageData: ImageData;
    try {
        imageData = context.getImageData(0, 0, w, h);
    } catch {
        return null;
    }
    const data = imageData.data;

    // 테두리 픽셀 샘플링으로 배경색·균일도·기존 투명 여부 판단.
    const stepX = Math.max(1, Math.floor(w / 80));
    const stepY = Math.max(1, Math.floor(h / 80));
    const samples: number[] = [];
    let alphaSum = 0;
    let alphaCount = 0;
    const sample = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        samples.push(i);
        alphaSum += data[i + 3];
        alphaCount += 1;
    };
    for (let x = 0; x < w; x += stepX) {
        sample(x, 0);
        sample(x, h - 1);
    }
    for (let y = 0; y < h; y += stepY) {
        sample(0, y);
        sample(w - 1, y);
    }

    // 이미 투명 배경이면(테두리 평균 알파 낮음) 원본 그대로 유지.
    if (alphaCount > 0 && alphaSum / alphaCount < 20) {
        return exportTrimmedTransparent(canvas, data);
    }

    let bgR = 0;
    let bgG = 0;
    let bgB = 0;
    for (const i of samples) {
        bgR += data[i];
        bgG += data[i + 1];
        bgB += data[i + 2];
    }
    bgR /= samples.length;
    bgG /= samples.length;
    bgB /= samples.length;

    let variance = 0;
    for (const i of samples) {
        variance += Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB);
    }
    variance /= samples.length;
    // 테두리가 균일하지 않으면(사진/그라데이션) flood-fill 부적합.
    if (variance > 38) return null;

    const tolerance = 52;
    const feather = tolerance * 1.7;
    const visited = new Uint8Array(w * h);
    const stack: number[] = [];
    const seed = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= w || y >= h) return;
        const p = y * w + x;
        if (visited[p]) return;
        visited[p] = 1;
        stack.push(p);
    };
    for (let x = 0; x < w; x += 1) {
        seed(x, 0);
        seed(x, h - 1);
    }
    for (let y = 0; y < h; y += 1) {
        seed(0, y);
        seed(w - 1, y);
    }

    while (stack.length) {
        const p = stack.pop() as number;
        const i = p * 4;
        const dist = Math.hypot(data[i] - bgR, data[i + 1] - bgG, data[i + 2] - bgB);

        if (dist > tolerance) {
            // 경계 픽셀: 배경에 가까우면 부분 투명으로 흰 테두리(halo) 제거, 아니면 로고이므로 멈춤.
            if (dist < feather) {
                const ratio = (dist - tolerance) / (feather - tolerance);
                data[i + 3] = Math.min(data[i + 3], Math.round(255 * ratio));
            }
            continue;
        }

        data[i + 3] = 0;
        const x = p % w;
        const y = (p - x) / w;
        seed(x + 1, y);
        seed(x - 1, y);
        seed(x, y + 1);
        seed(x, y - 1);
    }

    context.putImageData(imageData, 0, 0);
    return exportTrimmedTransparent(canvas, data);
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => reject(new Error('처리된 로고를 읽지 못했습니다.'));
        reader.readAsDataURL(blob);
    });
}

// 단색 코너 샘플링 폴백(ML 누끼 실패 시).
async function processLogoBySolidColor(
    image: HTMLImageElement,
    fallbackDataUrl: string,
): Promise<{ dataUrl: string; image: HTMLImageElement }> {
    const processedDataUrl = removeLogoBackground(image) || fallbackDataUrl;

    if (processedDataUrl === fallbackDataUrl) {
        return { dataUrl: fallbackDataUrl, image };
    }

    const processedImage = await loadImageFromDataUrl(processedDataUrl);

    return { dataUrl: processedDataUrl, image: processedImage };
}

async function processLogoImage(
    image: HTMLImageElement,
    fallbackDataUrl: string,
): Promise<{ dataUrl: string; image: HTMLImageElement }> {
    // 0순위(모드 2): 이미 투명한 PNG 면 재처리하지 않고 그대로 사용(가장자리 손상 방지).
    const asIsDataUrl = useTransparentLogoAsIs(image);
    if (asIsDataUrl) {
        try {
            const asIsImage = await loadImageFromDataUrl(asIsDataUrl);
            return { dataUrl: asIsDataUrl, image: asIsImage };
        } catch {
            // 무시하고 다음 방법으로.
        }
    }

    // 1순위: 테두리 flood-fill 단색 배경 제거. 로고(평평한 흰/단색 배경)에 가장 깔끔 —
    // 흰 박스/halo 없이 바깥 배경만 투명 처리하고 로고 내부는 보존한다.
    const floodDataUrl = removeBackgroundByFloodFill(image);
    if (floodDataUrl) {
        try {
            const floodImage = await loadImageFromDataUrl(floodDataUrl);
            return { dataUrl: floodDataUrl, image: floodImage };
        } catch {
            // 무시하고 다음 방법으로.
        }
    }

    try {
        // 2순위: 브라우저 내 ML 모델로 배경 제거(복잡/사진 배경 대응).
        const blob = await removeBackground(fallbackDataUrl);
        const dataUrl = await blobToDataUrl(blob);

        if (!dataUrl) {
            return processLogoBySolidColor(image, fallbackDataUrl);
        }

        const processedImage = await loadImageFromDataUrl(dataUrl);

        return { dataUrl, image: processedImage };
    } catch {
        // ML 누끼 실패 시 단색 누끼로 폴백.
        return processLogoBySolidColor(image, fallbackDataUrl);
    }
}

function getLogoOverlayBox(bannerSize: BannerSize) {
    if (bannerSize.id === 'bottom') {
        return {
            height: 76,
            width: 220,
            x: 92,
            y: 76,
        };
    }

    return {
        height: 92,
        width: 220,
        x: 84,
        y: 84,
    };
}

function drawLogoOverlay(
    context: CanvasRenderingContext2D,
    logo: HTMLImageElement,
    bannerSize: BannerSize,
) {
    const box = getLogoOverlayBox(bannerSize);
    const scale = Math.min(box.width / logo.width, box.height / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    const x = box.x + (box.width - width) / 2;
    const y = box.y + (box.height - height) / 2;

    context.save();
    // 칩/플레이트 없이 누끼 처리된 로고만 그대로 합성.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(logo, x, y, width, height);
    context.restore();
}

function coverTopLeftBrandArea(
    context: CanvasRenderingContext2D,
    bannerSize: BannerSize,
    fillColor = '#ffffff',
) {
    const box = getLogoOverlayBox(bannerSize);
    const padding = 24;

    // 로고 자리에 딱 맞게만 덮어 제목/본문이 가려지지 않게 한다.
    context.fillStyle = fillColor;
    context.fillRect(0, 0, box.x + box.width + padding, box.y + box.height + padding);
}

// AI 참조 이미지는 모델이 1024 해상도로만 쓰고 '느슨한 참조'로만 사용하므로,
// 풀해상도 무손실 PNG 대신 ≤1024 + JPEG 로 보내 입력 토큰·업로드 지연을 줄인다(품질 무손상).
const AI_REFERENCE_MAX_PX = 1024;
const AI_REFERENCE_MIME = 'image/jpeg';
const AI_REFERENCE_QUALITY = 0.85;

async function maskBrandAreaForAiReference(
    dataUrl: string,
    bannerSize: BannerSize,
    fillColor = '#ffffff',
) {
    const image = await loadImageFromDataUrl(dataUrl);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    // 가장 긴 변을 1024 로 제한(작으면 그대로). context.scale 로 브랜드 마스크 박스도 함께 비례 축소.
    const scale = Math.min(1, AI_REFERENCE_MAX_PX / Math.max(bannerSize.width, bannerSize.height));
    canvas.width = Math.round(bannerSize.width * scale);
    canvas.height = Math.round(bannerSize.height * scale);

    if (!context) {
        return dataUrl;
    }

    context.scale(scale, scale);
    context.fillStyle = fillColor;
    context.fillRect(0, 0, bannerSize.width, bannerSize.height);
    drawCoverImage(context, image, 0, 0, bannerSize.width, bannerSize.height);

    coverTopLeftBrandArea(context, bannerSize, fillColor);

    return canvas.toDataURL(AI_REFERENCE_MIME, AI_REFERENCE_QUALITY);
}

type BrandCorner = 'top-left' | 'top-right' | 'top-center';

type BrandPreset = {
    corner: BrandCorner;
    accent: boolean;
};

// 제목은 항상 좌측에 오므로, 브랜드는 우측 상단 고정(제목과 절대 겹치지 않음). 색만 run마다 변화.
const BRAND_PRESETS: BrandPreset[] = [
    { accent: false, corner: 'top-right' },
    { accent: true, corner: 'top-right' },
];

function pickRandomBrandPreset() {
    return BRAND_PRESETS[Math.floor(Math.random() * BRAND_PRESETS.length)];
}

type BrandBox = { x: number; y: number; width: number; height: number };

// 브랜드/로고는 MASSIV 예시처럼 상단에 작게. 제목을 가리지 않도록 작고 높게 배치.
function getBrandBox(bannerSize: BannerSize, corner: BrandCorner): BrandBox {
    const isBottom = bannerSize.id === 'bottom';
    // 코너 로고 크기: 너무 작지 않게 적당히(정사각 height 54→84, 폭 230→300).
    const width = isBottom ? 250 : 300;
    const height = isBottom ? 64 : 84;
    const margin = isBottom ? 56 : 64;
    const y = isBottom ? 40 : 52;

    let x = margin;

    if (corner === 'top-right') {
        x = bannerSize.width - margin - width;
    } else if (corner === 'top-center') {
        x = (bannerSize.width - width) / 2;
    }

    return { height, width, x, y };
}

// AI 에 보내는 카피에서 브랜드명을 제거한다. 브랜드는 코너에 코드로만 합성하므로,
// 제목/본문/강조/원문에 브랜드명이 섞여 있으면 AI 가 본문에 또 그려 '중복'이 된다 → 사전 제거.
function stripBrandFromCopy(text: string, brand: string): string {
    const compact = (brand || '').replace(/\s+/g, '');
    if (!text || !compact) return text;
    // 글자 사이 띄어쓰기 변형도 잡도록 각 글자 사이에 \s* 허용 ("메가 커피" ↔ "메가커피").
    const pattern = compact
        .split('')
        .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s*');
    return text
        .replace(new RegExp(pattern, 'gi'), '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]*\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

// 로고 이미지가 없을 때 브랜드명을 고정 박스 안에 또렷한 고딕체로 합성한다(AI 렌더 대신 고정 위치 보장).
function drawBrandTextInBox(
    context: CanvasRenderingContext2D,
    text: string,
    box: BrandBox,
    color: string,
) {
    context.save();
    context.fillStyle = color;
    context.textAlign = 'right';
    context.textBaseline = 'middle';
    // 박스(흰 판) 없이 그리므로, 배경이 살짝 어수선해도 읽히도록 옅은 대비 그림자만 준다.
    const lightText = color.toLowerCase() === '#ffffff' || color.toLowerCase() === '#fff';
    context.shadowColor = lightText ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)';
    context.shadowBlur = 4;

    let fontSize = Math.floor(box.height * 0.72);
    const setFont = () => {
        context.font = `700 ${fontSize}px 'Pretendard', 'Noto Sans KR', sans-serif`;
    };
    setFont();
    while (context.measureText(text).width > box.width && fontSize > 12) {
        fontSize -= 1;
        setFont();
    }

    // 우측 정렬(코너 밀착).
    context.fillText(text, box.x + box.width, box.y + box.height / 2);
    context.restore();
}

function drawLogoInBox(context: CanvasRenderingContext2D, logo: HTMLImageElement, box: BrandBox) {
    const scale = Math.min(box.width / logo.width, box.height / logo.height);
    const width = logo.width * scale;
    const height = logo.height * scale;
    // 우측 정렬: 박스 배경을 칠하지 않으므로 로고가 우측 상단 코너에 밀착하도록 한다.
    const x = box.x + box.width - width;
    const y = box.y + (box.height - height) / 2;

    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(logo, x, y, width, height);
    context.restore();
}

// 최종 합성: AI가 그린 카드 이미지를 배너 크기에 맞추고, 로고/브랜드명을 로컬에서 또렷하게 덮는다.
// (본문 텍스트/디자인은 AI가 생성, 좌상단 브랜드만 고정 합성으로 일관성 보장)
async function composeFinalCardImage(
    aiImageDataUrl: string,
    form: BannerForm,
    bannerSize: BannerSize,
    brandPreset: BrandPreset,
    logo?: HTMLImageElement | null,
): Promise<string> {
    const image = await loadImageFromDataUrl(aiImageDataUrl);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = bannerSize.width;
    canvas.height = bannerSize.height;

    if (!context) {
        return aiImageDataUrl;
    }

    const backgroundColor = form.backgroundColor || '#ffffff';

    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, bannerSize.width, bannerSize.height);
    drawCoverImage(context, image, 0, 0, bannerSize.width, bannerSize.height);

    // 브랜드는 항상 코드로 우측 상단 고정 박스에 합성(픽셀 동일) → 몇 장을 뽑든 위치 동일.
    // 로고 파일이 있으면 누끼 처리된 로고를, 없고 브랜드명만 있으면 텍스트를 같은 박스에 넣는다.
    // (AI 는 그 자리를 비워두기만 함 — AI 가 브랜드를 그리면 위치가 매번 달라지던 문제를 제거)
    if (logo || form.badge) {
        const brandBox = getBrandBox(bannerSize, brandPreset.corner);
        if (logo) {
            // 흰 박스 방지: 배경을 칠하지 않고 (누끼된) 로고만 합성한다.
            // 프롬프트가 코너를 배경색으로 비워두므로 투명 로고가 카드 배경과 자연스럽게 섞인다.
            drawLogoInBox(context, logo, brandBox);
        } else if (form.badge) {
            // 박스 없이 텍스트만 합성(흰 판 제거). 가독성은 drawBrandTextInBox 의 미세 그림자로 확보.
            drawBrandTextInBox(context, form.badge, brandBox, form.textColor || '#111827');
        }
    }

    return canvas.toDataURL('image/png');
}

// 디자인 통일성을 위해 첫 카드(디자인 마스터)를 먼저 생성한 뒤, 나머지 카드는 이 동시성으로 병렬 생성한다.
// (최대 10장까지 가능하므로 레이트리밋 보호를 위해 3장씩 묶어 진행)
const CARD_GENERATION_CONCURRENCY = 3;

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>,
) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await worker(item);
        }
    });

    await Promise.all(workers);
}

// 갤러리 저장용 작은 썸네일(JPEG) 생성 — 원본은 따로 저장하고 목록은 가볍게.
async function makeBannerThumb(dataUrl: string, maxPx = 420): Promise<string> {
    try {
        const image = await loadImageFromDataUrl(dataUrl);
        const scale = Math.min(1, maxPx / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return dataUrl;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
        return dataUrl;
    }
}

// 작업 기록 갤러리 — 카테고리(블로그 대시보드 동일 탭 스타일)·작업자별 필터.
function BannerGalleryView({ refreshKey }: { refreshKey: number }) {
    const [items, setItems] = useState<BannerOutput[]>([]);
    const [operators, setOperators] = useState<string[]>([]);
    const [category, setCategory] = useState('');
    const [operator, setOperator] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError('');
        void getBannerOutputs({ category, operator })
            .then(({ data, error: loadError }) => {
                if (!alive) return;
                if (loadError) {
                    setError(
                        '작업 기록을 불러오지 못했습니다. Supabase 에서 banner_outputs 테이블을 만들었는지 확인하세요.',
                    );
                }
                setItems(data);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, [category, operator, refreshKey]);

    useEffect(() => {
        let alive = true;
        void getBannerOperators().then(({ operators: ops }) => {
            if (alive) setOperators(ops);
        });
        return () => {
            alive = false;
        };
    }, [refreshKey]);

    const download = async (item: BannerOutput) => {
        const { dataUrl } = await getBannerOutputImage(item.id);
        if (!dataUrl) return;
        const link = document.createElement('a');
        link.download = `banner-${item.category || 'card'}-${item.id.slice(0, 6)}.png`;
        link.href = dataUrl;
        link.click();
    };

    const categoryTabs: Array<{ id: string; name: string }> = [
        { id: '', name: '전체' },
        ...CATEGORY_PRESETS.map((c) => ({ id: c.id, name: c.name })),
    ];

    return (
        <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-6">
            <div className="mb-4">
                <strong className="text-[15px] text-[#111111]">작업 기록</strong>
                <p className="mt-1 mb-0 text-xs text-[#6b7280]">
                    생성한 배너가 작업자·카테고리·시간과 함께 자동 저장됩니다. (썸네일 클릭 시 원본 다운로드)
                </p>
            </div>

            <div className="mb-3 flex flex-wrap gap-1 border-b border-[#e2e8f0]">
                {categoryTabs.map((c) => (
                    <button
                        className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                            category === c.id
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={c.id || 'all'}
                        onClick={() => setCategory(c.id)}
                        type="button"
                    >
                        {c.name}
                    </button>
                ))}
            </div>

            <div className="mb-4 flex items-center gap-2">
                <span className="text-xs font-semibold text-[#6b7280]">작업자</span>
                <select
                    className="h-9 rounded-md border border-[#d1d5db] bg-white px-2 text-sm"
                    onChange={(event) => setOperator(event.target.value)}
                    value={operator}
                >
                    <option value="">전체</option>
                    {operators.map((op) => (
                        <option key={op} value={op}>
                            {op}
                        </option>
                    ))}
                </select>
            </div>

            {error ? (
                <p className="m-0 rounded-md bg-[#fee2e2] px-4 py-3 text-sm text-[#dc2626]">{error}</p>
            ) : loading ? (
                <p className="m-0 text-sm text-[#6b7280]">불러오는 중…</p>
            ) : items.length === 0 ? (
                <p className="m-0 text-sm text-[#94a3b8]">아직 저장된 작업물이 없습니다.</p>
            ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {items.map((item) => (
                        <button
                            className="overflow-hidden rounded-md border border-[#e5e7eb] bg-[#f9fafb] text-left transition hover:border-[#1e40af]"
                            key={item.id}
                            onClick={() => download(item)}
                            title="원본 다운로드"
                            type="button"
                        >
                            {item.thumb_data_url ? (
                                <img
                                    alt=""
                                    className="block aspect-square w-full object-cover"
                                    src={item.thumb_data_url}
                                />
                            ) : (
                                <div className="flex aspect-square w-full items-center justify-center text-xs text-[#94a3b8]">
                                    미리보기 없음
                                </div>
                            )}
                            <div className="px-2 py-1.5">
                                <div className="flex items-center justify-between gap-1">
                                    <span className="truncate text-xs font-semibold text-[#0f172a]">
                                        {item.operator_name || '미지정'}
                                    </span>
                                    {item.category_label ? (
                                        <span className="shrink-0 rounded bg-[#ede9fe] px-1.5 py-0.5 text-[10px] font-semibold text-[#7c3aed]">
                                            {item.category_label}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-0.5 text-[10px] text-[#94a3b8]">
                                    {new Date(item.created_at).toLocaleString('ko-KR', {
                                        day: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit',
                                        month: '2-digit',
                                    })}
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function BannerGeneratorPage() {
    const { user } = useAuth();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRefs = useRef<Record<string, Array<HTMLImageElement | null>>>({});
    const [aiErrorMessage, setAiErrorMessage] = useState('');
    const [aiGeneratedImageUrl, setAiGeneratedImageUrl] = useState('');
    const [aiHistory, setAiHistory] = useState<AiGenerationHistoryItem[]>([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [diverseStyle, setDiverseStyle] = useState(true);
    const [generationElapsedSeconds, setGenerationElapsedSeconds] = useState(0);
    const [runCardIds, setRunCardIds] = useState<string[]>([]);
    const generationStartRef = useRef(0);
    const runAbortRef = useRef<AbortController | null>(null);
    const cancelledRef = useRef(false);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageProvider, setImageProvider] = useState<ImageProvider>('openai');
    const [imageQuality, setImageQuality] = useState<ImageQuality>('medium');
    const [logoAsset, setLogoAsset] = useState<LogoAsset | null>(null);
    const [logoLoading, setLogoLoading] = useState(false);
    const [pages, setPages] = useState<CardNewsPage[]>(() => [createCardNewsPage(1)]);
    const [activePageId, setActivePageId] = useState(() => pages[0]?.id || '');
    const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>('template-1');
    const [selectedCategoryId, setSelectedCategoryId] = useState('');
    const [operatorName, setOperatorName] = useState(
        () => localStorage.getItem('erp_operator_name') || '',
    );
    // 상위 탭(생성/작업 기록). 한 컴포넌트 안에서 전환하므로 탭을 바꿔도 생성기는 마운트 유지 → 계속 돌아감.
    const [view, setView] = useState<'create' | 'gallery'>('create');
    const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
    // 이번 생성 run 의 실제 토큰/비용 누적(표시용).
    const [runUsage, setRunUsage] = useState<{ cards: number; tokens: number; cost: number }>({
        cards: 0,
        cost: 0,
        tokens: 0,
    });
    const pagesRef = useRef(pages);
    const activePage = pages.find((page) => page.id === activePageId) || pages[0];
    const form = activePage?.form || defaultForm;
    const activeResultImageUrl = activePage?.resultImageUrl || aiGeneratedImageUrl;
    const selectedBannerSize =
        bannerSizes.find((bannerSize) => bannerSize.id === activePage?.bannerSizeId) ||
        bannerSizes[0];
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
    const selectedCategory = CATEGORY_PRESETS.find((category) => category.id === selectedCategoryId);

    useEffect(() => {
        pagesRef.current = pages;
    }, [pages]);

    useEffect(() => {
        return () => {
            pagesRef.current.forEach((page) => {
                page.imageUrls.forEach((imageUrl) => {
                    if (imageUrl.startsWith('blob:')) {
                        URL.revokeObjectURL(imageUrl);
                    }
                });
            });
        };
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');

        if (!canvas || !context) {
            return;
        }

        drawBanner(
            context,
            logoAsset ? { ...form, badge: '' } : form,
            imageRefs.current[activePage?.id || '']?.[0] || null,
            selectedBannerSize,
            logoAsset?.image || null,
        );
    }, [activePage?.id, activePage?.imageUrls, form, logoAsset, selectedBannerSize]);

    useEffect(() => {
        if (!aiLoading) {
            return;
        }

        const intervalId = window.setInterval(() => {
            setGenerationElapsedSeconds(
                Math.floor((Date.now() - generationStartRef.current) / 1000),
            );
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [aiLoading]);

    const runDoneCount = pages.filter(
        (page) =>
            runCardIds.includes(page.id) &&
            (page.status === 'success' || page.status === 'error'),
    ).length;

    const updateForm = (field: keyof BannerForm, value: string) => {
        const sharedFields: Array<keyof BannerForm> = [
            'accentColor',
            'backgroundColor',
            'badge',
            'textColor',
        ];
        const shouldApplyToAll = sharedFields.includes(field);

        setPages((currentPages) =>
            currentPages.map((page) => {
                if (!shouldApplyToAll && page.id !== activePageId) {
                    return page;
                }

                return {
                    ...page,
                    form: {
                        ...page.form,
                        [field]: value,
                    },
                };
            }),
        );
    };

    // 카테고리 선택 시: 무드 색 팔레트를 모든 페이지 폼에 적용(색은 공유 필드).
    // 이후 색상 피커로 수동 변경하면 그 값이 우선(사용자 > 카테고리 > 자동추론).
    const handleSelectCategory = (categoryId: string) => {
        setSelectedCategoryId(categoryId);
        const palette = CATEGORY_PRESETS.find((category) => category.id === categoryId)?.palette;
        if (!palette) {
            return;
        }
        setPages((currentPages) =>
            currentPages.map((page) => ({
                ...page,
                form: {
                    ...page.form,
                    accentColor: palette.accentColor,
                    backgroundColor: palette.backgroundColor,
                    textColor: palette.textColor,
                },
            })),
        );
    };

    const updatePageTextField = (
        pageId: string,
        field: Extract<keyof BannerForm, 'emphasis' | 'subtitle' | 'title'>,
        value: string,
    ) => {
        setPages((currentPages) =>
            currentPages.map((page) => {
                if (page.id !== pageId) {
                    return page;
                }

                const nextForm = {
                    ...page.form,
                    [field]: value,
                };

                return {
                    ...page,
                    form: nextForm,
                    rawText: [nextForm.title, nextForm.subtitle, nextForm.emphasis]
                        .filter((text) => text.trim())
                        .join('\n\n'),
                };
            }),
        );
    };

    const updateActivePageBannerSize = (bannerSizeId: BannerSizeId) => {
        setPages((currentPages) =>
            currentPages.map((page) =>
                page.id === activePageId
                    ? {
                          ...page,
                          bannerSizeId,
                      }
                    : page,
            ),
        );
    };

    const updatePageRawText = (pageId: string, nextRawText: string) => {
        setPages((currentPages) =>
            applyTemplateLayout(
                normalizeSeriesLayout(
                    currentPages.map((page) => {
                        if (page.id !== pageId) {
                            return page;
                        }

                        return {
                            ...page,
                            form: createFormFromRawText(
                                nextRawText,
                                page.form,
                                page.imageMetas[0],
                                selectedCategory?.palette,
                            ),
                            rawText: nextRawText,
                        };
                    }),
                ),
                selectedTemplate,
            ),
        );
    };

    const addPage = () => {
        if (pages.length >= 10) {
            return;
        }

        const nextPage = createCardNewsPage(pages.length + 1, form, activePage?.bannerSizeId);
        setPages((currentPages) =>
            applyTemplateLayout(normalizeSeriesLayout([...currentPages, nextPage]), selectedTemplate),
        );
        setActivePageId(nextPage.id);
    };

    const removePage = (pageId: string) => {
        if (pages.length <= 1) {
            return;
        }

        const pageToRemove = pages.find((page) => page.id === pageId);

        pageToRemove?.imageUrls.forEach((imageUrl) => {
            if (imageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(imageUrl);
            }
        });

        delete imageRefs.current[pageId];
        setPages((currentPages) => currentPages.filter((page) => page.id !== pageId));

        if (activePageId === pageId) {
            const nextPage = pages.find((page) => page.id !== pageId);
            setActivePageId(nextPage?.id || '');
        }
    };

    const applyRandomColors = () => {
        const preset = colorPresets[Math.floor(Math.random() * colorPresets.length)];
        setPages((currentPages) =>
            currentPages.map((page) => ({
                ...page,
                form: {
                    ...page.form,
                    ...preset,
                },
            })),
        );
    };

    const selectTemplate = (templateId: TemplateId) => {
        const nextTemplate = templates.find((template) => template.id === templateId);

        if (!nextTemplate || nextTemplate.disabled) {
            return;
        }

        setSelectedTemplateId(templateId);
        setPages((currentPages) => applyTemplateLayout(currentPages, nextTemplate));
    };

    const handleImageChange = (event: ChangeEvent<HTMLInputElement>, imageIndex: number) => {
        const file = event.target.files?.[0];

        if (!file || !activePage) {
            return;
        }

        const currentImageUrl = activePage.imageUrls[imageIndex] || '';

        if (currentImageUrl.startsWith('blob:')) {
            URL.revokeObjectURL(currentImageUrl);
        }

        setAiErrorMessage('');
        setImageLoading(true);
        const nextImageUrl = URL.createObjectURL(file);
        const image = new Image();
        const reader = new FileReader();

        image.onload = () => {
            const nextImageMeta = {
                width: image.width,
                height: image.height,
            };

            const nextImageRefs = [...(imageRefs.current[activePage.id] || [null, null])];
            nextImageRefs[imageIndex] = image;
            imageRefs.current[activePage.id] = nextImageRefs;
            setPages((currentPages) =>
                applyTemplateLayout(
                    normalizeSeriesLayout(
                        currentPages.map((page) =>
                            page.id === activePage.id
                                ? {
                                      ...page,
                                      form: createFormFromRawText(
                                          page.rawText,
                                          page.form,
                                          imageIndex === 0
                                              ? nextImageMeta
                                              : page.imageMetas[0],
                                          selectedCategory?.palette,
                                      ),
                                      imageMetas: page.imageMetas.map((imageMeta, index) =>
                                          index === imageIndex ? nextImageMeta : imageMeta,
                                      ),
                                      imageUrls: page.imageUrls.map((imageUrl, index) =>
                                          index === imageIndex ? nextImageUrl : imageUrl,
                                      ),
                                  }
                                : page,
                        ),
                    ),
                    selectedTemplate,
                ),
            );
        };

        reader.onload = () => {
            const nextImageDataUrl = typeof reader.result === 'string' ? reader.result : '';

            setPages((currentPages) =>
                currentPages.map((page) =>
                    page.id === activePage.id
                        ? {
                              ...page,
                              imageDataUrls: page.imageDataUrls.map((imageDataUrl, index) =>
                                  index === imageIndex ? nextImageDataUrl : imageDataUrl,
                              ),
                          }
                        : page,
                ),
            );
            setImageLoading(false);
        };

        reader.onerror = () => {
            setImageLoading(false);
            setAiErrorMessage('이미지 파일을 읽지 못했습니다. 다른 이미지로 다시 시도하세요.');
        };

        reader.readAsDataURL(file);
        image.src = nextImageUrl;
    };

    const handleLogoChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (!file) {
            setLogoAsset(null);
            setLogoLoading(false);
            return;
        }

        setLogoAsset(null);
        setLogoLoading(true);
        const reader = new FileReader();

        reader.onload = () => {
            const dataUrl = typeof reader.result === 'string' ? reader.result : '';

            if (!dataUrl) {
                setLogoLoading(false);
                setAiErrorMessage('로고 파일을 읽지 못했습니다. 다른 이미지로 다시 시도하세요.');
                return;
            }

            const image = new Image();
            image.onload = () => {
                void processLogoImage(image, dataUrl)
                    .then((processed) => {
                        setLogoAsset({
                            dataUrl: processed.dataUrl,
                            image: processed.image,
                            name: file.name,
                        });
                    })
                    .catch(() => {
                        // 누끼 처리 실패 시 원본 로고로 폴백.
                        setLogoAsset({
                            dataUrl,
                            image,
                            name: file.name,
                        });
                    })
                    .finally(() => {
                        setLogoLoading(false);
                    });
            };
            image.onerror = () => {
                setLogoLoading(false);
                setAiErrorMessage('로고 이미지를 읽지 못했습니다. 다른 파일로 다시 시도하세요.');
            };
            image.src = dataUrl;
        };

        reader.onerror = () => {
            setLogoLoading(false);
            setAiErrorMessage('로고 파일을 읽지 못했습니다. 다른 이미지로 다시 시도하세요.');
        };

        reader.readAsDataURL(file);
    };

    const generateAiImages = async () => {
        setAiErrorMessage('');

        if (aiLoading) {
            return;
        }

        if (imageLoading) {
            setAiErrorMessage('이미지 파일을 읽는 중입니다. 잠시 후 다시 시도하세요.');
            return;
        }

        if (logoLoading) {
            setAiErrorMessage('로고 이미지를 읽는 중입니다. 잠시 후 다시 시도하세요.');
            return;
        }

        const seriesPages = applyTemplateLayout(normalizeSeriesLayout(pages), selectedTemplate);
        setPages(seriesPages);

        const targetPages = seriesPages.filter((page) => page.rawText.trim());

        if (targetPages.length === 0) {
            setAiErrorMessage('AI 생성을 하려면 최소 1개의 카드 원고를 입력하세요.');
            return;
        }

        setAiLoading(true);
        cancelledRef.current = false;
        runAbortRef.current = new AbortController();
        generationStartRef.current = Date.now();
        setGenerationElapsedSeconds(0);
        setRunCardIds(targetPages.map((page) => page.id));
        setRunUsage({ cards: 0, cost: 0, tokens: 0 });
        // 이번 생성 run에 적용할 랜덤 레이아웃 스타일(다양성 ON일 때). 한 run 내 카드는 동일 스타일로 통일.
        const runStyleDirective = diverseStyle ? pickRandomStylePreset() : undefined;
        // 브랜드 위치/스타일은 생성마다 랜덤, 단 이번 run의 모든 카드는 동일(첫 장 위치 고정).
        const runBrandPreset = pickRandomBrandPreset();
        // 이번 run의 카테고리 고정(생성 중 탭/드롭다운을 바꿔도 이 run엔 영향 없음).
        const runCategory = selectedCategory;
        const generationTargets = targetPages.map((page, index) => {
            const pageBannerSize =
                bannerSizes.find((bannerSize) => bannerSize.id === page.bannerSizeId) ||
                bannerSizes[0];
            const requestId = `${page.id}-${Date.now()}-${index}`;
            const createdAt = new Date().toLocaleString('ko-KR', {
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                month: '2-digit',
            });
            const title = page.form.title.split('\n').filter(Boolean)[0] || `카드 ${index + 1}`;

            return {
                createdAt,
                index,
                page,
                pageBannerSize,
                requestId,
                title,
            };
        });

        setPages((currentPages) =>
            currentPages.map((currentPage) =>
                targetPages.some((page) => page.id === currentPage.id)
                    ? {
                          ...currentPage,
                          status: 'loading',
                          statusMessage: '생성 대기 중',
                      }
                    : currentPage,
            ),
        );
        setAiHistory((currentHistory) => [
            ...generationTargets.map((target) => ({
                badge: target.page.form.badge || '브랜드 없음',
                createdAt: target.createdAt,
                id: target.requestId,
                message: `카드 ${target.index + 1} AI 이미지 생성을 준비 중입니다.`,
                status: 'loading' as const,
                title: target.title,
            })),
            ...currentHistory,
        ]);

        const generateOneCard = async (
            target: (typeof generationTargets)[number],
            options: {
                campaignStyleReferenceImageDataUrls: string[];
                includeReferenceLibrary: boolean;
                statusMessage: string;
            },
        ) => {
            const { index, page, pageBannerSize, requestId } = target;
            const cardStartedAt = Date.now();

            setPages((currentPages) =>
                currentPages.map((currentPage) =>
                    currentPage.id === page.id
                        ? {
                              ...currentPage,
                              status: 'loading',
                              statusMessage: options.statusMessage,
                          }
                        : currentPage,
                ),
            );
            setAiHistory((currentHistory) =>
                currentHistory.map((item) =>
                    item.id === requestId
                        ? {
                              ...item,
                              message: `카드 ${index + 1} ${options.statusMessage}`,
                          }
                        : item,
                ),
            );

            try {
                const maskedImageDataUrls = await Promise.all(
                    page.imageDataUrls
                        .filter(Boolean)
                        .slice(0, 1)
                        .map((imageDataUrl) =>
                            maskBrandAreaForAiReference(
                                imageDataUrl,
                                pageBannerSize,
                                page.form.backgroundColor || '#ffffff',
                            ),
                        ),
                );
                // AI 에는 브랜드명을 뺀 카피를 보낸다(코너 브랜드는 우리가 합성). 큰 브랜드명 중복 방지.
                const brandName = page.form.badge || '';
                // AI 에는 브랜드명을 한 글자도 보내지 않는다(badge 제거 + 카피에서 제거).
                // 브랜드는 오직 우리가 page.form 으로 코너에 합성하므로, AI 가 큰 브랜드명을 그릴 근거 자체가 없다.
                const aiForm = brandName
                    ? {
                          ...page.form,
                          badge: '',
                          title: stripBrandFromCopy(page.form.title, brandName),
                          subtitle: stripBrandFromCopy(page.form.subtitle, brandName),
                          emphasis: stripBrandFromCopy(page.form.emphasis, brandName),
                          cta: stripBrandFromCopy(page.form.cta, brandName),
                      }
                    : page.form;
                const aiRawText = brandName
                    ? stripBrandFromCopy(page.rawText, brandName)
                    : page.rawText;
                const result = await generateAiCardImage({
                    bannerSize: pageBannerSize,
                    brandCorner: runBrandPreset.corner,
                    categoryDirective: runCategory?.directive,
                    campaignStyleReferenceImageDataUrls:
                        options.campaignStyleReferenceImageDataUrls.slice(0, 1),
                    form: aiForm,
                    imageDataUrls: maskedImageDataUrls,
                    imageQuality,
                    logoDataUrl: logoAsset?.dataUrl,
                    provider: imageProvider,
                    rawText: aiRawText,
                    referenceLibraryImageDataUrls: [],
                    signal: runAbortRef.current?.signal,
                    // 로고는 클라이언트 Canvas에서 누끼 처리 후 단일 합성하므로 서버 합성은 끈다.
                    skipServerLogoOverlay: true,
                    styleDirective: runStyleDirective,
                    templateDirection: selectedTemplate?.aiDirection,
                    templateName: selectedTemplate?.name,
                });
                const normalizedImageDataUrl = await composeFinalCardImage(
                    result.imageDataUrl,
                    page.form,
                    pageBannerSize,
                    runBrandPreset,
                    logoAsset?.image || null,
                );

                setAiGeneratedImageUrl(normalizedImageDataUrl);
                setPages((currentPages) =>
                    currentPages.map((currentPage) =>
                        currentPage.id === page.id
                            ? {
                                  ...currentPage,
                                  resultImageUrl: normalizedImageDataUrl,
                                  status: 'success',
                                  statusMessage: 'AI 이미지 생성 완료',
                              }
                            : currentPage,
                    ),
                );
                setAiHistory((currentHistory) =>
                    currentHistory.map((item) =>
                        item.id === requestId
                            ? {
                                  ...item,
                                  imageDataUrl: normalizedImageDataUrl,
                                  message: `카드 ${index + 1} AI 이미지 생성이 완료되었습니다.`,
                                  prompt: result.prompt,
                                  status: 'success',
                              }
                            : item,
                    ),
                );

                const cardCost = computeRecordCostUsd({
                    banner_size: pageBannerSize.id,
                    image_quality: imageQuality,
                    provider: imageProvider,
                    usage_raw: result.usage ?? null,
                });
                setRunUsage((prev) => ({
                    cards: prev.cards + 1,
                    cost: prev.cost + cardCost,
                    tokens: prev.tokens + (result.usage?.total_tokens || 0),
                }));
                void logApiUsage({
                    banner_size: pageBannerSize.id,
                    cost_usd: cardCost,
                    elapsed_ms: Date.now() - cardStartedAt,
                    image_quality: imageQuality,
                    model: 'gpt-5.5',
                    operator_name: operatorName || null,
                    provider: imageProvider,
                    status: 'success',
                    total_tokens: result.usage?.total_tokens ?? null,
                    usage_raw: result.usage ?? null,
                    user_email: user?.email ?? null,
                });

                // 작업 기록 저장(작업자·카테고리·시간 + 썸네일/원본). 실패해도 생성엔 영향 없음.
                void (async () => {
                    try {
                        const thumb = await makeBannerThumb(normalizedImageDataUrl);
                        await saveBannerOutput({
                            banner_size: pageBannerSize.id,
                            category: runCategory?.id || '',
                            category_label: runCategory?.name || '',
                            image_data_url: normalizedImageDataUrl,
                            operator_name: operatorName || null,
                            thumb_data_url: thumb,
                        });
                        setGalleryRefreshKey((key) => key + 1);
                    } catch {
                        // 기록 저장 실패는 무시.
                    }
                })();

                // 디자인 통일성용으로 '원본 AI 이미지'(로고 합성 전)를 반환 → 다음 카드들의 디자인 마스터로 사용.
                return result.imageDataUrl;
            } catch (error) {
                const wasCancelled = cancelledRef.current;
                const message = wasCancelled
                    ? '생성을 취소했습니다.'
                    : error instanceof Error
                      ? error.message
                      : 'AI 이미지 생성에 실패했습니다.';

                if (!wasCancelled) {
                    setAiErrorMessage(message);
                    void logApiUsage({
                        banner_size: pageBannerSize.id,
                        elapsed_ms: Date.now() - cardStartedAt,
                        error_message: message,
                        operator_name: operatorName || null,
                        provider: imageProvider,
                        status: 'error',
                        user_email: user?.email ?? null,
                    });
                }
                setPages((currentPages) =>
                    currentPages.map((currentPage) =>
                        currentPage.id === page.id
                            ? {
                                  ...currentPage,
                                  status: 'error',
                                  statusMessage: message,
                              }
                            : currentPage,
                    ),
                );
                setAiHistory((currentHistory) =>
                    currentHistory.map((item) =>
                        item.id === requestId
                            ? {
                                  ...item,
                                  message,
                                  status: 'error',
                              }
                            : item,
                    ),
                );

                return '';
            }
        };

        // 디자인 통일성: 첫 카드를 먼저 생성해 '디자인 마스터'로 삼고,
        // 나머지 카드는 그 원본 이미지를 참조(campaignStyleReference)해 동일한 서체·크기·색·톤으로 생성.
        const generateWithCampaignMaster = async () => {
            const [firstTarget, ...restTargets] = generationTargets;
            if (!firstTarget) {
                return;
            }

            const masterAiImage = await generateOneCard(firstTarget, {
                campaignStyleReferenceImageDataUrls: [],
                includeReferenceLibrary: true,
                statusMessage: restTargets.length
                    ? 'AI 이미지 생성 중(기준 카드)'
                    : 'AI 이미지 생성 중',
            });

            if (cancelledRef.current || restTargets.length === 0) {
                return;
            }

            const masterRef = masterAiImage ? [masterAiImage] : [];

            await runWithConcurrency(
                restTargets,
                Math.min(CARD_GENERATION_CONCURRENCY, restTargets.length),
                async (target) => {
                    await generateOneCard(target, {
                        campaignStyleReferenceImageDataUrls: masterRef,
                        includeReferenceLibrary: true,
                        statusMessage: 'AI 이미지 생성 중(통일 디자인)',
                    });
                },
            );
        };

        try {
            await generateWithCampaignMaster();
        } finally {
            setAiLoading(false);
            runAbortRef.current = null;
        }
    };

    const cancelGeneration = () => {
        cancelledRef.current = true;
        runAbortRef.current?.abort();
        setAiLoading(false);
    };

    const downloadAiImage = () => {
        if (!activeResultImageUrl) {
            return;
        }

        const link = document.createElement('a');
        link.download = `ai-card-banner-${pages.findIndex((page) => page.id === activePage?.id) + 1}.png`;
        link.href = activeResultImageUrl;
        link.click();
    };

    return (
        <div className="grid gap-4">
            <div className="flex gap-1 border-b border-[#e2e8f0]">
                {([['create', '생성'], ['gallery', '작업 기록']] as const).map(([key, label]) => (
                    <button
                        className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                            view === key
                                ? 'border-[#1e40af] text-[#1e40af]'
                                : 'border-transparent text-[#94a3b8]'
                        }`}
                        key={key}
                        onClick={() => setView(key)}
                        type="button"
                    >
                        {label}
                    </button>
                ))}
            </div>

            {view === 'gallery' ? <BannerGalleryView refreshKey={galleryRefreshKey} /> : null}

            <section
                className={`grid gap-6 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)] ${
                    view === 'create' ? '' : 'hidden'
                }`}
            >
            <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-6">
                <div className="mb-6">
                    {/* <h2 className="m-0 text-[22px] font-semibold">썸네일 배너 생성기</h2> */}
                    <p className="mt-2 mb-0 text-sm text-[#6b7280]">
                        간단한 원고를 입력하시고, 이미지는 선택입니다.
                    </p>
                </div>

                <div className="mb-5 grid gap-3">
                    <strong className="text-m text-[#111111]">템플릿 필터</strong>
                    <div className="grid grid-cols-2 gap-2">
                        {templates.map((template) => {
                            const selected = template.id === selectedTemplateId;
                            const disabled = Boolean(template.disabled);

                            return (
                                <Button
                                    className={`rounded-md border px-3 py-3 text-left text-sm ${
                                        disabled
                                            ? 'cursor-not-allowed border-[#e5e7eb] bg-[#f9fafb] text-[#9ca3af] opacity-70'
                                            : selected
                                              ? 'border-[#ff5a00] bg-[#fff4ed] text-[#111827]'
                                              : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                    }`}
                                    disabled={disabled}
                                    key={template.id}
                                    onClick={() => selectTemplate(template.id)}
                                    type="button"
                                >
                                    <span className="block font-semibold">{template.name}</span>
                                    <span className="mt-1 block text-xs">{template.category}</span>
                                </Button>
                            );
                        })}
                    </div>
                    {selectedTemplate ? (
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            {selectedTemplate.description}
                        </p>
                    ) : null}
                </div>

                <div className="grid gap-4">
                    <div className="grid gap-2">
                        <strong className="text-m text-[#111111]">배너 사이즈</strong>
                        <div className="grid grid-cols-2 gap-2">
                            {bannerSizes.map((bannerSize) => {
                                const selected = bannerSize.id === activePage?.bannerSizeId;

                                return (
                                    <Button
                                        className={`rounded-md border px-3 py-3 text-left text-sm ${
                                            selected
                                                ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                                : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                        }`}
                                        key={bannerSize.id}
                                        onClick={() => updateActivePageBannerSize(bannerSize.id)}
                                        type="button"
                                    >
                                        <span className="block font-semibold">{bannerSize.name}</span>
                                        <span className="mt-1 block text-xs">{bannerSize.label}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <strong className="text-m text-[#111111]">카드 페이지</strong>
                            <Button
                                className="inline-flex h-9 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={pages.length >= 10 || aiLoading}
                                onClick={addPage}
                                type="button"
                            >
                                + 카드 추가
                            </Button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {pages.map((page) => {
                                const selected = page.id === activePage?.id;
                                const statusLabel =
                                    page.status === 'loading'
                                        ? '생성 중'
                                        : page.status === 'success'
                                          ? '완료'
                                          : page.status === 'error'
                                            ? '실패'
                                          : '대기';
                                const pageBannerSize =
                                    bannerSizes.find(
                                        (bannerSize) => bannerSize.id === page.bannerSizeId,
                                    ) || bannerSizes[0];

                                return (
                                    <Button
                                        className={`rounded-md border px-3 py-2 text-left text-xs ${
                                            selected
                                                ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                                : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                        }`}
                                        key={page.id}
                                        onClick={() => setActivePageId(page.id)}
                                        type="button"
                                    >
                                        <span className="block font-semibold">
                                            {statusLabel} · {pageBannerSize.name}
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="grid gap-3">
                        <strong className="text-m font-semibold text-[#111111]">
                            카드뉴스 원고 {pages.findIndex((page) => page.id === activePage?.id) + 1}
                        </strong>
                        <label className="grid gap-2 text-sm font-semibold text-[#111111]">
                            제목
                            <textarea
                                className="min-h-[84px] resize-y rounded-md border border-[#d1d5db] px-3 py-3 text-sm leading-6 font-normal placeholder:text-[#b7bdc8]"
                                onChange={(event) =>
                                    activePage &&
                                    updatePageTextField(activePage.id, 'title', event.target.value)
                                }
                                placeholder="분당 영어학원 선택, 기준은 하나입니다"
                                value={form.title}
                            />
                        </label>
                        <label className="grid gap-2 text-sm font-semibold text-[#111111]">
                            내용
                            <textarea
                                className="min-h-[132px] resize-y rounded-md border border-[#d1d5db] px-3 py-3 text-sm leading-6 font-normal placeholder:text-[#b7bdc8]"
                                onChange={(event) =>
                                    activePage &&
                                    updatePageTextField(
                                        activePage.id,
                                        'subtitle',
                                        event.target.value,
                                    )
                                }
                                placeholder={`학원 끝나고
집에 혼자 있는 아이
괜찮을까요?`}
                                value={form.subtitle}
                            />
                        </label>
                        <label className="grid gap-2 text-sm font-semibold text-[#111111]">
                            강조 문구
                            <textarea
                                className="min-h-[72px] resize-y rounded-md border border-[#d1d5db] px-3 py-3 text-sm leading-6 font-normal placeholder:text-[#b7bdc8]"
                                onChange={(event) =>
                                    activePage &&
                                    updatePageTextField(
                                        activePage.id,
                                        'emphasis',
                                        event.target.value,
                                    )
                                }
                                placeholder="메디 25케어가 도와드리겠습니다."
                                value={form.emphasis}
                            />
                        </label>
                    </div>

                    <label className="grid gap-2 text-sm font-semibold text-[#111111]">
                        통원고 붙여넣기 / 자동 분리
                        <textarea
                            className="min-h-[96px] resize-y rounded-md border border-[#d1d5db] px-3 py-3 text-sm leading-6 font-normal placeholder:text-[#b7bdc8]"
                            onChange={(event) =>
                                activePage && updatePageRawText(activePage.id, event.target.value)
                            }
                            placeholder={`분당 영어학원 선택,
기준은 하나입니다
누가 가르치느냐
어떻게 가르치느냐

그 차이가 결과입니다`}
                            value={activePage?.rawText || ''}
                        />
                    </label>

                    <div className="grid gap-2">
                        <strong className="text-m text-[#111111]">참고 이미지</strong>
                        {[0, 1].map((imageIndex) => (
                            <label className="grid gap-2 text-xs font-semibold" key={imageIndex}>
                                참고 이미지 {imageIndex + 1}
                                <input
                                    accept="image/*"
                                    className="rounded-md border border-[#d1d5db] bg-white px-3 py-2 text-sm font-normal text-[#9ca3af] file:mr-3 file:rounded-md file:border-0 file:bg-[#f3f4f6] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#6b7280]"
                                    onChange={(event) => handleImageChange(event, imageIndex)}
                                    type="file"
                                />
                            </label>
                        ))}
                    </div>

                    {pages.length > 1 ? (
                        <Button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#fca5a5] bg-white px-3 text-sm font-semibold text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={aiLoading}
                            onClick={() => activePage && removePage(activePage.id)}
                            type="button"
                        >
                            현재 카드 삭제
                        </Button>
                    ) : null}

                    <label className="grid gap-2 text-m font-semibold text-[#111111]">
                        브랜드명 (선택)
                        <input
                            className="rounded-md border border-[#d1d5db] px-3 py-2 text-sm font-normal placeholder:text-[#b7bdc8]"
                            onChange={(event) => updateForm('badge', event.target.value)}
                            placeholder="DDMKT"
                            value={form.badge}
                        />
                    </label>

                    <label className="grid gap-2 text-sm font-semibold text-[#111111]">
                        브랜드 로고 이미지
                        <input
                            accept="image/*"
                            className="rounded-md border border-[#d1d5db] bg-white px-3 py-2 text-sm font-normal text-[#9ca3af] file:mr-3 file:rounded-md file:border-0 file:bg-[#f3f4f6] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#6b7280]"
                            onChange={handleLogoChange}
                            type="file"
                        />
                        {logoAsset ? (
                            <span className="text-xs font-normal text-[#6b7280]">
                                {logoAsset.name} · 모든 카드에 동일 위치로 적용
                            </span>
                        ) : logoLoading ? (
                            <span className="text-xs font-normal text-[#6b7280]">
                                로고 배경을 제거하는 중입니다. (최초 1회 모델 다운로드로 다소 걸릴 수 있어요)
                            </span>
                        ) : null}
                    </label>

                    <div className="flex items-center justify-between gap-3">
                        <strong className="text-m text-[#111111]">컬러</strong>
                        <Button
                            className="inline-flex h-9 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827]"
                            onClick={applyRandomColors}
                            type="button"
                        >
                            랜덤 컬러
                        </Button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <label className="grid gap-2 text-xs font-semibold">
                            배경
                            <input
                                className="h-10 w-full rounded-md border border-[#d1d5db]"
                                onChange={(event) =>
                                    updateForm('backgroundColor', event.target.value)
                                }
                                type="color"
                                value={form.backgroundColor}
                            />
                        </label>
                        <label className="grid gap-2 text-xs font-semibold">
                            포인트
                            <input
                                className="h-10 w-full rounded-md border border-[#d1d5db]"
                                onChange={(event) => updateForm('accentColor', event.target.value)}
                                type="color"
                                value={form.accentColor}
                            />
                        </label>
                        <label className="grid gap-2 text-xs font-semibold">
                            텍스트
                            <input
                                className="h-10 w-full rounded-md border border-[#d1d5db]"
                                onChange={(event) => updateForm('textColor', event.target.value)}
                                type="color"
                                value={form.textColor}
                            />
                        </label>
                    </div>

                    <div className="grid gap-2">
                        <strong className="text-m text-[#111111]">내 이름(작업자)</strong>
                        <input
                            className="h-11 w-full rounded-md border border-[#d1d5db] bg-white px-3 text-sm font-semibold text-[#111827]"
                            onChange={(event) => {
                                const value = event.target.value;
                                setOperatorName(value);
                                localStorage.setItem('erp_operator_name', value);
                            }}
                            placeholder="예: 홍길동"
                            type="text"
                            value={operatorName}
                        />
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            여러 명이 함께 쓸 때 누가 생성했는지 사용량 기록에 남깁니다. (이 기기에 저장)
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <strong className="text-m text-[#111111]">업종 카테고리(무드)</strong>
                        <select
                            className="h-11 w-full rounded-md border border-[#d1d5db] bg-white px-3 text-sm font-semibold text-[#111827]"
                            onChange={(event) => handleSelectCategory(event.target.value)}
                            value={selectedCategoryId}
                        >
                            <option value="">미지정 (자동)</option>
                            {CATEGORY_PRESETS.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            업종을 고르면 그 업종에 맞는 색감·이미지 무드로 생성됩니다. (색상은 자동
                            적용되며, 아래 색상 피커로 직접 바꾸면 그 값이 우선)
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <strong className="text-m text-[#111111]">디자인 다양성</strong>
                        <Button
                            className={`h-11 rounded-md border px-3 text-sm font-semibold ${
                                diverseStyle
                                    ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                    : 'border-[#d1d5db] bg-white text-[#4b5563]'
                            }`}
                            onClick={() => setDiverseStyle((value) => !value)}
                            type="button"
                        >
                            {diverseStyle
                                ? '랜덤 다양 ON · 생성마다 다른 레이아웃'
                                : '랜덤 다양 OFF · 기본 레이아웃'}
                        </Button>
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            켜면 생성할 때마다 레이아웃·구성을 랜덤으로 다양하게 만듭니다. (색상·문구는
                            입력값 유지)
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <strong className="text-sm text-[#111111]">이미지 생성 API</strong>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                ['openai', 'GPT'],
                                ['gemini', 'Gemini'],
                            ].map(([provider, label]) => {
                                const selected = imageProvider === provider;

                                return (
                                    <Button
                                        className={`h-11 rounded-md border px-3 text-sm font-semibold ${
                                            selected
                                                ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                                : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                        }`}
                                        key={provider}
                                        onClick={() => setImageProvider(provider as ImageProvider)}
                                        type="button"
                                    >
                                        {label}
                                    </Button>
                                );
                            })}
                        </div>
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            선택한 API는 다음 생성부터 적용됩니다.
                        </p>
                    </div>

                    <div className="grid gap-2">
                        <strong className="text-sm text-[#111111]">이미지 품질</strong>
                        <div className="grid grid-cols-3 gap-2">
                            {(
                                [
                                    ['low', '낮음 · 빠름/저렴'],
                                    ['medium', '보통 · 권장'],
                                    ['high', '높음 · 느림/비쌈'],
                                ] as Array<[ImageQuality, string]>
                            ).map(([value, label]) => {
                                const selected = imageQuality === value;

                                return (
                                    <Button
                                        className={`h-11 rounded-md border px-2 text-xs font-semibold ${
                                            selected
                                                ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                                : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                        }`}
                                        key={value}
                                        onClick={() => setImageQuality(value)}
                                        type="button"
                                    >
                                        {label}
                                    </Button>
                                );
                            })}
                        </div>
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            품질이 높을수록 글자·디테일이 선명하지만 생성 시간과 비용이 늘어납니다.
                        </p>
                    </div>

                    <Button
                        className="inline-flex h-12 items-center justify-center rounded-md bg-[#1457ff] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={aiLoading || imageLoading || logoLoading}
                        onClick={() => {
                            void generateAiImages();
                        }}
                        type="button"
                    >
                        {imageLoading
                            ? '이미지 읽는 중...'
                            : logoLoading
                              ? '로고 배경 제거 중...'
                            : aiLoading
                              ? `AI 카드 생성 중... ${generationElapsedSeconds}초 (${runDoneCount}/${runCardIds.length} 완료)`
                              : `AI로 ${pages.length}장 생성`}
                    </Button>

                    {aiLoading ? (
                        <Button
                            className="inline-flex h-11 items-center justify-center rounded-md border border-[#fca5a5] bg-white px-5 text-sm font-semibold text-[#b91c1c]"
                            onClick={cancelGeneration}
                            type="button"
                        >
                            생성 중단
                        </Button>
                    ) : null}

                    {aiErrorMessage ? (
                        <p className="m-0 rounded-md bg-[#fef2f2] px-3 py-2 text-sm leading-6 text-[#b91c1c]">
                            {aiErrorMessage}
                        </p>
                    ) : null}

                    {runUsage.cards > 0 ? (
                        <p className="m-0 rounded-md bg-[#f0f9ff] px-3 py-2 text-xs leading-5 text-[#0369a1]">
                            이번 생성 {runUsage.cards}장 · 토큰{' '}
                            {runUsage.tokens.toLocaleString('ko-KR')} · {formatUsd(runUsage.cost)} ·{' '}
                            {formatKrw(runUsage.cost)}
                        </p>
                    ) : null}
                </div>
            </div>

            <div>
                <div className="rounded-[8px] border border-[#e5e7eb] bg-white p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="m-0 text-[18px] font-semibold">미리보기</h2>
                            <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                                {selectedTemplate?.name} · {layoutLabels[form.layoutVariant]}
                            </p>
                        </div>
                        <span className="text-sm text-[#6b7280]">
                            {selectedBannerSize.label} PNG
                        </span>
                    </div>
                    <div
                        className="mx-auto w-full max-w-[720px] overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-[#f3f4f6]"
                        style={{
                            aspectRatio: `${selectedBannerSize.width} / ${selectedBannerSize.height}`,
                        }}
                    >
                        <canvas
                            className="block h-auto w-full"
                            height={selectedBannerSize.height}
                            ref={canvasRef}
                            width={selectedBannerSize.width}
                        />
                    </div>
                </div>

                <div className="mt-6 rounded-[8px] border border-[#e5e7eb] bg-white p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="m-0 text-[18px] font-semibold">AI 생성 결과</h2>
                            <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                                선택한 카드 결과를 표시하며, 전체 생성은 동시에 진행됩니다.
                            </p>
                        </div>
                        <Button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!activeResultImageUrl}
                            onClick={downloadAiImage}
                            type="button"
                        >
                            AI 결과 다운로드
                        </Button>
                    </div>

                    <div
                        className="mx-auto flex w-full max-w-[720px] items-center justify-center overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-[#f3f4f6]"
                        style={{
                            aspectRatio: `${selectedBannerSize.width} / ${selectedBannerSize.height}`,
                        }}
                    >
                        {activeResultImageUrl ? (
                            <img
                                alt="AI 생성 카드 배너"
                                className="h-full w-full object-contain"
                                src={activeResultImageUrl}
                            />
                        ) : (
                            <p className="m-0 px-6 text-center text-sm leading-6 text-[#6b7280]">
                                왼쪽에서 카드 원고를 입력하고 AI 생성 버튼을 누르면 결과가 여기에 표시됩니다.
                            </p>
                        )}
                    </div>

                    <div className="mt-5 grid gap-3">
                        <h3 className="m-0 text-[15px] font-semibold">페이지별 결과</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                            {pages.map((page, index) => {
                                const selected = page.id === activePage?.id;
                                const pageBannerSize =
                                    bannerSizes.find(
                                        (bannerSize) => bannerSize.id === page.bannerSizeId,
                                    ) || bannerSizes[0];
                                const statusClass =
                                    page.status === 'loading'
                                        ? 'text-[#1457ff]'
                                        : page.status === 'success'
                                          ? 'text-[#047857]'
                                          : page.status === 'error'
                                            ? 'text-[#b91c1c]'
                                            : 'text-[#6b7280]';

                                return (
                                    <button
                                        className={`rounded-[8px] border bg-white p-2 text-left ${
                                            selected ? 'border-[#1457ff]' : 'border-[#e5e7eb]'
                                        }`}
                                        key={page.id}
                                        onClick={() => setActivePageId(page.id)}
                                        type="button"
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <span className="text-xs font-semibold">
                                                카드 {index + 1}
                                            </span>
                                            <span className={`text-xs ${statusClass}`}>
                                                {page.statusMessage}
                                            </span>
                                        </div>
                                        <div
                                            className="flex items-center justify-center overflow-hidden rounded border border-[#e5e7eb] bg-[#f9fafb]"
                                            style={{
                                                aspectRatio: `${pageBannerSize.width} / ${pageBannerSize.height}`,
                                            }}
                                        >
                                            {page.resultImageUrl ? (
                                                <img
                                                    alt={`카드 ${index + 1} AI 생성 결과`}
                                                    className="h-full w-full object-cover"
                                                    src={page.resultImageUrl}
                                                />
                                            ) : (
                                                <span className="px-2 text-center text-xs leading-5 text-[#9ca3af]">
                                                    결과 없음
                                                </span>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="mt-5">
                        <div className="mb-3 flex items-center justify-between gap-4">
                            <h3 className="m-0 text-[15px] font-semibold">생성 기록</h3>
                            <span className="text-xs text-[#6b7280]">
                                최근 {aiHistory.length}건
                            </span>
                        </div>

                        {aiHistory.length > 0 ? (
                            <div className="grid gap-3">
                                {aiHistory.map((item) => {
                                    const statusLabel =
                                        item.status === 'loading'
                                            ? '진행 중'
                                            : item.status === 'success'
                                              ? '완료'
                                              : '실패';
                                    const statusClass =
                                        item.status === 'loading'
                                            ? 'bg-[#eff6ff] text-[#1457ff]'
                                            : item.status === 'success'
                                              ? 'bg-[#ecfdf5] text-[#047857]'
                                              : 'bg-[#fef2f2] text-[#b91c1c]';

                                    return (
                                        <div
                                            className="grid gap-3 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] p-3 sm:grid-cols-[88px_minmax(0,1fr)]"
                                            key={item.id}
                                        >
                                            <div className="flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-md border border-[#e5e7eb] bg-white">
                                                {item.imageDataUrl ? (
                                                    <img
                                                        alt={`${item.title} AI 생성 결과`}
                                                        className="h-full w-full object-cover"
                                                        src={item.imageDataUrl}
                                                    />
                                                ) : (
                                                    <span className="px-2 text-center text-xs leading-5 text-[#9ca3af]">
                                                        이미지 없음
                                                    </span>
                                                )}
                                            </div>

                                            <div className="min-w-0">
                                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                                    <span
                                                        className={`rounded px-2 py-1 text-xs font-semibold ${statusClass}`}
                                                    >
                                                        {statusLabel}
                                                    </span>
                                                    <span className="text-xs text-[#6b7280]">
                                                        {item.createdAt}
                                                    </span>
                                                    <span className="text-xs text-[#6b7280]">
                                                        {item.badge}
                                                    </span>
                                                </div>
                                                <p className="m-0 truncate text-sm font-semibold text-[#111827]">
                                                    {item.title}
                                                </p>
                                                <p className="mt-1 mb-0 text-xs leading-5 text-[#6b7280]">
                                                    {item.message}
                                                </p>
                                                {item.imageDataUrl ? (
                                                    <Button
                                                        className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827]"
                                                        onClick={() =>
                                                            setAiGeneratedImageUrl(
                                                                item.imageDataUrl || '',
                                                            )
                                                        }
                                                        type="button"
                                                    >
                                                        결과 다시 보기
                                                    </Button>
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="m-0 rounded-[8px] border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-sm leading-6 text-[#6b7280]">
                                AI 생성 버튼을 누르면 진행 중, 완료, 실패 기록이 여기에 표시됩니다.
                            </p>
                        )}
                    </div>
                </div>
            </div>
            </section>
        </div>
    );
}

export default BannerGeneratorPage;

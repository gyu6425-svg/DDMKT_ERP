import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { generateAiCardImage } from '../api/aiCardImage';

const CANVAS_SIZE = 1254;
const fontFamily = 'Montserrat, "Malgun Gothic", Arial, sans-serif';

type TemplateId = 'template-1' | 'template-2' | 'template-3' | 'template-4';
type LayoutVariant = 'education' | 'product' | 'photo' | 'compact' | 'chalkboard' | 'playful';

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

function createCardNewsPage(index: number, baseForm: BannerForm = defaultForm): CardNewsPage {
    return {
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
): BannerForm {
    const normalizedText = normalizeCopyText(rawText);

    if (!normalizedText) {
        return currentForm;
    }

    const analyzedCopy = analyzeCopyText(normalizedText);
    const layoutVariant = inferLayoutVariant(normalizedText, imageMeta);
    const colors = inferColors(normalizedText, layoutVariant);

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

function drawBanner(
    context: CanvasRenderingContext2D,
    form: BannerForm,
    image: HTMLImageElement | null,
) {
    context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    drawTemplateOne(context, form, image);
}

function createLocalBannerDataUrl(form: BannerForm, image: HTMLImageElement | null) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;

    if (!context) {
        return '';
    }

    drawBanner(context, form, image);
    return canvas.toDataURL('image/png');
}

function BannerGeneratorPage() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRefs = useRef<Record<string, Array<HTMLImageElement | null>>>({});
    const [aiErrorMessage, setAiErrorMessage] = useState('');
    const [aiGeneratedImageUrl, setAiGeneratedImageUrl] = useState('');
    const [aiHistory, setAiHistory] = useState<AiGenerationHistoryItem[]>([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [imageLoading, setImageLoading] = useState(false);
    const [imageProvider, setImageProvider] = useState<ImageProvider>('openai');
    const [pages, setPages] = useState<CardNewsPage[]>(() => [createCardNewsPage(1)]);
    const [activePageId, setActivePageId] = useState(() => pages[0]?.id || '');
    const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>('template-1');
    const pagesRef = useRef(pages);
    const activePage = pages.find((page) => page.id === activePageId) || pages[0];
    const form = activePage?.form || defaultForm;
    const activeResultImageUrl = activePage?.resultImageUrl || aiGeneratedImageUrl;
    const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

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

        drawBanner(context, form, imageRefs.current[activePage?.id || '']?.[0] || null);
    }, [activePage?.id, activePage?.imageUrls, form]);

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
        if (pages.length >= 3) {
            return;
        }

        const nextPage = createCardNewsPage(pages.length + 1, form);
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

    const generateAiImages = async () => {
        setAiErrorMessage('');

        if (aiLoading) {
            return;
        }

        if (imageLoading) {
            setAiErrorMessage('이미지 파일을 읽는 중입니다. 잠시 후 다시 시도하세요.');
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
        const seriesStyleReferenceImageDataUrls: string[] = [];

        for (const [index, page] of targetPages.entries()) {
            const requestId = `${page.id}-${Date.now()}`;
            const createdAt = new Date().toLocaleString('ko-KR', {
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                month: '2-digit',
            });
            const title = page.form.title.split('\n').filter(Boolean)[0] || `카드 ${index + 1}`;

            setActivePageId(page.id);
            setPages((currentPages) =>
                currentPages.map((currentPage) =>
                    currentPage.id === page.id
                        ? {
                              ...currentPage,
                              status: 'loading',
                              statusMessage: 'AI 이미지 생성 중',
                          }
                        : currentPage,
                ),
            );
            setAiHistory((currentHistory) => [
                {
                    badge: page.form.badge || '배지 없음',
                    createdAt,
                    id: requestId,
                    message: `카드 ${index + 1} AI 이미지 생성을 요청했습니다.`,
                    status: 'loading',
                    title,
                },
                ...currentHistory,
            ]);

            try {
                const result = await generateAiCardImage({
                    form: page.form,
                    imageDataUrls: page.imageDataUrls.filter(Boolean),
                    provider: imageProvider,
                    rawText: page.rawText,
                    seriesStyleReferenceImageDataUrls,
                    templateDirection: selectedTemplate?.aiDirection,
                    templateName: selectedTemplate?.name,
                });

                if (!seriesStyleReferenceImageDataUrls.includes(result.imageDataUrl)) {
                    seriesStyleReferenceImageDataUrls.push(result.imageDataUrl);
                }

                setAiGeneratedImageUrl(result.imageDataUrl);
                setPages((currentPages) =>
                    currentPages.map((currentPage) =>
                        currentPage.id === page.id
                            ? {
                                  ...currentPage,
                                  resultImageUrl: result.imageDataUrl,
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
                                  imageDataUrl: result.imageDataUrl,
                                  message: `카드 ${index + 1} AI 이미지 생성이 완료되었습니다.`,
                                  prompt: result.prompt,
                                  status: 'success',
                              }
                            : item,
                    ),
                );
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : 'AI 이미지 생성에 실패했습니다.';
                const fallbackImageUrl =
                    imageProvider === 'gemini'
                        ? createLocalBannerDataUrl(
                              page.form,
                              imageRefs.current[page.id]?.[0] || null,
                          )
                        : '';

                if (fallbackImageUrl) {
                    const fallbackMessage = `Gemini 호출 실패: ${message} 앱 미리보기 이미지로 대체했습니다.`;

                    setAiGeneratedImageUrl(fallbackImageUrl);
                    setAiErrorMessage(fallbackMessage);
                    setPages((currentPages) =>
                        currentPages.map((currentPage) =>
                            currentPage.id === page.id
                                ? {
                                      ...currentPage,
                                      resultImageUrl: fallbackImageUrl,
                                      status: 'success',
                                      statusMessage: '앱 미리보기로 대체',
                                  }
                                : currentPage,
                        ),
                    );
                    setAiHistory((currentHistory) =>
                        currentHistory.map((item) =>
                            item.id === requestId
                                ? {
                                      ...item,
                                      imageDataUrl: fallbackImageUrl,
                                      message: fallbackMessage,
                                      status: 'success',
                                  }
                                : item,
                        ),
                    );
                    continue;
                }

                setAiErrorMessage(message);
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
                break;
            }
        }

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
        <section className="grid gap-6 xl:grid-cols-[minmax(320px,440px)_minmax(0,1fr)]">
            <div className="rounded-[40px] border border-[#e5e7eb] bg-white p-6">
                <div className="mb-6">
                    <h2 className="m-0 text-[22px] font-semibold">썸네일 배너 생성기</h2>
                    <p className="mt-2 mb-0 text-sm text-[#6b7280]">
                        원고만 입력해도 AI 카드 배너를 생성할 수 있고, 이미지는 선택 사항입니다.
                    </p>
                </div>

                <div className="mb-5 grid gap-3">
                    <strong className="text-sm">템플릿 필터</strong>
                    <div className="grid grid-cols-2 gap-2">
                        {templates.map((template) => {
                            const selected = template.id === selectedTemplateId;
                            const disabled = Boolean(template.disabled);

                            return (
                                <button
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
                                </button>
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
                    <div className="grid gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <strong className="text-sm">카드 페이지</strong>
                            <button
                                className="inline-flex h-9 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={pages.length >= 3 || aiLoading}
                                onClick={addPage}
                                type="button"
                            >
                                + 카드 추가
                            </button>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {pages.map((page, index) => {
                                const selected = page.id === activePage?.id;
                                const statusLabel =
                                    page.status === 'loading'
                                        ? '생성 중'
                                        : page.status === 'success'
                                          ? '완료'
                                          : page.status === 'error'
                                            ? '실패'
                                            : '대기';

                                return (
                                    <button
                                        className={`rounded-md border px-3 py-2 text-left text-xs ${
                                            selected
                                                ? 'border-[#1457ff] bg-[#eff6ff] text-[#111827]'
                                                : 'border-[#d1d5db] bg-white text-[#4b5563]'
                                        }`}
                                        key={page.id}
                                        onClick={() => setActivePageId(page.id)}
                                        type="button"
                                    >
                                        <span className="block font-semibold">카드 {index + 1}</span>
                                        <span className="mt-1 block">{statusLabel}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <label className="grid gap-2 text-sm font-semibold">
                        카드뉴스 원고 {pages.findIndex((page) => page.id === activePage?.id) + 1}
                        <textarea
                            className="min-h-[180px] resize-y rounded-md border border-[#d1d5db] px-3 py-3 text-sm leading-6 font-normal placeholder:text-[#b7bdc8]"
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
                        <strong className="text-sm">참고 이미지 (선택, 최대 2장)</strong>
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
                        <button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#fca5a5] bg-white px-3 text-sm font-semibold text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={aiLoading}
                            onClick={() => activePage && removePage(activePage.id)}
                            type="button"
                        >
                            현재 카드 삭제
                        </button>
                    ) : null}

                    <label className="grid gap-2 text-sm font-semibold">
                        배지
                        <input
                            className="rounded-md border border-[#d1d5db] px-3 py-2 text-sm font-normal placeholder:text-[#b7bdc8]"
                            onChange={(event) => updateForm('badge', event.target.value)}
                            placeholder="DDMKT"
                            value={form.badge}
                        />
                    </label>

                    <div className="flex items-center justify-between gap-3">
                        <strong className="text-sm">컬러</strong>
                        <button
                            className="inline-flex h-9 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827]"
                            onClick={applyRandomColors}
                            type="button"
                        >
                            랜덤 컬러
                        </button>
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
                        <strong className="text-sm">이미지 생성 API</strong>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                ['openai', 'GPT'],
                                ['gemini', 'Gemini'],
                            ].map(([provider, label]) => {
                                const selected = imageProvider === provider;

                                return (
                                    <button
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
                                    </button>
                                );
                            })}
                        </div>
                        <p className="m-0 text-xs leading-5 text-[#6b7280]">
                            선택한 API는 다음 생성부터 적용됩니다.
                        </p>
                    </div>

                    <button
                        className="inline-flex h-12 items-center justify-center rounded-md bg-[#1457ff] px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={aiLoading || imageLoading}
                        onClick={() => {
                            void generateAiImages();
                        }}
                        type="button"
                    >
                        {imageLoading
                            ? '이미지 읽는 중...'
                            : aiLoading
                              ? 'AI 카드 생성 중...'
                              : `AI로 ${pages.length}장 생성`}
                    </button>

                    {aiErrorMessage ? (
                        <p className="m-0 rounded-md bg-[#fef2f2] px-3 py-2 text-sm leading-6 text-[#b91c1c]">
                            {aiErrorMessage}
                        </p>
                    ) : null}
                </div>
            </div>

            <div>
                <div className="rounded-[40px] border border-[#e5e7eb] bg-white p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="m-0 text-[18px] font-semibold">미리보기</h2>
                            <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                                {selectedTemplate?.name} · {layoutLabels[form.layoutVariant]}
                            </p>
                        </div>
                        <span className="text-sm text-[#6b7280]">1254 x 1254 PNG</span>
                    </div>
                    <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-[40px] border border-[#e5e7eb] bg-[#f3f4f6]">
                        <canvas
                            className="block aspect-square h-auto w-full"
                            height={CANVAS_SIZE}
                            ref={canvasRef}
                            width={CANVAS_SIZE}
                        />
                    </div>
                </div>

                <div className="mt-6 rounded-[40px] border border-[#e5e7eb] bg-white p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                            <h2 className="m-0 text-[18px] font-semibold">AI 생성 결과</h2>
                            <p className="mt-1 mb-0 text-sm text-[#6b7280]">
                                선택한 카드 결과를 표시하며, 전체 생성은 카드 순서대로 진행됩니다.
                            </p>
                        </div>
                        <button
                            className="inline-flex h-10 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-4 text-sm font-semibold text-[#111827] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!activeResultImageUrl}
                            onClick={downloadAiImage}
                            type="button"
                        >
                            AI 결과 다운로드
                        </button>
                    </div>

                    <div className="mx-auto flex aspect-square w-full max-w-[720px] items-center justify-center overflow-hidden rounded-[40px] border border-[#e5e7eb] bg-[#f3f4f6]">
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
                                        className={`rounded-md border bg-white p-2 text-left ${
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
                                        <div className="flex aspect-square items-center justify-center overflow-hidden rounded border border-[#e5e7eb] bg-[#f9fafb]">
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
                                            className="grid gap-3 rounded-md border border-[#e5e7eb] bg-[#f9fafb] p-3 sm:grid-cols-[88px_minmax(0,1fr)]"
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
                                                    <button
                                                        className="mt-3 inline-flex h-8 items-center justify-center rounded-md border border-[#d1d5db] bg-white px-3 text-xs font-semibold text-[#111827]"
                                                        onClick={() =>
                                                            setAiGeneratedImageUrl(
                                                                item.imageDataUrl || '',
                                                            )
                                                        }
                                                        type="button"
                                                    >
                                                        결과 다시 보기
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="m-0 rounded-md border border-[#e5e7eb] bg-[#f9fafb] px-3 py-3 text-sm leading-6 text-[#6b7280]">
                                AI 생성 버튼을 누르면 진행 중, 완료, 실패 기록이 여기에 표시됩니다.
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
}

export default BannerGeneratorPage;

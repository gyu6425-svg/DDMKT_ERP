// 범용 현장/사례 — AI 섹션태그 산문 → 최종 원고 body 조립.
//   AI는 산문만 쓰고(===INTRO===/===S1===…/===TAKEAWAY===), 여기서 부제목·표·보일러플레이트·「사진 N」을 순서대로 끼운다.
//   본문은 업종 무관 "섹션 리스트"(텍스트 섹션=AI산문+사진 / 표 섹션=행 그대로). 업종 고정 없음.
//   발행기(parse_body_to_blocks): 「사진 N」=이미지, "부제목 : X"=소제목, 나머지=문단.
//   마커 번호와 images[] 순서는 발행 단계에서 1:1이어야 한다.

export type SpecRow = { item: string; spec: string; qty: string; note: string };

// 본문 섹션 — 텍스트(AI 산문 + 사진) 또는 표(행 그대로 삽입).
export type BodySection =
    | { type: 'text'; title: string; subtitle: string; photoCount: number }
    | { type: 'table'; title: string; subtitle: string; rows: SpecRow[] };

export type CaseStudyForm = {
    sections: BodySection[];
    mastheadCount: number;   // 상단 배너(보통 0~1)
    mapCount: number;        // 회사 위치 지도(보통 0~1)
    boilerplate: string;     // 업체 소개(고정, verbatim)
    phone: string;
    address: string;
};

export type ParsedCaseStudy = {
    intro: string;
    takeaway: string;
    sections: string[];      // 텍스트 섹션 산문(S1..SM, 순서대로)
};

// AI 출력(===TAG=== 산문) 파싱.
export function parseCaseStudySections(text: string): ParsedCaseStudy {
    const out: ParsedCaseStudy = { intro: '', takeaway: '', sections: [] };
    const parts = (text || '').split(/^\s*===([A-Z0-9]+)===\s*$/m);
    if (parts.length <= 1) { out.intro = (text || '').trim(); return out; }
    for (let i = 1; i < parts.length; i += 2) {
        const tag = parts[i];
        const content = (parts[i + 1] || '').trim();
        if (tag === 'INTRO') out.intro = content;
        else if (tag === 'TAKEAWAY') out.takeaway = content;
        else {
            const m = /^S(\d+)$/.exec(tag);
            if (m) out.sections[Number(m[1]) - 1] = content;
        }
    }
    return out;
}

// ── 간편(freeform) 모드 — AI가 소제목까지 나눠 구조화(===SUB=== 첫줄=소제목, 이후 산문) ──
export type FreeformParsed = { intro: string; takeaway: string; sections: Array<{ heading: string; prose: string }> };

export function parseFreeformSections(text: string): FreeformParsed {
    const out: FreeformParsed = { intro: '', takeaway: '', sections: [] };
    const parts = (text || '').split(/^\s*===([A-Z]+)===\s*$/m);
    if (parts.length <= 1) { out.intro = (text || '').trim(); return out; }
    for (let i = 1; i < parts.length; i += 2) {
        const tag = parts[i];
        const content = (parts[i + 1] || '').trim();
        if (tag === 'INTRO') out.intro = content;
        else if (tag === 'TAKEAWAY') out.takeaway = content;
        else if (tag === 'SUB') {
            const nl = content.indexOf('\n');
            const heading = (nl < 0 ? content : content.slice(0, nl)).trim();
            const prose = (nl < 0 ? '' : content.slice(nl + 1)).trim();
            out.sections.push({ heading, prose });
        }
    }
    return out;
}

export function assembleFreeformBody(
    parsed: FreeformParsed,
    fixed: { mastheadCount: number; mapCount: number; boilerplate: string; phone: string; address: string },
): { body: string; markerCount: number } {
    const lines: string[] = [];
    let marker = 0;
    const addMarkers = (count: number) => { for (let i = 0; i < Math.max(0, count | 0); i += 1) { marker += 1; lines.push(`「사진 ${marker}」`); } };
    const para = (s: string) => { if (s && s.trim()) { lines.push('', s.trim(), ''); } };
    para(parsed.intro);
    addMarkers(fixed.mastheadCount);
    parsed.sections.forEach((sec) => { lines.push('', `부제목 : ${sec.heading || '소제목'}`); para(sec.prose); });
    para(parsed.takeaway);
    para(fixed.boilerplate);
    if (fixed.phone.trim()) para(`📞 문의 전화: ${fixed.phone.trim()}`);
    if (fixed.address.trim()) para(fixed.address.trim());
    addMarkers(fixed.mapCount);
    const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { body, markerCount: marker };
}

const subLine = (title: string, subtitle: string) => {
    const t = (title || '').trim() || '소제목';
    const s = (subtitle || '').trim();
    return `부제목 : ${s ? `${t} | ${s}` : t}`;
};

// 파싱된 산문 + 폼 → 최종 body 문자열 + 마커 개수.
export function assembleCaseStudyBody(parsed: ParsedCaseStudy, form: CaseStudyForm): { body: string; markerCount: number } {
    const lines: string[] = [];
    let marker = 0;
    const addMarkers = (count: number) => {
        for (let i = 0; i < Math.max(0, count | 0); i += 1) { marker += 1; lines.push(`「사진 ${marker}」`); }
    };
    const para = (s: string) => { if (s && s.trim()) { lines.push('', s.trim(), ''); } };

    para(parsed.intro);                     // 도입
    addMarkers(form.mastheadCount);         // 상단 배너

    let textIdx = 0;
    form.sections.forEach((sec) => {
        lines.push('', subLine(sec.title, sec.subtitle));
        if (sec.type === 'text') {
            addMarkers(sec.photoCount);
            para(parsed.sections[textIdx] || '');
            textIdx += 1;
        } else {
            const rows = sec.rows.filter((r) => (r.item || r.spec || r.qty || r.note || '').trim());
            if (rows.length) {
                lines.push('', '품목 | 규격 | 수량 | 비고');
                rows.forEach((r) => lines.push(`${r.item || ''} | ${r.spec || ''} | ${r.qty || ''} | ${r.note || ''}`.trim()));
                lines.push('');
            }
        }
    });

    para(parsed.takeaway);
    para(form.boilerplate);
    if (form.phone.trim()) para(`📞 문의 전화: ${form.phone.trim()}`);
    if (form.address.trim()) para(form.address.trim());
    addMarkers(form.mapCount);              // 회사 위치 지도(마지막)

    const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { body, markerCount: marker };
}

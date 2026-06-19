#!/usr/bin/env node
// UserPromptSubmit 훅: 사용자가 입력한 프롬프트를 logs/prompts-YYYY-MM-DD.jsonl 에 기록.
// 목적: 오류추적 — 어떤 프롬프트가 어떤 작업을 유발했는지 사후 확인.
// 주의: stdout 으로 아무것도 출력하지 않는다(UserPromptSubmit 의 stdout 은 컨텍스트에 주입됨).

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function readStdin() {
    return new Promise((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data));
        // stdin 이 없을 경우 대비
        setTimeout(() => resolve(data), 2000);
    });
}

// 로컬(KST) 기준 YYYY-MM-DD
function localDate(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

try {
    const raw = await readStdin();
    let input = {};
    try {
        input = JSON.parse(raw || '{}');
    } catch {
        input = { prompt: raw };
    }

    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const logDir = join(projectDir, 'logs');
    mkdirSync(logDir, { recursive: true });

    const now = new Date();
    const entry = {
        timestamp: now.toISOString(),
        session_id: input.session_id ?? null,
        cwd: input.cwd ?? null,
        prompt: input.prompt ?? '',
    };

    const file = join(logDir, `prompts-${localDate(now)}.jsonl`);
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
} catch (err) {
    // 훅 실패가 사용자 프롬프트 처리를 막지 않도록 stderr 로만 남기고 정상 종료.
    process.stderr.write(`[log-prompt] ${err?.message ?? err}\n`);
}

process.exit(0);

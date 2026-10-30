// SRT / WebVTT reading and writing, plus pairing English and Hindi cues by time.

export type Cue = { start: number; end: number; text: string };

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/;

function toSec(t: string): number {
	const m = t.match(TIME);
	if (!m) return NaN;
	return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
}

/** Parse SRT or VTT. Tags like <i> and {\an8} are dropped; line breaks inside a cue become spaces. */
export function parseSubtitles(src: string): Cue[] {
	const text = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
	const cues: Cue[] = [];
	for (const block of text.split(/\n{2,}/)) {
		const lines = block.split('\n').filter((l) => l.trim() !== '');
		const i = lines.findIndex((l) => l.includes('-->'));
		if (i < 0) continue;
		const [a, b] = lines[i].split('-->');
		const start = toSec(a);
		const end = toSec(b);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
		const body = lines
			.slice(i + 1)
			.join(' ')
			.replace(/<[^>]+>|\{\\[^}]*\}/g, '')
			.replace(/\s+/g, ' ')
			.trim();
		cues.push({ start, end, text: body });
	}
	return cues.sort((x, y) => x.start - y.start);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
function stamp(sec: number): string {
	const ms = Math.round(sec * 1000);
	return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export function toSrt(cues: Cue[]): string {
	return cues
		.filter((c) => c.text.trim())
		.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text.trim()}\n`)
		.join('\n');
}

export type Pair = { start: number; end: number; en: string; hi: string };

/**
 * One line per Hindi cue (the dub's own timing). Each English cue goes to the Hindi cue it
 * overlaps most, so no English text is lost or repeated. With only one language, its cues
 * become the lines and the other side is blank.
 */
export function pairCues(en: Cue[], hi: Cue[]): Pair[] {
	if (!hi.length) return en.map((c) => ({ start: c.start, end: c.end, en: c.text, hi: '' }));
	const out: Pair[] = hi.map((c) => ({ start: c.start, end: c.end, en: '', hi: c.text }));
	for (const e of en) {
		let best = -1;
		let bestOverlap = 0;
		for (let i = 0; i < hi.length; i++) {
			const o = Math.min(e.end, hi[i].end) - Math.max(e.start, hi[i].start);
			if (o > bestOverlap) {
				bestOverlap = o;
				best = i;
			}
		}
		if (best < 0) {
			// No overlap at all: nearest Hindi cue by midpoint.
			const mid = (e.start + e.end) / 2;
			best = hi.reduce((b, c, i) => (Math.abs((c.start + c.end) / 2 - mid) < Math.abs((hi[b].start + hi[b].end) / 2 - mid) ? i : b), 0);
		}
		out[best].en = out[best].en ? `${out[best].en} ${e.text}` : e.text;
	}
	return out;
}

import { error } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { loadSegments } from '#lib/server/jobs.ts';
import { serve } from '#lib/server/storage.ts';
import { toSrt } from '#lib/srt.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

const safe = (s: string) => s.replace(/[^\p{L}\p{N} ._-]+/gu, '').trim().slice(0, 80) || 'video';
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/**
 * Downloads for operators and admins:
 *   dubbed     Hindi video          source   English video
 *   hi-srt     corrected Hindi SRT  en-srt   English SRT
 *   lines-csv  every line: times, English, original Hindi, corrected Hindi, flag, comment
 */
export const GET: RequestHandler = async (event) => {
	const { params, request } = event;
	const id = Number(params.id);
	const [v] = await query<{ title: string; source_key: string | null; dubbed_key: string | null; mime: string | null; original_filename: string }>(
		'SELECT title, source_key, dubbed_key, mime, original_filename FROM videos WHERE id = $1',
		[id]
	);
	if (!v) error(404, 'Video not found');
	const base = safe(v.title);
	// Range requests are a player seeking, not a new download.
	if (!request.headers.get('range')) await track(event, 'file.downloaded', { videoId: id, details: params.kind });

	if (params.kind === 'dubbed' || params.kind === 'source') {
		const key = params.kind === 'dubbed' ? v.dubbed_key : v.source_key;
		if (!key) error(404, params.kind === 'dubbed' ? 'The Hindi video is not ready yet.' : 'No source file.');
		const ext = key.slice(key.lastIndexOf('.'));
		return serve(key, params.kind === 'dubbed' ? 'video/mp4' : (v.mime ?? 'video/mp4'), {
			range: request.headers.get('range'),
			ifRange: request.headers.get('if-range'),
			download: `${base}_${params.kind === 'dubbed' ? 'hindi' : 'english'}${ext}`,
			maxAge: 0
		});
	}

	const segs = await loadSegments(id);
	if (!segs.length) error(404, 'This video has no lines yet.');
	const file = (body: string, name: string, type: string) =>
		new Response('﻿' + body, {
			headers: { 'Content-Type': `${type}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${name}"` }
		});

	switch (params.kind) {
		case 'hi-srt':
			return file(toSrt(segs.map((s) => ({ start: +s.start_sec, end: +s.end_sec, text: s.hi_text }))), `${base}_hindi.srt`, 'application/x-subrip');
		case 'en-srt':
			return file(toSrt(segs.map((s) => ({ start: +s.start_sec, end: +s.end_sec, text: s.en_text }))), `${base}_english.srt`, 'application/x-subrip');
		case 'lines-csv': {
			const head = ['#', 'Start (s)', 'End (s)', 'English', 'Hindi (original)', 'Hindi (corrected)', 'Changed', 'Flag', 'Comment', 'Checked'];
			const rows = segs.map((s, i) => [
				i + 1,
				s.start_sec,
				s.end_sec,
				s.en_text,
				s.hi_text_original,
				s.hi_text,
				s.hi_text !== s.hi_text_original ? 'yes' : '',
				s.flag ?? '',
				s.comment ?? '',
				s.reviewed_at ? 'yes' : ''
			]);
			return file([head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'), `${base}_lines.csv`, 'text/csv');
		}
		default:
			error(404, 'Unknown download');
	}
};

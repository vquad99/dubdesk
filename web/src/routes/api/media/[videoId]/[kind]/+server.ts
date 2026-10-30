import { error } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { serve } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

type Row = {
	source_key: string | null;
	web_key: string | null;
	dubbed_key: string | null;
	audio_key: string | null;
	dubbed_audio_key: string | null;
	peaks_key: string | null;
	mime: string | null;
	allowed: boolean;
};

/**
 * Stream a video's files to the player.
 *   source        English video (the light streaming copy once built, else the upload)
 *   dubbed        Hindi video
 *   audio         English sound only      dubbed-audio   Hindi sound only
 *   peaks         waveform (sent gzip-compressed)
 * Signed-in only; reviewers see only videos they hold or held; other sites cannot embed them.
 */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	// Anti-hotlinking: the browser marks requests from other sites; refuse them.
	const site = request.headers.get('sec-fetch-site');
	if (site && site !== 'same-origin' && site !== 'none') error(403, 'Not available outside DubDesk');

	const user = locals.user!;
	const [v] = await query<Row>(
		`SELECT v.source_key, v.web_key, v.dubbed_key, v.audio_key, v.dubbed_audio_key, v.peaks_key, v.mime,
		        ($2 <> 'reviewer' OR EXISTS (SELECT 1 FROM jobs j WHERE j.video_id = v.id AND j.assigned_to = $3)) AS allowed
		   FROM videos v WHERE v.id = $1`,
		[Number(params.videoId), user.role, user.id]
	);
	if (!v || !v.allowed) error(404, 'Not found');

	const h = request.headers;
	const cond = { range: h.get('range'), ifNoneMatch: h.get('if-none-match'), ifRange: h.get('if-range') };
	switch (params.kind) {
		case 'source': {
			const key = v.web_key ?? v.source_key;
			if (!key) error(404, 'No video yet');
			return serve(key, v.web_key ? 'video/mp4' : (v.mime ?? 'video/mp4'), cond);
		}
		case 'dubbed':
			if (!v.dubbed_key) error(404, 'No Hindi video yet');
			return serve(v.dubbed_key, 'video/mp4', cond);
		case 'audio':
			if (!v.audio_key) error(404, 'Sound-only copy not ready');
			return serve(v.audio_key, 'audio/mp4', cond);
		case 'dubbed-audio':
			if (!v.dubbed_audio_key) error(404, 'Hindi sound-only copy not ready');
			return serve(v.dubbed_audio_key, 'audio/mp4', cond);
		case 'peaks': {
			if (!v.peaks_key) error(404, 'Waveform not ready');
			const gz = /\bgzip\b/.test(h.get('accept-encoding') ?? '');
			const res = gz
				? await serve(v.peaks_key + '.gz', 'application/octet-stream', { ifNoneMatch: cond.ifNoneMatch, encoding: 'gzip' })
				: null;
			return res && res.status !== 404 ? res : serve(v.peaks_key, 'application/octet-stream', { ifNoneMatch: cond.ifNoneMatch });
		}
		default:
			error(404, 'Unknown file');
	}
};

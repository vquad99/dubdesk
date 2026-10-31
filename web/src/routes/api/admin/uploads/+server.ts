import { error, json } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { checkDubbedUpload, checkUpload, startDubbedUpload, startUpload } from '#lib/server/videos.ts';
import { sarvamEnabled } from '#lib/server/sarvam.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

type Body = { title?: string; name?: string; size?: number; mime?: string; lines?: string; dubbedFor?: number };

/**
 * Start a chunked upload and return where to send the parts.
 *   English video:  { title, name, size, mime, lines: 'sarvam' | 'manual' }  (creates the video)
 *   Hindi video:    { dubbedFor: <video id>, name, size }                    (adds the dubbed file)
 */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const b = (await request.json().catch(() => null)) as Body | null;
	if (!b) error(400, 'Body must be JSON');
	const name = String(b.name ?? '').trim().slice(0, 300);
	const size = Number(b.size);

	if (b.dubbedFor !== undefined) {
		const videoId = Number(b.dubbedFor);
		const [v] = await query<{ sarvam_job_id: string | null }>('SELECT sarvam_job_id FROM videos WHERE id = $1', [videoId]);
		if (!v) error(404, 'Video not found');
		if (v.sarvam_job_id) error(409, 'Sarvam makes the Hindi video for this one.');
		const bad = checkDubbedUpload(name, size);
		if (bad) error(400, bad);
		const out = await startDubbedUpload(locals.user!.id, videoId, name, size);
		await track(event, 'video.upload_started', { videoId, details: `Hindi video ${name} (${(size / 1048576).toFixed(1)} MB)` });
		return json(out);
	}

	const title = String(b.title ?? '').trim().slice(0, 300);
	const mime = String(b.mime ?? '');
	if (!title) error(400, 'Give the video a title.');
	if (b.lines !== 'sarvam' && b.lines !== 'manual') error(400, 'Choose where the lines come from: Sarvam or your own transcripts.');
	if (b.lines === 'sarvam' && !sarvamEnabled()) error(400, 'Sarvam is not connected yet. Choose your own transcripts, or add the Sarvam key first.');
	const bad = checkUpload(name, size, mime);
	if (bad) error(400, bad);
	const out = await startUpload(locals.user!.id, title, name, size, mime, b.lines);
	await track(event, 'video.upload_started', { videoId: out.videoId, details: `${name} (${(size / 1048576).toFixed(1)} MB) · lines from ${b.lines === 'sarvam' ? 'Sarvam' : 'own transcripts'}` });
	return json(out);
};

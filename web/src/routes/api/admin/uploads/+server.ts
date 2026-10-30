import { error, json } from '@sveltejs/kit';
import { checkUpload, startUpload } from '#lib/server/videos.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

/** Start a chunked upload: creates the video row and returns where to send the parts. */
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	const b = (await request.json().catch(() => null)) as { title?: string; name?: string; size?: number; mime?: string } | null;
	if (!b) error(400, 'Body must be JSON');
	const title = String(b.title ?? '').trim().slice(0, 300);
	const name = String(b.name ?? '').trim().slice(0, 300);
	const size = Number(b.size);
	const mime = String(b.mime ?? '');
	if (!title) error(400, 'Give the video a title.');
	const bad = checkUpload(name, size, mime);
	if (bad) error(400, bad);
	const out = await startUpload(locals.user!.id, title, name, size, mime);
	await track(event, 'video.upload_started', { videoId: out.videoId, details: `${name} (${(size / 1048576).toFixed(1)} MB)` });
	return json(out);
};

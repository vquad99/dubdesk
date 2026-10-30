import { error, json } from '@sveltejs/kit';
import { finishUpload, getUpload } from '#lib/server/videos.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

/** All parts are in: store the file and start reading its length and waveform. */
export const POST: RequestHandler = async (event) => {
	const { params, locals } = event;
	const u = await getUpload(params.id);
	if (!u || u.user_id !== locals.user!.id) error(404, 'Upload not found');
	if (u.finished_at) return json({ videoId: u.video_id });
	try {
		await finishUpload(u);
		await track(event, 'video.uploaded', { videoId: u.video_id, details: u.file_name });
	} catch (e) {
		error(409, (e as Error).message);
	}
	return json({ videoId: u.video_id });
};

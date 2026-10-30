import { error, json } from '@sveltejs/kit';
import { importSubtitles } from '#lib/server/videos.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

const MAX = 5 * 1024 * 1024;

/** Load English and/or Hindi subtitles (SRT or VTT) as the video's lines. Form fields: en, hi. */
export const POST: RequestHandler = async (event) => {
	const { params, request, locals } = event;
	const form = await request.formData();
	const read = async (name: string) => {
		const f = form.get(name);
		if (!(f instanceof File) || f.size === 0) return null;
		if (f.size > MAX) error(400, `${name.toUpperCase()} file is larger than 5 MB.`);
		return f.text();
	};
	const [en, hi] = [await read('en'), await read('hi')];
	if (!en && !hi) error(400, 'Choose an English or Hindi subtitle file.');
	try {
		const lines = await importSubtitles(Number(params.id), locals.user!.id, en, hi);
		await track(event, 'video.subtitles_loaded', { videoId: Number(params.id), details: `${lines} lines` });
		return json({ lines });
	} catch (e) {
		error(400, (e as Error).message);
	}
};

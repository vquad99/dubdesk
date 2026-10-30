import { error, json } from '@sveltejs/kit';
import { cancelUpload, getUpload, writeChunk } from '#lib/server/videos.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

async function mine(id: string, userId: number) {
	const u = await getUpload(id);
	if (!u || u.user_id !== userId) error(404, 'Upload not found');
	if (u.finished_at) error(409, 'Upload already finished');
	return u;
}

/** How many bytes the server has, so a broken upload can carry on from there. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const u = await mine(params.id, locals.user!.id);
	return json({ received: Number(u.received), size: Number(u.size_bytes) });
};

/** One part of the file: PUT /api/admin/uploads/<id>?offset=<byte offset>, raw bytes as the body. */
export const PUT: RequestHandler = async ({ params, url, request, locals }) => {
	const u = await mine(params.id, locals.user!.id);
	const offset = Number(url.searchParams.get('offset'));
	if (!Number.isInteger(offset) || offset < 0) error(400, 'offset is required');
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length === 0) error(400, 'empty part');
	try {
		return json({ received: await writeChunk(u, offset, bytes) });
	} catch (e) {
		error(409, (e as Error).message);
	}
};

export const DELETE: RequestHandler = async (event) => {
	const u = await mine(event.params.id, event.locals.user!.id);
	await cancelUpload(u);
	await track(event, 'video.upload_cancelled', { details: u.file_name });
	return json({ ok: true });
};

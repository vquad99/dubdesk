import { error } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { serve } from '#lib/server/storage.ts';
import type { RequestHandler } from './$types';

const KIND: Record<string, 'source_key' | 'dubbed_key' | 'peaks_key'> = {
	source: 'source_key',
	dubbed: 'dubbed_key',
	peaks: 'peaks_key'
};

/** Stream a video's files to the player. Reviewers only see videos they hold or held. */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	const col = KIND[params.kind];
	if (!col) error(404, 'Unknown file');
	const user = locals.user!;
	const [v] = await query<{ key: string | null; mime: string | null; allowed: boolean }>(
		`SELECT v.${col} AS key, v.mime,
		        ($2 <> 'reviewer' OR EXISTS (SELECT 1 FROM jobs j WHERE j.video_id = v.id AND j.assigned_to = $3)) AS allowed
		   FROM videos v WHERE v.id = $1`,
		[Number(params.videoId), user.role, user.id]
	);
	if (!v || !v.allowed) error(404, 'Not found');
	if (!v.key) error(404, 'This file does not exist yet');
	const mime = params.kind === 'peaks' ? 'application/octet-stream' : params.kind === 'dubbed' ? 'video/mp4' : (v.mime ?? 'video/mp4');
	return serve(v.key, mime, request.headers.get('range'));
};

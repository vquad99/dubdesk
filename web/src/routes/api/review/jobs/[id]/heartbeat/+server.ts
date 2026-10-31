import { error, json } from '@sveltejs/kit';
import { heartbeat } from '#lib/server/activity.ts';
import { canEdit, loadJob } from '#lib/server/jobs.ts';
import type { RequestHandler } from './$types';

/** The review screen calls this every 30 s while the reviewer is active; it adds up working time. */
export const POST: RequestHandler = async ({ params, locals }) => {
	const data = await loadJob(Number(params.id));
	if (!data) error(404, 'Job not found');
	if (!canEdit(data.job, locals.user!.id)) return json({ counted: false });
	await heartbeat(data.job.id, locals.user!.id);
	return json({ counted: true });
};

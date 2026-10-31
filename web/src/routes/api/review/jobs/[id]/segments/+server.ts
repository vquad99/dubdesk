import { error, json } from '@sveltejs/kit';
import {
	deleteSegment,
	canEdit,
	insertSegment,
	loadJob,
	loadSegments,
	mergeWithNext,
	replaceInJob,
	saveSegments,
	splitSegment,
	TimingError,
	touchLock,
	type SegmentChange
} from '#lib/server/jobs.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

const MAX_CHANGES = 500;

type Body =
	| { changes: SegmentChange[] }
	| { find: string; replace?: string }
	| { op: 'split'; id: number; at: number; hiCut?: number; enCut?: number }
	| { op: 'merge'; id: number }
	| { op: 'insert'; start: number; end: number }
	| { op: 'delete'; id: number };

/**
 * Every write from the review screen. Only the reviewer holding the job may write,
 * and each write keeps the job theirs for another LOCK_HOURS.
 *   { changes }          save text / flag / comment / checked / timing
 *   { find, replace }    find & replace in Hindi
 *   { op: ... }          split, merge, insert or delete a line (returns all lines)
 */
export const POST: RequestHandler = async (event) => {
	const { params, request, locals } = event;
	const data = await loadJob(Number(params.id));
	if (!data) error(404, 'Job not found');
	const { job } = data;
	const me = locals.user!.id;
	if (!canEdit(job, me)) error(403, 'This job is no longer yours to edit (it may have been unlocked, sent on, or timed out).');

	let body: Body;
	try {
		body = await request.json();
	} catch {
		error(400, 'Body must be JSON');
	}

	try {
		await touchLock(job.id);
		if ('changes' in body) {
			if (!Array.isArray(body.changes) || body.changes.length > MAX_CHANGES) error(400, 'changes must be a list');
			const saved = await saveSegments(job.id, job.video_id, me, body.changes);
			if (saved) {
				const kinds = new Set<string>();
				for (const c of body.changes) {
					if (c.hi_text !== undefined) kinds.add('text');
					if (c.start_sec !== undefined || c.end_sec !== undefined) kinds.add('timing');
					if (c.flag !== undefined) kinds.add('flag');
					if (c.comment !== undefined) kinds.add('comment');
					if (c.reviewed !== undefined) kinds.add('checked');
				}
				await track(event, 'line.edited', { jobId: job.id, videoId: job.video_id, details: `${saved} line(s): ${[...kinds].join(', ')}` });
			}
			return json({ saved, at: new Date().toISOString() });
		}
		if ('find' in body) {
			const n = await replaceInJob(job.id, job.video_id, me, String(body.find), String(body.replace ?? ''));
			await track(event, 'line.replaced', { jobId: job.id, videoId: job.video_id, details: `"${String(body.find).slice(0, 80)}" → "${String(body.replace ?? '').slice(0, 80)}" in ${n} line(s)` });
			return json({ saved: n, segments: await loadSegments(job.video_id) });
		}
		let focus: number | null = null;
		switch (body.op) {
			case 'split':
				focus = await splitSegment(job.id, job.video_id, me, Number(body.id), Number(body.at), body.hiCut, body.enCut);
				break;
			case 'merge':
				focus = await mergeWithNext(job.id, job.video_id, me, Number(body.id));
				break;
			case 'insert':
				focus = await insertSegment(job.id, job.video_id, me, Number(body.start), Number(body.end));
				break;
			case 'delete':
				await deleteSegment(job.id, job.video_id, me, Number(body.id));
				break;
			default:
				error(400, 'Unknown operation');
		}
		const OPS = { split: 'line.split', merge: 'line.joined', insert: 'line.added', delete: 'line.removed' } as const;
		await track(event, OPS[body.op], { jobId: job.id, videoId: job.video_id, details: body.op === 'insert' ? `${body.start}–${body.end} s` : `line ${body.id}` });
		return json({ focus, segments: await loadSegments(job.video_id) });
	} catch (e) {
		if (e instanceof TimingError) error(400, e.message);
		throw e;
	}
};

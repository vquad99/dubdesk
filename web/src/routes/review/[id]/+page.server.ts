import { error, fail, redirect } from '@sveltejs/kit';
import { holds, loadJob, releaseJob, submitJob } from '#lib/server/jobs.ts';
import type { SessionUser } from '#lib/server/session.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

async function jobFor(user: SessionUser, id: string) {
	const data = await loadJob(Number(id));
	if (!data) error(404, 'Job not found');
	const mine = holds(data.job, user.id);
	if (user.role !== 'admin' && !mine) error(403, 'This job is not assigned to you');
	return { ...data, editable: mine };
}

export const load: PageServerLoad = async ({ locals, params }) => jobFor(locals.user!, params.id);

export const actions: Actions = {
	submit: async (event) => {
		const { locals, params, request } = event;
		const { job, editable } = await jobFor(locals.user!, params.id);
		if (!editable) return fail(403, { error: 'Only the reviewer holding this job can send it.' });
		const note = String((await request.formData()).get('note') ?? '').trim().slice(0, 2000) || null;
		await submitJob(job.id, job.video_id, locals.user!.id, note);
		await track(event, 'job.submitted', { jobId: job.id, videoId: job.video_id, details: note ?? job.title });
		redirect(303, '/review?sent=1');
	},

	release: async (event) => {
		const { locals, params } = event;
		const { job, editable } = await jobFor(locals.user!, params.id);
		if (!editable) return fail(403, { error: 'This job is not yours to give back.' });
		await releaseJob(job.id, job.video_id, locals.user!.id);
		await track(event, 'job.released', { jobId: job.id, videoId: job.video_id, details: job.title });
		redirect(303, '/review?released=1');
	}
};

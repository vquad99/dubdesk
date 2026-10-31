import { error, fail, redirect } from '@sveltejs/kit';
import { approveJob, checks, holds, loadJob, releaseCheck, releaseJob, returnJob, startCheck, submitJob } from '#lib/server/jobs.ts';
import { studioUrl } from '#lib/server/sarvam.ts';
import type { SessionUser } from '#lib/server/session.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Who may open this job, and how:
 *   review  the reviewer holding it edits and sends it on
 *   check   an operator checks a submitted job: edits, then approves or sends it back to the reviewer
 *   view    read only (admin, or an operator looking at a job that is not waiting for a check)
 */
async function jobFor(user: SessionUser, id: string) {
	const data = await loadJob(Number(id));
	if (!data) error(404, 'Job not found');
	const mine = holds(data.job, user.id);
	const checking = user.role === 'operator' && checks(data.job, user.id);
	if (user.role === 'reviewer' && !mine) error(403, 'This job is not assigned to you');
	const mode: 'review' | 'check' | 'view' = mine ? 'review' : checking ? 'check' : 'view';
	return { ...data, mode, editable: mode !== 'view' };
}

export const load: PageServerLoad = async (event) => {
	const { locals, params } = event;
	// An operator opening a job that waits for a check takes the check (unless another operator has it).
	let busyBy: string | null = null;
	if (locals.user!.role === 'operator') {
		const first = await loadJob(Number(params.id));
		if (first?.job.status === 'submitted' && !checks(first.job, locals.user!.id)) {
			const got = await startCheck(first.job.id, locals.user!.id);
			if (got) await track(event, 'job.check_started', { jobId: first.job.id, videoId: first.job.video_id, details: first.job.title });
			else busyBy = first.job.qa_name;
		}
	}
	const data = await jobFor(locals.user!, params.id);
	return { ...data, busyBy, studio: studioUrl(data.job.sarvam_job_id) };
};

const checkFor = async (user: SessionUser, id: string) => {
	const data = await jobFor(user, id);
	if (data.mode !== 'check') error(403, 'You are not checking this job (another operator may have it, or it was already decided).');
	return data.job;
};

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

	/** Operator: the reviewer's work is good (after any fixes) -- it is finished and counts for pay. */
	approve: async (event) => {
		const job = await checkFor(event.locals.user!, event.params.id);
		const note = String((await event.request.formData()).get('note') ?? '').trim().slice(0, 2000) || null;
		await approveJob(job.id, job.video_id, event.locals.user!.id, note);
		await track(event, 'job.approved', { jobId: job.id, videoId: job.video_id, details: note ?? job.title });
		redirect(303, '/operator?approved=1');
	},

	/** Operator: too many mistakes -- back to the same reviewer with a note. */
	sendBack: async (event) => {
		const job = await checkFor(event.locals.user!, event.params.id);
		const note = String((await event.request.formData()).get('note') ?? '').trim().slice(0, 2000);
		if (!note) return fail(400, { error: 'Write what the reviewer should fix.' });
		if (!job.assigned_to) return fail(409, { error: 'This job has no reviewer to send it back to.' });
		await returnJob(job.id, job.video_id, event.locals.user!.id, note);
		await track(event, 'job.returned', { jobId: job.id, videoId: job.video_id, details: note });
		redirect(303, '/operator?returned=1');
	},

	/** Operator: stop checking without a decision; the job waits for the next check. */
	stopCheck: async (event) => {
		const job = await checkFor(event.locals.user!, event.params.id);
		await releaseCheck(job.id, event.locals.user!.id);
		await track(event, 'job.check_released', { jobId: job.id, videoId: job.video_id, details: job.title });
		redirect(303, '/operator');
	},

	release: async (event) => {
		const { locals, params } = event;
		const { job, editable } = await jobFor(locals.user!, params.id);
		if (!editable) return fail(403, { error: 'This job is not yours to give back.' });
		const reason = String((await event.request.formData()).get('reason') ?? '').trim().slice(0, 1000) || null;
		await releaseJob(job.id, job.video_id, locals.user!.id, reason);
		await track(event, 'job.released', { jobId: job.id, videoId: job.video_id, details: reason ? `${job.title}: ${reason}` : job.title });
		redirect(303, '/review?released=1');
	}
};

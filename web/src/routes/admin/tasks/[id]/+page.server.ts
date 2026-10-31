import { error, fail } from '@sveltejs/kit';
import { assignJob, holdJob, loadTask, releaseCheck, resumeJob, troubleOf, unlockJob } from '#lib/server/jobs.ts';
import { query } from '#lib/server/db.ts';
import { sarvamEnabled, studioUrl } from '#lib/server/sarvam.ts';
import { importSubtitles, processVideo, sendToSarvam } from '#lib/server/videos.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

async function taskOr404(id: string) {
	const t = await loadTask(Number(id));
	if (!t) error(404, 'Task not found');
	return t;
}

export const load: PageServerLoad = async ({ params }) => {
	const t = await taskOr404(params.id);
	const [trouble, reviewers] = await Promise.all([
		troubleOf(t.task.video_id),
		query<{ id: number; name: string; vendor: string | null; busy: boolean }>(
			`SELECT u.id, u.name, u.vendor,
			        EXISTS (SELECT 1 FROM jobs j WHERE j.assigned_to = u.id AND j.status = 'assigned' AND j.locked_until > now()) AS busy
			   FROM users u WHERE u.active AND u.role = 'reviewer' ORDER BY u.name`
		)
	]);
	return { ...t, trouble, reviewers, sarvam: sarvamEnabled(), studio: studioUrl(t.task.sarvam_job_id) };
};

const note = (f: FormData) => String(f.get('note') ?? '').trim().slice(0, 2000) || null;

export const actions: Actions = {
	/** Stop: nobody can pick the video up (a reviewer holding it loses it) until the admin resumes it. */
	hold: async (event) => {
		const { params, request, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job || !['queued', 'assigned', 'returned'].includes(job.status)) return fail(409, { error: 'Only a job waiting or being reviewed can be stopped.' });
		const n = note(await request.formData());
		if (!n) return fail(400, { error: 'Write why it is stopped, so others know.' });
		await holdJob(job.id, job.video_id, locals.user!.id, n);
		await track(event, 'job.held', { jobId: job.id, videoId: job.video_id, details: n });
		return { message: 'Stopped. Nobody can pick it up until you resume it.' };
	},

	resume: async (event) => {
		const { params, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job?.held_at) return fail(409, { error: 'This job is not stopped.' });
		await resumeJob(job.id, job.video_id, locals.user!.id);
		await track(event, 'job.resumed', { jobId: job.id, videoId: job.video_id, details: job.title });
		return { message: 'Back in the queue.' };
	},

	/** Give the job straight to one reviewer. */
	assign: async (event) => {
		const { params, request, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job || !['queued', 'assigned', 'returned'].includes(job.status)) return fail(409, { error: 'Only a job waiting or being reviewed can be assigned.' });
		const f = await request.formData();
		const to = Number(f.get('reviewer'));
		const [who] = await query<{ id: number; name: string }>(
			`SELECT id, name FROM users WHERE id = $1 AND active AND role = 'reviewer'`,
			[to]
		);
		if (!who) return fail(400, { error: 'Pick a reviewer.' });
		const n = note(f);
		await assignJob(job.id, job.video_id, who.id, locals.user!.id, n);
		await track(event, 'job.assigned', { jobId: job.id, videoId: job.video_id, details: `to ${who.name}${n ? `: ${n}` : ''}` });
		return { message: `Given to ${who.name}.` };
	},

	/** Admin frees a check an operator left open, so another operator can take it. */
	freeCheck: async (event) => {
		const { job } = await taskOr404(event.params.id);
		if (!job || job.status !== 'submitted' || !job.qa_by) return fail(409, { error: 'Nobody is checking this video.' });
		await releaseCheck(job.id, event.locals.user!.id, true);
		await track(event, 'job.check_released', { jobId: job.id, videoId: job.video_id, details: `freed ${job.qa_name ?? ''}'s check` });
		return { message: 'Check freed. Any operator can take it now.' };
	},

	unlock: async (event) => {
		const { params, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job || job.status !== 'assigned') return fail(409, { error: 'Only a job with a reviewer can be unlocked.' });
		await unlockJob(job.id, job.video_id, locals.user!.id);
		await track(event, 'job.unlocked', { jobId: job.id, videoId: job.video_id, details: job.title });
		return { message: 'Job is back in the queue.' };
	},

	sarvam: async (event) => {
		const { params } = event;
		try {
			await sendToSarvam(Number(params.id), event.locals.user!.id);
			await track(event, 'video.sent_to_sarvam', { videoId: Number(params.id) });
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
		return { message: 'Sent to Sarvam. Dubbing has started.' };
	},

	subtitles: async (event) => {
		const { params, request, locals } = event;
		const f = await request.formData();
		const read = async (k: string) => {
			const v = f.get(k);
			return v instanceof File && v.size > 0 ? (v.size > 5 * 1024 * 1024 ? null : v.text()) : null;
		};
		const [en, hi] = [await read('en'), await read('hi')];
		if (!en && !hi) return fail(400, { error: 'Choose an English or Hindi subtitle file (SRT or VTT, under 5 MB).' });
		try {
			const n = await importSubtitles(Number(params.id), locals.user!.id, en, hi);
			await track(event, 'video.subtitles_loaded', { videoId: Number(params.id), details: `${n} lines` });
			return { message: `${n} lines loaded.` };
		} catch (e) {
			return fail(400, { error: (e as Error).message });
		}
	},

	reprocess: async (event) => {
		const id = Number(event.params.id);
		await track(event, 'video.reprocessed', { videoId: id });
		const [v] = await query<{ source_key: string | null }>('SELECT source_key FROM videos WHERE id = $1', [id]);
		if (!v?.source_key) return fail(400, { error: 'There is no uploaded file to process.' });
		await query(`UPDATE videos SET status = 'processing', error = NULL, updated_at = now() WHERE id = $1`, [id]);
		void processVideo(id);
		return { message: 'Processing again.' };
	}
};

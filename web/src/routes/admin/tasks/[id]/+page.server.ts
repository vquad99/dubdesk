import { error, fail } from '@sveltejs/kit';
import { approveJob, loadTask, returnJob, unlockJob } from '#lib/server/jobs.ts';
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
	return { ...t, sarvam: sarvamEnabled(), studio: studioUrl(t.task.sarvam_job_id) };
};

const note = (f: FormData) => String(f.get('note') ?? '').trim().slice(0, 2000) || null;

export const actions: Actions = {
	approve: async (event) => {
		const { params, request, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job || job.status !== 'submitted') return fail(409, { error: 'Only a job waiting for approval can be approved.' });
		const n = note(await request.formData());
		await approveJob(job.id, job.video_id, locals.user!.id, n);
		await track(event, 'job.approved', { jobId: job.id, videoId: job.video_id, details: n ?? job.title });
		return { message: 'Approved.' };
	},

	sendBack: async (event) => {
		const { params, request, locals } = event;
		const { job } = await taskOr404(params.id);
		if (!job || job.status !== 'submitted') return fail(409, { error: 'Only a job waiting for approval can be sent back.' });
		if (!job.assigned_to) return fail(409, { error: 'This job has no reviewer to send it back to.' });
		const n = note(await request.formData());
		if (!n) return fail(400, { error: 'Write a note so the reviewer knows what to fix.' });
		await returnJob(job.id, job.video_id, locals.user!.id, n);
		await track(event, 'job.returned', { jobId: job.id, videoId: job.video_id, details: n });
		return { message: 'Sent back to the reviewer.' };
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

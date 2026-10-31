import { fail, redirect } from '@sveltejs/kit';
import { claimNextJob, currentJobId, loadJob, LOCK_HOURS, myHistory, waitingCount } from '#lib/server/jobs.ts';
import { track } from '#lib/server/activity.ts';
import { earnings } from '#lib/server/analytics.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user!.role === 'operator') redirect(303, '/operator');
	// No automatic jump into a held job: Back from the editor must land here.
	const held = await currentJobId(locals.user!.id);
	const [waiting, history, current, earned] = await Promise.all([
		waitingCount(),
		myHistory(locals.user!.id),
		held ? loadJob(held) : Promise.resolve(null),
		earnings(locals.user!.id)
	]);
	return {
		earned,
		waiting,
		history,
		lockHours: LOCK_HOURS,
		current: current
			? {
					id: current.job.id,
					title: current.job.title,
					lines: current.segments.length,
					checked: current.segments.filter((s) => s.reviewed_at).length,
					locked_until: current.job.locked_until,
					admin_note: current.job.admin_note
				}
			: null
	};
};

export const actions: Actions = {
	claim: async (event) => {
		const { locals } = event;
		const held = await currentJobId(locals.user!.id);
		const id = held ?? (await claimNextJob(locals.user!.id));
		if (!id) return fail(404, { error: 'No jobs waiting right now.' });
		if (!held) {
			const d = await loadJob(id);
			await track(event, 'job.claimed', { jobId: id, videoId: d?.job.video_id, details: d?.job.title });
		}
		redirect(303, `/review/${id}`);
	}
};

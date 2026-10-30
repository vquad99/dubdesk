import { error } from '@sveltejs/kit';
import { listActivity } from '#lib/server/activity.ts';
import { loadProfile } from '#lib/server/profile.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	const [p, act] = await Promise.all([loadProfile(id), listActivity({ userId: id, limit: 40 })]);
	if (!p) error(404, 'Person not found');
	return { p, activity: act.rows };
};

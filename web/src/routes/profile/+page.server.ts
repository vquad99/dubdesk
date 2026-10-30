import { error } from '@sveltejs/kit';
import { listActivity } from '#lib/server/activity.ts';
import { loadProfile } from '#lib/server/profile.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const me = locals.user!.id;
	const [p, act] = await Promise.all([loadProfile(me), listActivity({ userId: me, limit: 40 })]);
	if (!p) error(404, 'Profile not found');
	return { p, activity: act.rows };
};

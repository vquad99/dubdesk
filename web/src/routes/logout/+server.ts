import { redirect } from '@sveltejs/kit';
import { deleteSession } from '#lib/server/session.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (event.locals.user) await track(event, 'auth.logout');
	await deleteSession(event.cookies);
	redirect(303, '/login');
};

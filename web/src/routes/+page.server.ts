import { redirect } from '@sveltejs/kit';
import { homeFor } from '#lib/server/session.ts';
import type { PageServerLoad } from './$types';

// The hook guarantees a user here; send each role to its own home page.
export const load: PageServerLoad = ({ locals }) => {
	redirect(303, homeFor(locals.user!.role));
};

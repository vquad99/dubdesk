import { fail, redirect } from '@sveltejs/kit';
import { checkLink, MIN_PASSWORD, useLink } from '#lib/server/passlinks.ts';
import { allow } from '#lib/server/throttle.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
	// The link carries a secret: never cache it, never pass it on in Referer.
	setHeaders({ 'referrer-policy': 'no-referrer' });
	const link = await checkLink(params.token);
	return link ? { ok: true as const, name: link.name, email: link.email, kind: link.kind, min: MIN_PASSWORD } : { ok: false as const };
};

export const actions: Actions = {
	default: async (event) => {
		const { request, params, getClientAddress } = event;
		let ip = 'unknown';
		try {
			ip = getClientAddress();
		} catch {
			/* no address behind some proxies */
		}
		if (!allow(`reset:${ip}`, 10, 15 * 60_000).ok) return fail(429, { error: 'Too many tries. Try again later.' });

		const f = await request.formData();
		const password = String(f.get('password') ?? '');
		const again = String(f.get('again') ?? '');
		if (password.length < MIN_PASSWORD) return fail(400, { error: `Use at least ${MIN_PASSWORD} characters.` });
		if (password.length > 200) return fail(400, { error: 'That password is too long.' });
		if (password !== again) return fail(400, { error: 'The two passwords do not match.' });

		const used = await useLink(params.token, password);
		if (!used) return fail(410, { error: 'This link has expired or was already used. Ask for a new one.' });
		await track(event, 'auth.password_reset', { userId: used.userId, details: used.kind === 'invite' ? 'first password' : 'reset link' });
		redirect(303, `/login?done=${used.kind === 'invite' ? 'welcome' : 'reset'}`);
	}
};

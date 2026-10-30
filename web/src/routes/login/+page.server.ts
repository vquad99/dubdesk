import { fail, redirect } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { verifyPassword } from '#lib/server/password.ts';
import { clearLoginFailures, loginBlockedFor, recordLoginFailure } from '#lib/server/ratelimit.ts';
import { createSession, homeFor, type SessionUser } from '#lib/server/session.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, homeFor(locals.user.role));
};

export const actions: Actions = {
	default: async (event) => {
		const { request, cookies, url, getClientAddress } = event;
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		let ip = 'unknown';
		try {
			ip = getClientAddress();
		} catch {
			/* no address behind some proxies; email limit still applies */
		}

		const wait = await loginBlockedFor(email, ip);
		if (wait) {
			await track(event, 'auth.login_blocked', { userId: null, details: email });
			return fail(429, { email, error: `Too many tries. Try again in ${wait} min.` });
		}

		const rows = await query<SessionUser & { password_hash: string }>(
			'SELECT id, email, name, role, password_hash FROM users WHERE email = $1 AND active',
			[email]
		);
		const user = rows[0];
		if (!user || !verifyPassword(password, user.password_hash)) {
			await recordLoginFailure(email, ip);
			await track(event, 'auth.login_failed', { userId: user?.id ?? null, details: email });
			return fail(400, { email, error: 'Wrong email or password.' });
		}

		await clearLoginFailures(email);
		await createSession(cookies, user.id, url.protocol === 'https:');
		await track(event, 'auth.login', { userId: user.id });

		// Only follow a same-site path, never an outside URL.
		const next = url.searchParams.get('next');
		redirect(303, next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(user.role));
	}
};

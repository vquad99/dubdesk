import { fail, redirect } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { burnPasswordCheck, verifyPassword } from '#lib/server/password.ts';
import { clearLoginFailures, loginBlockedFor, recordLoginFailure } from '#lib/server/ratelimit.ts';
import { createSession, homeFor, type SessionUser } from '#lib/server/session.ts';
import { track } from '#lib/server/activity.ts';
import { safeNext as checkNext } from '#lib/server/redirect.ts';
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

		const rows = await query<SessionUser & { password_hash: string; totp_enabled: boolean }>(
			'SELECT id, email, name, role, password_hash, totp_enabled FROM users WHERE email = $1 AND active',
			[email]
		);
		const user = rows[0];
		if (!(user ? verifyPassword(password, user.password_hash) : burnPasswordCheck(password))) {
			await recordLoginFailure(email, ip);
			await track(event, 'auth.login_failed', { userId: user?.id ?? null, details: email });
			return fail(400, { email, error: 'Wrong email or password.' });
		}

		await clearLoginFailures(email);
		const next = url.searchParams.get('next');
		const safeNext = checkNext(next);
		const meta = { ip, userAgent: request.headers.get('user-agent') };

		if (user.totp_enabled) {
			// Password is right; the session grants nothing until the 2-step code is given.
			await createSession(cookies, user.id, url.protocol === 'https:', { ...meta, pending2fa: true });
			await track(event, 'auth.password_ok', { userId: user.id, details: 'waiting for 2-step code' });
			redirect(303, `/login/2fa${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''}`);
		}

		await createSession(cookies, user.id, url.protocol === 'https:', meta);
		await track(event, 'auth.login', { userId: user.id });
		redirect(303, safeNext ?? homeFor(user.role));
	}
};

import { fail } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import { allow } from '#lib/server/throttle.ts';
import { createLink, mailEnabled, sendLinkMail } from '#lib/server/passlinks.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ mail: mailEnabled() });

// Same answer whether or not the e-mail has an account, so nobody can probe for accounts.
const SENT = 'If that e-mail has an account, the request is in. Check your e-mail, or ask your admin for the reset link.';

export const actions: Actions = {
	default: async (event) => {
		const { request, url, getClientAddress } = event;
		const email = String((await request.formData()).get('email') ?? '').trim().toLowerCase();
		if (!email.includes('@') || email.length > 200) return fail(400, { email, error: 'Enter your e-mail.' });

		let ip = 'unknown';
		try {
			ip = getClientAddress();
		} catch {
			/* behind some proxies there is no address; the e-mail limit still applies */
		}
		const byIp = allow(`forgot-ip:${ip}`, 5, 15 * 60_000);
		const byEmail = allow(`forgot-mail:${email}`, 3, 60 * 60_000);
		if (!byIp.ok || !byEmail.ok) return fail(429, { email, error: 'Too many requests. Try again later.' });

		// The work runs after the answer is sent, so the reply takes the same time whether or not
		// the e-mail has an account (no probing for accounts by timing).
		void (async () => {
			const [user] = await query<{ id: number; name: string }>('SELECT id, name FROM users WHERE email = $1 AND active', [email]);
			if (user) {
				await track(event, 'auth.reset_requested', { userId: user.id, details: email });
				let mailed = false;
				if (mailEnabled()) {
					const link = await createLink(user.id, 'reset', null, url.origin);
					mailed = await sendLinkMail(email, user.name, 'reset', link.url, link.hours);
				}
				// No e-mail service (or it failed): the admin sees the request on the Users page.
				if (!mailed) {
					await query(
						`INSERT INTO password_requests (user_id, ip)
						 SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM password_requests WHERE user_id = $1 AND handled_at IS NULL)`,
						[user.id, ip]
					);
				}
			}
		})().catch((e) => console.error('[forgot] request failed', e));
		return { sent: SENT };
	}
};

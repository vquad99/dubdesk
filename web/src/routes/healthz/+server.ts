import { json } from '@sveltejs/kit';
import { query } from '#lib/server/db.ts';
import type { RequestHandler } from './$types';

/** Render health check: 200 when the app can reach its database. */
export const GET: RequestHandler = async () => {
	try {
		await query('SELECT 1');
		return json({ ok: true });
	} catch {
		return json({ ok: false }, { status: 503 });
	}
};

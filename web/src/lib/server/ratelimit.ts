import { query } from './db.ts';

// Failed logins allowed inside the window before that email / address is held back.
export const WINDOW_MIN = 15;
export const MAX_PER_EMAIL = 5;
export const MAX_PER_IP = 20;

/** Minutes until this email or address may try again; 0 means it may try now. */
export async function loginBlockedFor(email: string, ip: string): Promise<number> {
	const [row] = await query<{ by_email: number; by_ip: number; oldest_email: Date | null; oldest_ip: Date | null }>(
		`SELECT COUNT(*) FILTER (WHERE email = $1)::int AS by_email,
		        COUNT(*) FILTER (WHERE ip = $2)::int AS by_ip,
		        MIN(created_at) FILTER (WHERE email = $1) AS oldest_email,
		        MIN(created_at) FILTER (WHERE ip = $2) AS oldest_ip
		   FROM login_attempts
		  WHERE created_at > now() - make_interval(mins => $3) AND (email = $1 OR ip = $2)`,
		[email, ip, WINDOW_MIN]
	);
	const oldest =
		row.by_email >= MAX_PER_EMAIL ? row.oldest_email : row.by_ip >= MAX_PER_IP ? row.oldest_ip : null;
	if (!oldest) return 0;
	return Math.max(1, Math.ceil((new Date(oldest).getTime() + WINDOW_MIN * 60_000 - Date.now()) / 60_000));
}

export async function recordLoginFailure(email: string, ip: string) {
	await query('INSERT INTO login_attempts (email, ip) VALUES ($1, $2)', [email, ip]);
	await query(`DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'`);
}

export async function clearLoginFailures(email: string) {
	await query('DELETE FROM login_attempts WHERE email = $1', [email]);
}

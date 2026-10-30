import { query } from '#lib/server/db.ts';
import { listActivity } from '#lib/server/activity.ts';
import type { PageServerLoad } from './$types';

const PER_PAGE = 50;
const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

export const load: PageServerLoad = async ({ url }) => {
	const user = Number(url.searchParams.get('user')) || undefined;
	const action = (url.searchParams.get('action') ?? '').replace(/[^a-z._]/g, '') || undefined;
	const from = isDate(url.searchParams.get('from'));
	const to = isDate(url.searchParams.get('to'));
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const [act, people, [today]] = await Promise.all([
		listActivity({ userId: user, action, from, to, limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
		query<{ id: number; name: string; role: string }>('SELECT id, name, role FROM users ORDER BY active DESC, name'),
		query<{ actions: number; people: number; logins: number; failed: number; minutes: number }>(
			`SELECT (SELECT COUNT(*)::int FROM activity_log WHERE created_at >= current_date) AS actions,
			        (SELECT COUNT(DISTINCT user_id)::int FROM activity_log WHERE created_at >= current_date) AS people,
			        (SELECT COUNT(*)::int FROM activity_log WHERE created_at >= current_date AND action = 'auth.login') AS logins,
			        (SELECT COUNT(*)::int FROM activity_log WHERE created_at >= current_date AND action IN ('auth.login_failed', 'auth.login_blocked')) AS failed,
			        (SELECT COALESCE(ROUND(SUM(seconds) / 60.0), 0)::int FROM work_time WHERE day = current_date) AS minutes`
		)
	]);
	return { ...act, people, today, filters: { user: user ?? '', action: action ?? '', from: from ?? '', to: to ?? '' }, page, perPage: PER_PAGE };
};

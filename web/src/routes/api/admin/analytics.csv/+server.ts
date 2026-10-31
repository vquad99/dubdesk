import { error } from '@sveltejs/kit';
import { buckets, loadPayRates, people, rangeOf, trend, type Gran } from '#lib/server/analytics.ts';
import { csvResponse } from '#lib/server/csv.ts';
import { query } from '#lib/server/db.ts';
import { track } from '#lib/server/activity.ts';
import type { RequestHandler } from './$types';

/**
 *   ?kind=payments  one row per person: work done and the amount owed for the period
 *   ?kind=trend     one row per period bucket and person (gran = day | week | month)
 * Period: range=today|7d|30d|month|lastmonth|90d|custom (&from=&to=), India time.
 */
export const GET: RequestHandler = async (event) => {
	const p = event.url.searchParams;
	const r = rangeOf(p);
	const kind = p.get('kind');
	const tag = `${r.from}_to_${r.to}`;

	if (kind === 'payments') {
		const rates = await loadPayRates();
		const rows = await people(r, rates);
		await track(event, 'file.downloaded', { details: `payments ${tag}` });
		return csvResponse(
			`dubdesk_payments_${tag}.csv`,
			['Name', 'Email', 'Vendor', 'Role', 'Lines checked', 'Lines corrected', 'Reviews sent', 'Reviews approved', 'Sent back',
				'Approved video minutes', 'Active hours', `Rate per approved minute (${rates.currency})`, `Rate per active hour (${rates.currency})`,
				`Rate per corrected line (${rates.currency})`, `Amount (${rates.currency})`, 'Period from', 'Period to'],
			rows
				.filter((x) => x.checked || x.corrected || x.submitted || x.approved || x.active_min)
				.map((x) => [x.name, x.email, x.vendor ?? '', x.role, x.checked, x.corrected, x.submitted, x.approved, x.returned,
					x.approved_min, Math.round((x.active_min / 60) * 100) / 100, x.rate_min, x.rate_hour, x.rate_line, x.amount, r.from, r.to])
		);
	}

	if (kind === 'trend') {
		const gran = (['day', 'week', 'month'].includes(p.get('gran') ?? '') ? p.get('gran') : 'day') as Gran;
		const userId = Number(p.get('user')) || null;
		const [rows, users] = await Promise.all([
			trend(gran, r, userId),
			query<{ id: number; name: string; email: string; vendor: string | null }>('SELECT id, name, email, vendor FROM users')
		]);
		const who = new Map(users.map((u) => [u.id, u]));
		const order = new Map(buckets(gran, r).map((b, i) => [b, i]));
		rows.sort((a, b) => (order.get(a.bucket) ?? 0) - (order.get(b.bucket) ?? 0) || (who.get(a.user_id)?.name ?? '').localeCompare(who.get(b.user_id)?.name ?? ''));
		await track(event, 'file.downloaded', { details: `trend by ${gran} ${tag}` });
		return csvResponse(
			`dubdesk_trend_${gran}_${tag}.csv`,
			[gran === 'day' ? 'Day' : gran === 'week' ? 'Week starting' : 'Month', 'Name', 'Email', 'Vendor', 'Lines checked', 'Lines corrected',
				'Reviews sent', 'Reviews approved', 'Sent back', 'Approved video minutes', 'Active minutes'],
			rows.map((x) => {
				const u = who.get(x.user_id);
				return [gran === 'month' ? x.bucket.slice(0, 7) : x.bucket, u?.name ?? `user ${x.user_id}`, u?.email ?? '', u?.vendor ?? '',
					x.checked, x.corrected, x.submitted, x.approved, x.returned, x.approved_min, x.active_min];
			})
		);
	}
	error(400, 'Unknown export');
};

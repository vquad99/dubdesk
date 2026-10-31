import { query } from './db.ts';

/** Days, weeks and months are counted in India time. */
export const TZ = 'Asia/Kolkata';
export type Gran = 'hour' | 'day' | 'week' | 'month';
export const GRANS: Gran[] = ['day', 'week', 'month'];

export type Metrics = {
	checked: number; // lines marked checked
	corrected: number; // lines whose Hindi they changed
	submitted: number; // reviews sent to the admin
	approved: number; // reviews approved
	returned: number; // reviews sent back to them
	approved_min: number; // video minutes in approved reviews
	active_min: number; // minutes active on the review screen
};

/**
 * Every countable event in [from, to), one row per event, tagged with person and time.
 * Each figure comes from the table that records it, so nothing is counted twice.
 */
const EVENTS = `
	SELECT reviewed_by AS user_id, reviewed_at AS t, 1 AS checked, 0 AS corrected, 0 AS submitted, 0 AS approved, 0 AS returned, 0::float AS approved_min, 0::float AS active_min
	  FROM segments WHERE reviewed_at >= $1 AND reviewed_at < $2 AND reviewed_by IS NOT NULL AND deleted_at IS NULL
	UNION ALL
	SELECT user_id, MIN(created_at), 0, 1, 0, 0, 0, 0, 0
	  FROM segment_edits WHERE field = 'hi_text' AND created_at >= $1 AND created_at < $2 AND user_id IS NOT NULL
	 GROUP BY user_id, segment_id
	UNION ALL
	SELECT user_id, created_at, 0, 0, 1, 0, 0, 0, 0
	  FROM activity_log WHERE action = 'job.submitted' AND created_at >= $1 AND created_at < $2 AND user_id IS NOT NULL
	UNION ALL
	SELECT j.assigned_to, j.reviewed_at, 0, 0, 0, 1, 0, COALESCE(v.duration_sec, 0)::float / 60, 0
	  FROM jobs j JOIN videos v ON v.id = j.video_id
	 WHERE j.status IN ('approved', 'done') AND j.reviewed_at >= $1 AND j.reviewed_at < $2 AND j.assigned_to IS NOT NULL
	UNION ALL
	SELECT j.assigned_to, a.created_at, 0, 0, 0, 0, 1, 0, 0
	  FROM activity_log a JOIN jobs j ON j.id = a.job_id
	 WHERE a.action = 'job.returned' AND a.created_at >= $1 AND a.created_at < $2 AND j.assigned_to IS NOT NULL
	UNION ALL
	SELECT user_id, slot, 0, 0, 0, 0, 0, 0, seconds::float / 60
	  FROM work_slots WHERE slot >= $1 AND slot < $2`;

const SUMS = `SUM(checked)::int AS checked, SUM(corrected)::int AS corrected, SUM(submitted)::int AS submitted,
	SUM(approved)::int AS approved, SUM(returned)::int AS returned,
	ROUND(SUM(approved_min)::numeric, 2)::float AS approved_min, ROUND(SUM(active_min)::numeric, 1)::float AS active_min`;

/** Start of "YYYY-MM-DD" in India time. */
export function istDay(d: string): Date {
	return new Date(`${d}T00:00:00+05:30`);
}
export function istToday(): string {
	return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(d: string, n: number): string {
	const x = new Date(`${d}T00:00:00Z`);
	x.setUTCDate(x.getUTCDate() + n);
	return x.toISOString().slice(0, 10);
}

export type Range = { from: string; to: string; preset: string };

/** A period from the URL: a preset, or from/to dates (inclusive), in India time. */
export function rangeOf(p: URLSearchParams): Range {
	const today = istToday();
	const preset = p.get('range') ?? '30d';
	const ok = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
	if (preset === 'custom') {
		const from = ok(p.get('from')) ?? addDays(today, -29);
		const to = ok(p.get('to')) ?? today;
		return from <= to ? { from, to, preset } : { from: to, to: from, preset };
	}
	const month0 = today.slice(0, 8) + '01';
	switch (preset) {
		case 'today':
			return { from: today, to: today, preset };
		case '7d':
			return { from: addDays(today, -6), to: today, preset };
		case 'month':
			return { from: month0, to: today, preset };
		case 'lastmonth': {
			const end = addDays(month0, -1);
			return { from: end.slice(0, 8) + '01', to: end, preset };
		}
		case '90d':
			return { from: addDays(today, -89), to: today, preset };
		default:
			return { from: addDays(today, -29), to: today, preset: '30d' };
	}
}

export type TrendRow = Metrics & { bucket: string; user_id: number };

/** Per period bucket and person. `bucket` is the bucket's first day (or hour) in India time. */
export async function trend(gran: Gran, r: Range, userId?: number | null): Promise<TrendRow[]> {
	const g = (['hour', 'day', 'week', 'month'] as const).includes(gran) ? gran : 'day';
	const fmt = g === 'hour' ? 'YYYY-MM-DD"T"HH24' : 'YYYY-MM-DD';
	return query<TrendRow>(
		`SELECT to_char(date_trunc('${g}', t AT TIME ZONE '${TZ}'), '${fmt}') AS bucket, user_id, ${SUMS}
		   FROM (${EVENTS}) e
		  WHERE user_id IS NOT NULL ${userId ? 'AND user_id = $3' : ''}
		  GROUP BY 1, 2 ORDER BY 1, 2`,
		userId ? [istDay(r.from), istDay(addDays(r.to, 1)), userId] : [istDay(r.from), istDay(addDays(r.to, 1))]
	);
}

/** Every bucket key between from and to, so empty days still show on the chart. */
export function buckets(gran: Gran, r: Range): string[] {
	const out: string[] = [];
	let d = r.from;
	if (gran === 'week') {
		// ISO weeks start on Monday, as date_trunc('week') does.
		const x = new Date(`${d}T00:00:00Z`);
		d = addDays(d, -((x.getUTCDay() + 6) % 7));
	}
	if (gran === 'month') d = d.slice(0, 8) + '01';
	while (d <= r.to && out.length < 400) {
		out.push(d);
		if (gran === 'month') {
			const x = new Date(`${d}T00:00:00Z`);
			x.setUTCMonth(x.getUTCMonth() + 1);
			d = x.toISOString().slice(0, 10);
		} else d = addDays(d, gran === 'week' ? 7 : 1);
	}
	return out;
}

export type PayRates = { perMin: number; perHour: number; perLine: number; currency: string };

export async function loadPayRates(): Promise<PayRates> {
	const rows = await query<{ key: string; value: string }>(
		`SELECT key, value FROM settings WHERE key IN ('pay_per_min', 'pay_per_hour', 'pay_per_line', 'pay_currency')`
	);
	const n = (k: string) => Number(rows.find((r) => r.key === k)?.value ?? 0) || 0;
	return { perMin: n('pay_per_min'), perHour: n('pay_per_hour'), perLine: n('pay_per_line'), currency: rows.find((r) => r.key === 'pay_currency')?.value ?? '₹' };
}

export async function savePayRates(p: PayRates, userId: number) {
	for (const [k, v] of [
		['pay_per_min', String(p.perMin)],
		['pay_per_hour', String(p.perHour)],
		['pay_per_line', String(p.perLine)],
		['pay_currency', p.currency]
	]) {
		await query(
			`INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
			[k, v, userId]
		);
	}
}

export type PersonRow = Metrics & {
	id: number;
	name: string;
	email: string;
	role: string;
	vendor: string | null;
	active: boolean;
	rate_min: number;
	rate_hour: number;
	rate_line: number;
	custom_rate: boolean;
	amount: number;
};

/** Totals per person for the period, with what they are owed at their rates. */
export async function people(r: Range, rates: PayRates): Promise<PersonRow[]> {
	const rows = await query<Omit<PersonRow, 'amount' | 'rate_min' | 'rate_hour' | 'rate_line' | 'custom_rate'> & {
		pay_per_min: string | null;
		pay_per_hour: string | null;
		pay_per_line: string | null;
	}>(
		`WITH m AS (SELECT user_id, ${SUMS} FROM (${EVENTS}) e GROUP BY user_id)
		 SELECT u.id, u.name, u.email, u.role, u.vendor, u.active, u.pay_per_min, u.pay_per_hour, u.pay_per_line,
		        COALESCE(m.checked, 0) AS checked, COALESCE(m.corrected, 0) AS corrected, COALESCE(m.submitted, 0) AS submitted,
		        COALESCE(m.approved, 0) AS approved, COALESCE(m.returned, 0) AS returned,
		        COALESCE(m.approved_min, 0) AS approved_min, COALESCE(m.active_min, 0) AS active_min
		   FROM users u LEFT JOIN m ON m.user_id = u.id
		  WHERE u.role = 'reviewer' OR m.user_id IS NOT NULL
		  ORDER BY COALESCE(m.approved_min, 0) DESC, COALESCE(m.checked, 0) DESC, u.name`,
		[istDay(r.from), istDay(addDays(r.to, 1))]
	);
	return rows.map(({ pay_per_min, pay_per_hour, pay_per_line, ...p }) => {
		const rate_min = pay_per_min != null ? Number(pay_per_min) : rates.perMin;
		const rate_hour = pay_per_hour != null ? Number(pay_per_hour) : rates.perHour;
		const rate_line = pay_per_line != null ? Number(pay_per_line) : rates.perLine;
		const amount = Math.round((p.approved_min * rate_min + (p.active_min / 60) * rate_hour + p.corrected * rate_line) * 100) / 100;
		return { ...p, rate_min, rate_hour, rate_line, custom_rate: pay_per_min != null || pay_per_hour != null || pay_per_line != null, amount };
	});
}

// ---------------- live ----------------

export type LivePerson = {
	id: number;
	name: string;
	role: string;
	vendor: string | null;
	last_seen: Date;
	working: boolean;
	job_id: number | null;
	video_title: string | null;
	lines_total: number | null;
	lines_checked: number | null;
	hour_checked: number;
	hour_corrected: number;
	hour_active_min: number;
};

export type HourRow = { hour: string; checked: number; corrected: number; active_min: number; people: number };

/** What is happening now: who is online, who is working, the last hour and the last 24 hours. */
export async function live() {
	// India time is UTC+5:30, so its hours start at :30 UTC: count from the start of an India-time hour.
	const IST = 5.5 * 3600_000;
	const start = Math.floor((Date.now() + IST) / 3600_000) * 3600_000 - IST - 23 * 3600_000;
	const [peopleNow, [hour], hours] = await Promise.all([
		query<LivePerson>(
			`WITH online AS (
			   SELECT user_id, MAX(last_seen_at) AS last_seen FROM sessions
			    WHERE last_seen_at > now() - interval '5 minutes' AND NOT pending_2fa AND expires_at > now() GROUP BY user_id),
			 beat AS (
			   SELECT DISTINCT ON (user_id) user_id, job_id, last_beat FROM work_slots
			    WHERE last_beat > now() - interval '2 minutes' ORDER BY user_id, last_beat DESC),
			 hr AS (
			   SELECT user_id, ${SUMS} FROM (${EVENTS}) e GROUP BY user_id)
			 SELECT u.id, u.name, u.role, u.vendor,
			        GREATEST(o.last_seen, b.last_beat) AS last_seen, (b.user_id IS NOT NULL) AS working,
			        j.id AS job_id, v.title AS video_title,
			        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = j.video_id AND s.deleted_at IS NULL) AS lines_total,
			        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = j.video_id AND s.deleted_at IS NULL AND s.reviewed_at IS NOT NULL) AS lines_checked,
			        COALESCE(hr.checked, 0) AS hour_checked, COALESCE(hr.corrected, 0) AS hour_corrected, COALESCE(hr.active_min, 0) AS hour_active_min
			   FROM users u
			   LEFT JOIN online o ON o.user_id = u.id
			   LEFT JOIN beat b ON b.user_id = u.id
			   LEFT JOIN hr ON hr.user_id = u.id
			   LEFT JOIN jobs j ON j.id = b.job_id
			   LEFT JOIN videos v ON v.id = j.video_id
			  WHERE o.user_id IS NOT NULL OR b.user_id IS NOT NULL
			  ORDER BY (b.user_id IS NOT NULL) DESC, COALESCE(hr.checked, 0) DESC, u.name`,
			[new Date(Date.now() - 3600_000), new Date()]
		),
		query<Metrics & { people: number }>(
			`SELECT ${SUMS}, COUNT(DISTINCT user_id) FILTER (WHERE active_min > 0 OR checked > 0 OR corrected > 0)::int AS people FROM (${EVENTS}) e`,
			[new Date(Date.now() - 3600_000), new Date()]
		),
		query<HourRow>(
			`SELECT to_char(date_trunc('hour', t AT TIME ZONE '${TZ}'), 'YYYY-MM-DD"T"HH24') AS hour,
			        SUM(checked)::int AS checked, SUM(corrected)::int AS corrected,
			        ROUND(SUM(active_min)::numeric, 1)::float AS active_min,
			        COUNT(DISTINCT user_id) FILTER (WHERE active_min > 0 OR checked > 0 OR corrected > 0)::int AS people
			   FROM (${EVENTS}) e GROUP BY 1 ORDER BY 1`,
			[new Date(start), new Date()]
		)
	]);
	// All 24 hours, empty ones included.
	const byHour = new Map(hours.map((h) => [h.hour, h]));
	const last24: HourRow[] = Array.from({ length: 24 }, (_, i) => {
		const key = new Date(start + i * 3600_000 + IST).toISOString().slice(0, 13);
		return byHour.get(key) ?? { hour: key, checked: 0, corrected: 0, active_min: 0, people: 0 };
	});
	return {
		at: new Date().toISOString(),
		online: peopleNow.length,
		working: peopleNow.filter((p) => p.working).length,
		lastHour: hour,
		people: peopleNow,
		hours: last24
	};
}

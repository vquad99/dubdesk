import { query } from './db.ts';

export type UsageSettings = { ratePerMin: number; currency: string; monthlyMinutes: number };

export async function loadSettings(): Promise<UsageSettings> {
	const rows = await query<{ key: string; value: string }>(
		`SELECT key, value FROM settings WHERE key IN ('sarvam_rate_per_min', 'sarvam_currency', 'sarvam_monthly_minutes')`
	);
	const get = (k: string) => rows.find((r) => r.key === k)?.value;
	return {
		ratePerMin: Number(get('sarvam_rate_per_min') ?? 0) || 0,
		currency: get('sarvam_currency') ?? '₹',
		monthlyMinutes: Number(get('sarvam_monthly_minutes') ?? 0) || 0
	};
}

export async function saveSettings(s: UsageSettings, userId: number) {
	const pairs: [string, string][] = [
		['sarvam_rate_per_min', String(s.ratePerMin)],
		['sarvam_currency', s.currency],
		['sarvam_monthly_minutes', String(s.monthlyMinutes)]
	];
	for (const [k, v] of pairs) {
		await query(
			`INSERT INTO settings (key, value, updated_by) VALUES ($1, $2, $3)
			 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
			[k, v, userId]
		);
	}
}

/** [from, to) for "YYYY-MM", or everything for "all". */
export function periodOf(month: string | null): { key: string; from: Date; to: Date } {
	if (month === 'all') return { key: 'all', from: new Date('2000-01-01T00:00:00Z'), to: new Date('2100-01-01T00:00:00Z') };
	const now = new Date();
	const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
	const y = m ? Number(m[1]) : now.getUTCFullYear();
	const mo = m ? Number(m[2]) - 1 : now.getUTCMonth();
	const from = new Date(Date.UTC(y, mo, 1));
	const to = new Date(Date.UTC(y, mo + 1, 1));
	return { key: `${y}-${String(mo + 1).padStart(2, '0')}`, from, to };
}

export type PersonUsage = {
	id: number;
	name: string;
	email: string;
	role: string;
	sent: number; // videos this person sent to Sarvam
	sarvam_min: number; // minutes Sarvam billed for those
	jobs_sent: number; // reviews sent to the admin
	jobs_approved: number;
	reviewed_min: number; // video minutes in reviews they sent
	behind_min: number; // Sarvam minutes behind the videos they reviewed
	lines_checked: number;
	lines_edited: number;
	revoice_min: number; // length of the lines they changed: what Sarvam must re-voice
	work_sec: number;
};

/**
 * Per person, for one period: what they spent on Sarvam (videos they sent) next to what they produced
 * (reviews, lines checked and corrected, time worked).
 */
export async function usageByPerson(from: Date, to: Date): Promise<PersonUsage[]> {
	return query<PersonUsage>(
		`WITH sarvam AS (
		   SELECT user_id, COUNT(*)::int AS sent, COALESCE(SUM(minutes), 0)::float AS sarvam_min
		     FROM credits_log WHERE created_at >= $1 AND created_at < $2 AND user_id IS NOT NULL GROUP BY user_id),
		 reviews AS (
		   SELECT j.assigned_to AS user_id,
		          COUNT(*)::int AS jobs_sent,
		          COUNT(*) FILTER (WHERE j.status IN ('approved', 'done'))::int AS jobs_approved,
		          COALESCE(SUM(v.duration_sec), 0)::float / 60 AS reviewed_min
		     FROM jobs j JOIN videos v ON v.id = j.video_id
		    WHERE j.submitted_at >= $1 AND j.submitted_at < $2 AND j.assigned_to IS NOT NULL
		    GROUP BY j.assigned_to),
		 behind AS (
		   -- each video counted once per reviewer, however many rounds it took
		   SELECT d.user_id, COALESCE(SUM(c.minutes), 0)::float AS behind_min
		     FROM (SELECT DISTINCT assigned_to AS user_id, video_id FROM jobs
		            WHERE submitted_at >= $1 AND submitted_at < $2 AND assigned_to IS NOT NULL) d
		     JOIN credits_log c ON c.video_id = d.video_id
		    GROUP BY d.user_id),
		 checked AS (
		   SELECT reviewed_by AS user_id, COUNT(*)::int AS lines_checked
		     FROM segments WHERE reviewed_at >= $1 AND reviewed_at < $2 AND reviewed_by IS NOT NULL AND deleted_at IS NULL
		    GROUP BY reviewed_by),
		 edited AS (
		   SELECT e.user_id, COUNT(DISTINCT e.segment_id)::int AS lines_edited,
		          COALESCE(SUM(s.end_sec - s.start_sec) FILTER (WHERE e.first), 0)::float / 60 AS revoice_min
		     FROM (SELECT DISTINCT ON (user_id, segment_id) user_id, segment_id, TRUE AS first
		             FROM segment_edits WHERE field = 'hi_text' AND created_at >= $1 AND created_at < $2 AND user_id IS NOT NULL) e
		     JOIN segments s ON s.id = e.segment_id
		    GROUP BY e.user_id),
		 worked AS (
		   SELECT user_id, SUM(seconds)::int AS work_sec FROM work_time
		    WHERE day >= $1::date AND day < $2::date GROUP BY user_id)
		 SELECT u.id, u.name, u.email, u.role,
		        COALESCE(sa.sent, 0) AS sent, COALESCE(sa.sarvam_min, 0) AS sarvam_min,
		        COALESCE(r.jobs_sent, 0) AS jobs_sent, COALESCE(r.jobs_approved, 0) AS jobs_approved,
		        COALESCE(r.reviewed_min, 0) AS reviewed_min, COALESCE(b.behind_min, 0) AS behind_min,
		        COALESCE(c.lines_checked, 0) AS lines_checked, COALESCE(e.lines_edited, 0) AS lines_edited,
		        COALESCE(e.revoice_min, 0) AS revoice_min, COALESCE(w.work_sec, 0) AS work_sec
		   FROM users u
		   LEFT JOIN sarvam sa ON sa.user_id = u.id
		   LEFT JOIN reviews r ON r.user_id = u.id
		   LEFT JOIN behind b ON b.user_id = u.id
		   LEFT JOIN checked c ON c.user_id = u.id
		   LEFT JOIN edited e ON e.user_id = u.id
		   LEFT JOIN worked w ON w.user_id = u.id
		  WHERE u.role <> 'operator' OR sa.sent IS NOT NULL
		  ORDER BY COALESCE(sa.sarvam_min, 0) + COALESCE(b.behind_min, 0) DESC, COALESCE(r.jobs_sent, 0) DESC, u.name`,
		[from, to]
	);
}

export type VideoUsage = {
	id: number;
	video_id: number | null;
	title: string;
	created_at: Date;
	minutes: number;
	sarvam_job_id: string | null;
	sent_by: string | null;
	reviewer: string | null;
	status: string | null;
	lines_edited: number;
	revoice_min: number;
};

export async function usageByVideo(from: Date, to: Date, limit = 100): Promise<VideoUsage[]> {
	return query<VideoUsage>(
		`SELECT c.id, c.video_id, COALESCE(v.title, c.note, 'deleted video') AS title, c.created_at,
		        COALESCE(c.minutes, 0)::float AS minutes, c.sarvam_job_id, su.name AS sent_by,
		        ru.name AS reviewer, v.status,
		        (SELECT COUNT(DISTINCT e.segment_id) FROM segment_edits e JOIN segments s ON s.id = e.segment_id
		          WHERE s.video_id = c.video_id AND e.field = 'hi_text')::int AS lines_edited,
		        COALESCE((SELECT SUM(s.end_sec - s.start_sec) FROM segments s
		          WHERE s.video_id = c.video_id AND s.deleted_at IS NULL
		            AND EXISTS (SELECT 1 FROM segment_edits e WHERE e.segment_id = s.id AND e.field = 'hi_text')), 0)::float / 60 AS revoice_min
		   FROM credits_log c
		   LEFT JOIN videos v ON v.id = c.video_id
		   LEFT JOIN users su ON su.id = c.user_id
		   LEFT JOIN LATERAL (SELECT assigned_to FROM jobs WHERE video_id = c.video_id ORDER BY round DESC LIMIT 1) j ON TRUE
		   LEFT JOIN users ru ON ru.id = j.assigned_to
		  WHERE c.created_at >= $1 AND c.created_at < $2
		  ORDER BY c.created_at DESC LIMIT $3`,
		[from, to, limit]
	);
}

/** Months that have any usage or review work, newest first, for the period picker. */
export async function activeMonths(): Promise<string[]> {
	const rows = await query<{ m: string }>(
		`SELECT DISTINCT to_char(d, 'YYYY-MM') AS m FROM (
		   SELECT created_at AS d FROM credits_log UNION ALL SELECT submitted_at FROM jobs WHERE submitted_at IS NOT NULL
		   UNION ALL SELECT now()) x ORDER BY m DESC LIMIT 24`
	);
	return rows.map((r) => r.m);
}

import { query } from './db.ts';

/** Everything shown on a person's profile: who they are, their numbers, their days, their jobs. */
export async function loadProfile(userId: number) {
	const [user] = await query<{
		id: number;
		name: string;
		email: string;
		role: string;
		active: boolean;
		created_at: Date;
		last_login_at: Date | null;
	}>('SELECT id, name, email, role, active, created_at, last_login_at FROM users WHERE id = $1', [userId]);
	if (!user) return null;

	const [[stats], days, jobs, current] = await Promise.all([
		query<{
			jobs_sent: number;
			approved: number;
			sent_back: number;
			lines_checked: number;
			lines_edited: number;
			timing_changes: number;
			flags: number;
			seconds: number;
			seconds_week: number;
			videos_uploaded: number;
			approvals_given: number;
		}>(
			`SELECT
			   (SELECT COUNT(DISTINCT job_id)::int FROM job_events WHERE user_id = $1 AND action = 'submitted') AS jobs_sent,
			   (SELECT COUNT(*)::int FROM jobs WHERE assigned_to = $1 AND status IN ('approved', 'done')) AS approved,
			   (SELECT COUNT(*)::int FROM job_events e JOIN jobs j ON j.id = e.job_id WHERE j.assigned_to = $1 AND e.action = 'returned') AS sent_back,
			   (SELECT COUNT(*)::int FROM segments WHERE reviewed_by = $1 AND deleted_at IS NULL) AS lines_checked,
			   (SELECT COUNT(DISTINCT segment_id)::int FROM segment_edits WHERE user_id = $1 AND field = 'hi_text') AS lines_edited,
			   (SELECT COUNT(*)::int FROM segment_edits WHERE user_id = $1 AND field IN ('timing', 'split', 'merge', 'insert', 'delete')) AS timing_changes,
			   (SELECT COUNT(*)::int FROM segment_edits WHERE user_id = $1 AND field = 'flag' AND new_value IS NOT NULL) AS flags,
			   (SELECT COALESCE(SUM(seconds), 0)::int FROM work_time WHERE user_id = $1) AS seconds,
			   (SELECT COALESCE(SUM(seconds), 0)::int FROM work_time WHERE user_id = $1 AND day > current_date - 7) AS seconds_week,
			   (SELECT COUNT(*)::int FROM videos WHERE uploaded_by = $1) AS videos_uploaded,
			   (SELECT COUNT(*)::int FROM job_events WHERE user_id = $1 AND action IN ('approved', 'returned')) AS approvals_given`,
			[userId]
		),
		// last 30 days: active minutes, lines edited, actions
		query<{ day: string; minutes: number; edits: number; actions: number }>(
			`SELECT to_char(d, 'YYYY-MM-DD') AS day,
			        COALESCE((SELECT ROUND(SUM(seconds) / 60.0)::int FROM work_time w WHERE w.user_id = $1 AND w.day = d), 0) AS minutes,
			        (SELECT COUNT(*)::int FROM segment_edits s WHERE s.user_id = $1 AND s.created_at >= d AND s.created_at < d + 1) AS edits,
			        (SELECT COUNT(*)::int FROM activity_log a WHERE a.user_id = $1 AND a.created_at >= d AND a.created_at < d + 1) AS actions
			   FROM generate_series(current_date - 29, current_date, interval '1 day') AS g(d0), LATERAL (SELECT d0::date AS d) x
			  ORDER BY d`,
			[userId]
		),
		query<{
			job_id: number;
			video_id: number;
			title: string;
			round: number;
			status: string;
			assigned_at: Date | null;
			submitted_at: Date | null;
			seconds: number;
			edits: number;
			checked: number;
			lines: number;
			returned: number;
		}>(
			`SELECT j.id AS job_id, j.video_id, v.title, j.round, j.status, j.assigned_at, j.submitted_at,
			        COALESCE((SELECT SUM(seconds) FROM work_time w WHERE w.job_id = j.id AND w.user_id = $1), 0)::int AS seconds,
			        (SELECT COUNT(DISTINCT segment_id)::int FROM segment_edits se WHERE se.job_id = j.id AND se.user_id = $1) AS edits,
			        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = j.video_id AND s.deleted_at IS NULL AND s.reviewed_by = $1) AS checked,
			        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = j.video_id AND s.deleted_at IS NULL) AS lines,
			        (SELECT COUNT(*)::int FROM job_events e WHERE e.job_id = j.id AND e.action = 'returned') AS returned
			   FROM jobs j JOIN videos v ON v.id = j.video_id
			  WHERE j.assigned_to = $1 OR j.id IN (SELECT job_id FROM job_events WHERE user_id = $1 AND action IN ('claimed', 'submitted'))
			  ORDER BY COALESCE(j.submitted_at, j.assigned_at, j.created_at) DESC
			  LIMIT 100`,
			[userId]
		),
		query<{ job_id: number; title: string; locked_until: Date }>(
			`SELECT j.id AS job_id, v.title, j.locked_until FROM jobs j JOIN videos v ON v.id = j.video_id
			  WHERE j.assigned_to = $1 AND j.status = 'assigned' AND j.locked_until > now() LIMIT 1`,
			[userId]
		)
	]);

	return { user, stats, days, jobs, current: current[0] ?? null };
}

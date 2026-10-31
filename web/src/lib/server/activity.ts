import type { RequestEvent } from '@sveltejs/kit';
import { query } from './db.ts';

export type Track = { videoId?: number | null; jobId?: number | null; details?: string | null; userId?: number | null };

/**
 * Record one action in the activity log. Never throws: a logging hiccup must not
 * break the action itself.
 */
export async function track(event: RequestEvent | null, action: string, t: Track = {}) {
	let ip: string | null = null;
	try {
		ip = event?.getClientAddress() ?? null;
	} catch {
		/* no address available */
	}
	try {
		await query(
			`INSERT INTO activity_log (user_id, action, video_id, job_id, details, ip, user_agent)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[
				t.userId !== undefined ? t.userId : (event?.locals.user?.id ?? null),
				action,
				t.videoId ?? null,
				t.jobId ?? null,
				t.details?.slice(0, 1000) ?? null,
				ip,
				event?.request.headers.get('user-agent')?.slice(0, 300) ?? null
			]
		);
	} catch (e) {
		console.error('[activity] could not record', action, e);
	}
}

export type ActivityRow = {
	id: number;
	user_id: number | null;
	user_name: string | null;
	action: string;
	video_id: number | null;
	video_title: string | null;
	job_id: number | null;
	details: string | null;
	ip: string | null;
	created_at: Date;
};

export async function listActivity(opts: { userId?: number; action?: string; from?: string; to?: string; limit?: number; offset?: number }) {
	const where: string[] = [];
	const p: unknown[] = [];
	if (opts.userId) {
		p.push(opts.userId);
		where.push(`a.user_id = $${p.length}`);
	}
	if (opts.action) {
		p.push(`${opts.action}%`);
		where.push(`a.action LIKE $${p.length}`);
	}
	if (opts.from) {
		p.push(opts.from);
		where.push(`a.created_at >= $${p.length}::date`);
	}
	if (opts.to) {
		p.push(opts.to);
		where.push(`a.created_at < $${p.length}::date + 1`);
	}
	const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 5000);
	const offset = Math.max(opts.offset ?? 0, 0);
	const [rows, [{ total }]] = await Promise.all([
		query<ActivityRow>(
			`SELECT a.id, a.user_id, u.name AS user_name, a.action, a.video_id, v.title AS video_title, a.job_id,
			        a.details, a.ip, a.created_at
			   FROM activity_log a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN videos v ON v.id = a.video_id
			   ${cond} ORDER BY a.created_at DESC, a.id DESC LIMIT ${limit} OFFSET ${offset}`,
			p
		),
		query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM activity_log a ${cond}`, p)
	]);
	return { rows, total };
}

/** Add active seconds from the review screen's heartbeat. Gaps over 90 s count as away. */
export async function heartbeat(jobId: number, userId: number) {
	await query(
		`INSERT INTO work_time (job_id, user_id, day, seconds, last_beat) VALUES ($1, $2, current_date, 0, now())
		 ON CONFLICT (job_id, user_id, day) DO UPDATE SET
		   seconds = work_time.seconds + CASE WHEN now() - work_time.last_beat < interval '90 seconds'
		                                      THEN EXTRACT(EPOCH FROM now() - work_time.last_beat)::int ELSE 0 END,
		   last_beat = now()`,
		[jobId, userId]
	);
	// Same time in 10-minute slots for the hourly and live views. The gap is measured from the
	// person's last beat in any slot, so a slot change does not lose the seconds in between.
	await query(
		`WITH prev AS (SELECT MAX(last_beat) AS t FROM work_slots WHERE user_id = $2 AND slot >= now() - interval '20 minutes')
		 INSERT INTO work_slots (user_id, job_id, slot, seconds, last_beat)
		 SELECT $2, $1, to_timestamp(floor(EXTRACT(EPOCH FROM now()) / 600) * 600),
		        CASE WHEN prev.t IS NOT NULL AND now() - prev.t < interval '90 seconds'
		             THEN EXTRACT(EPOCH FROM now() - prev.t)::int ELSE 0 END,
		        now()
		   FROM prev
		 ON CONFLICT (user_id, slot) DO UPDATE SET
		   seconds = LEAST(600, work_slots.seconds + EXCLUDED.seconds), job_id = EXCLUDED.job_id, last_beat = now()`,
		[jobId, userId]
	);
}

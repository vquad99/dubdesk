import { query, tx } from './db.ts';

/** How long a pulled job stays with one reviewer before it returns to the queue. */
export const LOCK_HOURS = 4;
/** A check is held for an hour; working on it (edits, heartbeats) keeps extending it. */
export const CHECK_HOURS = 1;

type Q = typeof query;

export type Segment = {
	id: number;
	start_sec: string;
	end_sec: string;
	speaker: string | null;
	en_text: string;
	hi_text_original: string;
	hi_text: string;
	flag: string | null;
	comment: string | null;
	reviewed_at: Date | null;
	start_sec_original: string | null;
	end_sec_original: string | null;
	origin: string;
	deleted_at?: Date | null;
};

export type SegmentChange = {
	id: number;
	start_sec?: number;
	end_sec?: number;
	hi_text?: string;
	flag?: string | null;
	comment?: string | null;
	reviewed?: boolean;
};

export const FLAGS = ['missing', 'wrong_meaning', 'wrong_timing'] as const;

async function logEvent(q: Q, jobId: number, userId: number | null, action: string, note: string | null = null) {
	await q('INSERT INTO job_events (job_id, user_id, action, note) VALUES ($1, $2, $3, $4)', [
		jobId,
		userId,
		action,
		note
	]);
}

/** The job this reviewer is holding right now, if any. */
export async function currentJobId(userId: number): Promise<number | null> {
	const rows = await query<{ id: number }>(
		`SELECT id FROM jobs WHERE assigned_to = $1 AND status = 'assigned' AND locked_until > now()
		  ORDER BY assigned_at DESC LIMIT 1`,
		[userId]
	);
	return rows[0]?.id ?? null;
}

export async function waitingCount(): Promise<number> {
	const [{ n }] = await query<{ n: number }>(
		`SELECT COUNT(*)::int AS n FROM jobs
		  WHERE held_at IS NULL AND (status = 'queued' OR (status = 'assigned' AND locked_until <= now()))`
	);
	return n;
}

/**
 * Give the oldest waiting job to this reviewer. A job whose lock ran out counts as waiting.
 * Stopped (held) jobs are never handed out, and a job this reviewer already gave back comes to
 * them only when nothing else is waiting. SKIP LOCKED keeps two reviewers pressing at the same
 * moment from getting the same job.
 */
export async function claimNextJob(userId: number): Promise<number | null> {
	return tx(async (q) => {
		const rows = await q<{ id: number; video_id: number }>(
			`UPDATE jobs SET status = 'assigned', assigned_to = $1, assigned_at = now(),
			        locked_until = now() + make_interval(hours => $2)
			  WHERE id = (
			        SELECT id FROM jobs j
			         WHERE j.held_at IS NULL AND (j.status = 'queued' OR (j.status = 'assigned' AND j.locked_until <= now()))
			         ORDER BY EXISTS (SELECT 1 FROM job_events e JOIN jobs j2 ON j2.id = e.job_id
			                           WHERE j2.video_id = j.video_id AND e.user_id = $1 AND e.action IN ('released', 'expired')),
			                  j.created_at
			         LIMIT 1 FOR UPDATE SKIP LOCKED)
			  RETURNING id, video_id`,
			[userId, LOCK_HOURS]
		);
		if (!rows[0]) return null;
		await q(`UPDATE videos SET status = 'in_review', updated_at = now() WHERE id = $1`, [rows[0].video_id]);
		await logEvent(q, rows[0].id, userId, 'claimed');
		return rows[0].id;
	});
}

export type JobRow = {
	id: number;
	video_id: number;
	round: number;
	status: string;
	assigned_to: number | null;
	assigned_at: Date | null;
	locked_until: Date | null;
	admin_note: string | null;
	held_at: Date | null;
	hold_reason: string | null;
	qa_by: number | null;
	qa_locked_until: Date | null;
	reviewer_name: string | null;
	qa_name: string | null;
	title: string;
	duration_sec: string | null;
	source_key: string | null;
	dubbed_key: string | null;
	peaks_key: string | null;
	audio_key: string | null;
	dubbed_audio_key: string | null;
	sarvam_job_id: string | null;
};

export async function loadJob(jobId: number) {
	const [job] = await query<JobRow>(
		`SELECT j.id, j.video_id, j.round, j.status, j.assigned_to, j.assigned_at, j.locked_until, j.admin_note, j.held_at, j.hold_reason,
		        j.qa_by, j.qa_locked_until, ru.name AS reviewer_name, qu.name AS qa_name,
		        v.title, v.duration_sec, v.source_key, v.dubbed_key, v.peaks_key, v.audio_key, v.dubbed_audio_key, v.sarvam_job_id
		   FROM jobs j JOIN videos v ON v.id = j.video_id
		   LEFT JOIN users ru ON ru.id = j.assigned_to LEFT JOIN users qu ON qu.id = j.qa_by
		  WHERE j.id = $1`,
		[jobId]
	);
	if (!job) return null;
	return { job, segments: await loadSegments(job.video_id) };
}

const SEG_COLS = `id, start_sec, end_sec, speaker, en_text, hi_text_original, hi_text, flag, comment, reviewed_at,
	start_sec_original, end_sec_original, origin`;

export async function loadSegments(videoId: number) {
	return query<Segment>(
		`SELECT ${SEG_COLS} FROM segments WHERE video_id = $1 AND deleted_at IS NULL ORDER BY start_sec, id`,
		[videoId]
	);
}

/** Lines a reviewer removed, for the admin's view of what changed. */
export async function loadDeletedSegments(videoId: number) {
	return query<Segment>(
		`SELECT ${SEG_COLS}, deleted_at FROM segments WHERE video_id = $1 AND deleted_at IS NOT NULL ORDER BY start_sec, id`,
		[videoId]
	);
}

/** Working on a job keeps it: every save pushes the lock end out again. */
export async function touchLock(jobId: number) {
	await query(
		`UPDATE jobs SET locked_until = CASE WHEN status = 'assigned' THEN now() + make_interval(hours => $2) ELSE locked_until END,
		        qa_locked_until = CASE WHEN status = 'submitted' AND qa_by IS NOT NULL THEN now() + make_interval(hours => $3) ELSE qa_locked_until END
		  WHERE id = $1`,
		[jobId, LOCK_HOURS, CHECK_HOURS]
	);
}

export const MIN_LINE_SEC = 0.1;

/** Shortest-first sanity checks on a line's timing. Returns an error message or null. */
export function badTiming(start: number, end: number, duration: number | null): string | null {
	if (!Number.isFinite(start) || !Number.isFinite(end)) return 'Times must be numbers.';
	if (start < 0) return 'A line cannot start before 0:00.';
	if (end - start < MIN_LINE_SEC) return `A line must be at least ${MIN_LINE_SEC * 1000} ms long.`;
	if (duration && end > duration + 0.5) return 'A line cannot end after the video ends.';
	return null;
}

/** Is this job held by this reviewer right now (lock not run out)? */
/** True when this operator (or admin) is the one checking this submitted job right now. */
export function checks(job: JobRow, userId: number): boolean {
	return (
		job.status === 'submitted' &&
		job.qa_by === userId &&
		!!job.qa_locked_until &&
		new Date(job.qa_locked_until).getTime() > Date.now()
	);
}

/** May write lines: the reviewer holding the job, or the operator checking it. */
export function canEdit(job: JobRow, userId: number): boolean {
	return holds(job, userId) || checks(job, userId);
}

/**
 * The operator takes a submitted job to check. Nobody else can check it while their lock lasts;
 * an expired lock frees it for another operator. Returns false when someone else is checking.
 */
export async function startCheck(jobId: number, userId: number): Promise<boolean> {
	return tx(async (q) => {
		const rows = await q<{ id: number }>(
			`UPDATE jobs SET qa_by = $2, qa_locked_until = now() + make_interval(hours => $3)
			  WHERE id = $1 AND status = 'submitted'
			    AND (qa_by IS NULL OR qa_by = $2 OR qa_locked_until <= now())
			  RETURNING id`,
			[jobId, userId, CHECK_HOURS]
		);
		if (!rows[0]) return false;
		const [prev] = await q<{ n: number }>(
			`SELECT COUNT(*)::int AS n FROM job_events WHERE job_id = $1 AND user_id = $2 AND action = 'check_started'
			   AND created_at > now() - make_interval(hours => $3)`,
			[jobId, userId, LOCK_HOURS]
		);
		if (!prev.n) await logEvent(q, jobId, userId, 'check_started');
		return true;
	});
}

/** The operator stops checking without a decision (or the admin frees it); the job waits for the next check. */
export async function releaseCheck(jobId: number, userId: number, anyChecker = false) {
	await tx(async (q) => {
		await q(`UPDATE jobs SET qa_by = NULL, qa_locked_until = NULL WHERE id = $1 AND ($3 OR qa_by = $2)`, [jobId, userId, anyChecker]);
		await logEvent(q, jobId, userId, 'check_released');
	});
}

/** Submitted jobs for the operator's check queue, oldest first, with who is checking each. */
export async function checkQueue() {
	return query<{
		job_id: number;
		video_id: number;
		title: string;
		duration_sec: string | null;
		round: number;
		reviewer: string | null;
		submitted_at: Date | null;
		qa_by: number | null;
		qa_name: string | null;
		qa_active: boolean;
		lines: number;
		edited: number;
	}>(
		`SELECT j.id AS job_id, j.video_id, v.title, v.duration_sec, j.round, ru.name AS reviewer, j.submitted_at,
		        j.qa_by, qu.name AS qa_name, (j.qa_locked_until > now()) AS qa_active,
		        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = v.id AND s.deleted_at IS NULL) AS lines,
		        (SELECT COUNT(*)::int FROM segments s WHERE s.video_id = v.id AND s.deleted_at IS NULL
		           AND (s.hi_text <> s.hi_text_original OR s.origin <> 'source')) AS edited
		   FROM jobs j JOIN videos v ON v.id = j.video_id
		   LEFT JOIN users ru ON ru.id = j.assigned_to LEFT JOIN users qu ON qu.id = j.qa_by
		  WHERE j.status = 'submitted' ORDER BY j.submitted_at NULLS LAST, j.id`
	);
}

export function holds(job: JobRow, userId: number): boolean {
	return (
		job.status === 'assigned' &&
		job.assigned_to === userId &&
		!!job.locked_until &&
		new Date(job.locked_until).getTime() > Date.now()
	);
}

/**
 * Save line edits for one job. Only real changes are written, each one kept in segment_edits.
 * Lines that do not belong to the job's video are ignored.
 */
export async function saveSegments(jobId: number, videoId: number, userId: number, changes: SegmentChange[]) {
	return tx(async (q) => {
		const current = await q<Segment>(
			'SELECT id, start_sec, end_sec, hi_text, flag, comment, reviewed_at FROM segments WHERE video_id = $1 AND deleted_at IS NULL',
			[videoId]
		);
		const [{ duration_sec }] = await q<{ duration_sec: string | null }>('SELECT duration_sec FROM videos WHERE id = $1', [videoId]);
		const byId = new Map(current.map((s) => [s.id, s]));
		let changed = 0;
		let timingTouched = false;

		for (const c of changes) {
			const seg = byId.get(Number(c.id));
			if (!seg) continue;
			if (c.start_sec !== undefined || c.end_sec !== undefined) {
				const st = Math.round(Number(c.start_sec ?? seg.start_sec) * 1000) / 1000;
				const en = Math.round(Number(c.end_sec ?? seg.end_sec) * 1000) / 1000;
				const bad = badTiming(st, en, duration_sec ? Number(duration_sec) : null);
				if (bad) throw new TimingError(bad);
				if (st !== Number(seg.start_sec) || en !== Number(seg.end_sec)) {
					timingTouched = true;
					await q('UPDATE segments SET start_sec = $2, end_sec = $3, updated_at = now() WHERE id = $1', [seg.id, st, en]);
					await q(
						`INSERT INTO segment_edits (segment_id, job_id, user_id, field, old_value, new_value) VALUES ($1, $2, $3, 'timing', $4, $5)`,
						[seg.id, jobId, userId, `${seg.start_sec}-${seg.end_sec}`, `${st}-${en}`]
					);
					if (c.hi_text === undefined && c.flag === undefined && c.comment === undefined && c.reviewed === undefined) {
						changed++;
						continue;
					}
				}
			}
			const next = {
				hi_text: c.hi_text === undefined ? seg.hi_text : String(c.hi_text).trim(),
				flag: c.flag === undefined ? seg.flag : FLAGS.includes(c.flag as never) ? c.flag : null,
				comment: c.comment === undefined ? seg.comment : String(c.comment ?? '').trim() || null
			};
			const fields = (['hi_text', 'flag', 'comment'] as const).filter((f) => (seg[f] ?? null) !== next[f]);
			const reviewChange = c.reviewed !== undefined && c.reviewed !== !!seg.reviewed_at;
			if (fields.length === 0 && !reviewChange) continue;

			await q(
				`UPDATE segments SET hi_text = $2, flag = $3, comment = $4, updated_at = now(),
				        reviewed_at = CASE WHEN $5::boolean IS NULL THEN reviewed_at
				                           WHEN $5 THEN COALESCE(reviewed_at, now()) ELSE NULL END,
				        reviewed_by = CASE WHEN $5::boolean IS NULL THEN reviewed_by
				                           WHEN $5 THEN $6 ELSE NULL END
				  WHERE id = $1`,
				[seg.id, next.hi_text, next.flag, next.comment, reviewChange ? c.reviewed : null, userId]
			);
			for (const f of fields) {
				await q(
					`INSERT INTO segment_edits (segment_id, job_id, user_id, field, old_value, new_value)
					 VALUES ($1, $2, $3, $4, $5, $6)`,
					[seg.id, jobId, userId, f, seg[f], next[f]]
				);
			}
			changed++;
		}
		// Checked once at the end, so moving two neighbours in one save never trips over the half-way state.
		if (timingTouched) {
			const [o] = await q<{ n: number }>(
				`SELECT COUNT(*)::int AS n FROM segments a JOIN segments b
				   ON a.video_id = b.video_id AND a.id < b.id AND a.start_sec < b.end_sec AND a.end_sec > b.start_sec
				  WHERE a.video_id = $1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL`,
				[videoId]
			);
			if (o.n > 0) throw new TimingError('That timing overlaps another line.');
		}
		return changed;
	});
}

export class TimingError extends Error {}

/** A line may touch its neighbours but never overlap them. */
async function assertNoOverlap(q: Q, videoId: number, start: number, end: number, exceptId: number | null) {
	const [hit] = await q<{ n: number }>(
		`SELECT COUNT(*)::int AS n FROM segments
		  WHERE video_id = $1 AND deleted_at IS NULL AND ($4::int IS NULL OR id <> $4)
		    AND start_sec < $3 AND end_sec > $2`,
		[videoId, start, end, exceptId]
	);
	if (hit.n > 0) throw new TimingError('That timing overlaps another line.');
}

// ---------- structural line changes (each one kept in segment_edits) ----------

async function logEdit(q: Q, segId: number, jobId: number, userId: number, field: string, oldV: string | null, newV: string | null) {
	await q(
		`INSERT INTO segment_edits (segment_id, job_id, user_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)`,
		[segId, jobId, userId, field, oldV, newV]
	);
}

/** Cut a line in two at time `at`. The text is cut where the reviewer put the cursor (hiCut / enCut chars). */
export async function splitSegment(jobId: number, videoId: number, userId: number, id: number, at: number, hiCut?: number, enCut?: number) {
	return tx(async (q) => {
		const [s] = await q<Segment>(`SELECT ${SEG_COLS} FROM segments WHERE id = $1 AND video_id = $2 AND deleted_at IS NULL FOR UPDATE`, [id, videoId]);
		if (!s) throw new TimingError('That line no longer exists.');
		const start = Number(s.start_sec);
		const end = Number(s.end_sec);
		if (!(at - start >= MIN_LINE_SEC && end - at >= MIN_LINE_SEC)) throw new TimingError('Put the play head inside the line to split it.');
		const cut = (text: string, n?: number) => {
			if (n === undefined || n <= 0 || n >= text.length) {
				const words = text.split(' ');
				const half = Math.ceil(words.length / 2);
				return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
			}
			return [text.slice(0, n).trim(), text.slice(n).trim()];
		};
		const [hiA, hiB] = cut(s.hi_text, hiCut);
		const [enA, enB] = cut(s.en_text, enCut);
		await q('UPDATE segments SET end_sec = $2, hi_text = $3, en_text = $4, updated_at = now() WHERE id = $1', [id, at, hiA, enA]);
		const [b] = await q<{ id: number }>(
			`INSERT INTO segments (video_id, start_sec, end_sec, speaker, en_text, hi_text_original, hi_text, origin, start_sec_original, end_sec_original)
			 VALUES ($1, $2, $3, $4, $5, '', $6, 'split', NULL, NULL) RETURNING id`,
			[videoId, at, end, s.speaker, enB, hiB]
		);
		await logEdit(q, id, jobId, userId, 'split', `${start}-${end}`, `${start}-${at} | ${at}-${end}`);
		await logEdit(q, b.id, jobId, userId, 'split', null, `from line ${id}`);
		return b.id;
	});
}

/** Join a line with the one after it. */
export async function mergeWithNext(jobId: number, videoId: number, userId: number, id: number) {
	return tx(async (q) => {
		const rows = await q<Segment>(
			`SELECT ${SEG_COLS} FROM segments WHERE video_id = $1 AND deleted_at IS NULL ORDER BY start_sec, id FOR UPDATE`,
			[videoId]
		);
		const i = rows.findIndex((r) => r.id === id);
		if (i < 0 || i === rows.length - 1) throw new TimingError('There is no next line to join.');
		const a = rows[i];
		const b = rows[i + 1];
		const join = (x: string, y: string) => [x, y].filter((t) => t.trim()).join(' ');
		await q(
			`UPDATE segments SET end_sec = $2, hi_text = $3, en_text = $4, origin = CASE WHEN origin = 'source' THEN 'merged' ELSE origin END,
			        flag = COALESCE(flag, $5::text), comment = NULLIF(concat_ws(' / ', comment, $6::text), ''), updated_at = now()
			  WHERE id = $1`,
			[a.id, Math.max(Number(a.end_sec), Number(b.end_sec)), join(a.hi_text, b.hi_text), join(a.en_text, b.en_text), b.flag, b.comment]
		);
		await q('UPDATE segments SET deleted_at = now() WHERE id = $1', [b.id]);
		await logEdit(q, a.id, jobId, userId, 'merge', null, `joined line ${b.id}`);
		await logEdit(q, b.id, jobId, userId, 'delete', b.hi_text, `merged into line ${a.id}`);
		return a.id;
	});
}

/** Add an empty line, e.g. for speech the dub missed. */
export async function insertSegment(jobId: number, videoId: number, userId: number, start: number, end: number) {
	const [{ duration_sec }] = await query<{ duration_sec: string | null }>('SELECT duration_sec FROM videos WHERE id = $1', [videoId]);
	const bad = badTiming(start, end, duration_sec ? Number(duration_sec) : null);
	if (bad) throw new TimingError(bad);
	return tx(async (q) => {
		await q('SELECT id FROM videos WHERE id = $1 FOR UPDATE', [videoId]);
		await assertNoOverlap(q, videoId, start, end, null);
		const [n] = await q<{ id: number }>(
			`INSERT INTO segments (video_id, start_sec, end_sec, en_text, hi_text_original, hi_text, origin, flag)
			 VALUES ($1, $2, $3, '', '', '', 'inserted', 'missing') RETURNING id`,
			[videoId, Math.round(start * 1000) / 1000, Math.round(end * 1000) / 1000]
		);
		await logEdit(q, n.id, jobId, userId, 'insert', null, `${start}-${end}`);
		return n.id;
	});
}

/** Remove a line (kept in the database so the admin still sees it). */
export async function deleteSegment(jobId: number, videoId: number, userId: number, id: number) {
	await tx(async (q) => {
		const [s] = await q<Segment>('SELECT hi_text FROM segments WHERE id = $1 AND video_id = $2 AND deleted_at IS NULL FOR UPDATE', [id, videoId]);
		if (!s) throw new TimingError('That line no longer exists.');
		await q('UPDATE segments SET deleted_at = now() WHERE id = $1', [id]);
		await logEdit(q, id, jobId, userId, 'delete', s.hi_text, null);
	});
}

/** Find & replace across the Hindi text of a whole job. Returns the lines changed. */
export async function replaceInJob(jobId: number, videoId: number, userId: number, find: string, replace: string) {
	if (!find) return 0;
	const segs = await loadSegments(videoId);
	const changes = segs
		.filter((s) => s.hi_text.includes(find))
		.map((s) => ({ id: s.id, hi_text: s.hi_text.split(find).join(replace) }));
	return changes.length ? saveSegments(jobId, videoId, userId, changes) : 0;
}

export async function releaseJob(jobId: number, videoId: number, userId: number, reason: string | null = null) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET status = 'queued', assigned_to = NULL, assigned_at = NULL, locked_until = NULL WHERE id = $1`,
			[jobId]
		);
		await q(`UPDATE videos SET status = 'ready_for_review', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, userId, 'released', reason);
	});
}

export async function submitJob(jobId: number, videoId: number, userId: number, note: string | null) {
	await tx(async (q) => {
		await q(`UPDATE jobs SET status = 'submitted', submitted_at = now(), locked_until = NULL WHERE id = $1`, [jobId]);
		await q(`UPDATE videos SET status = 'submitted', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, userId, 'submitted', note);
	});
}

/** Admin accepts the reviewer's work. The dub is then regenerated from the corrected lines. */
export async function approveJob(jobId: number, videoId: number, adminId: number, note: string | null) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET status = 'approved', reviewed_by = $2, reviewed_at = now(), admin_note = $3,
			        qa_by = NULL, qa_locked_until = NULL WHERE id = $1`,
			[jobId, adminId, note]
		);
		// The video is finished once its review is approved.
		await q(`UPDATE videos SET status = 'done', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'approved', note);
	});
}

/** Admin sends the job back to the same reviewer with a note; it opens again on their screen. */
export async function returnJob(jobId: number, videoId: number, adminId: number, note: string) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET status = 'assigned', admin_note = $2, reviewed_by = $3, reviewed_at = now(),
			        assigned_at = now(), locked_until = now() + make_interval(hours => $4), qa_by = NULL, qa_locked_until = NULL
			  WHERE id = $1`,
			[jobId, note, adminId, LOCK_HOURS]
		);
		await q(`UPDATE videos SET status = 'in_review', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'returned', note);
	});
}

/** Admin stops a job: nobody can pick it up until it is resumed. A reviewer holding it loses it. */
export async function holdJob(jobId: number, videoId: number, adminId: number, reason: string) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET held_at = now(), held_by = $2, hold_reason = $3,
			        status = 'queued', assigned_to = NULL, assigned_at = NULL, locked_until = NULL
			  WHERE id = $1 AND status IN ('queued', 'assigned', 'returned')`,
			[jobId, adminId, reason]
		);
		await q(`UPDATE videos SET status = 'ready_for_review', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'held', reason);
	});
}

/** Admin lets a stopped job be picked up again. */
export async function resumeJob(jobId: number, videoId: number, adminId: number) {
	await tx(async (q) => {
		await q(`UPDATE jobs SET held_at = NULL, held_by = NULL, hold_reason = NULL WHERE id = $1`, [jobId]);
		await q(`UPDATE videos SET updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'resumed');
	});
}

/** Admin gives the job straight to one reviewer (also takes it off whoever had it, and lifts a stop). */
export async function assignJob(jobId: number, videoId: number, reviewerId: number, adminId: number, note: string | null) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET status = 'assigned', assigned_to = $2, assigned_at = now(),
			        locked_until = now() + make_interval(hours => $3),
			        held_at = NULL, held_by = NULL, hold_reason = NULL,
			        admin_note = COALESCE($4, admin_note)
			  WHERE id = $1 AND status IN ('queued', 'assigned', 'returned')`,
			[jobId, reviewerId, LOCK_HOURS, note]
		);
		await q(`UPDATE videos SET status = 'in_review', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'assigned', note);
	});
}

/** Who gave this video back or let it time out, and how often the admin sent it back. */
export async function troubleOf(videoId: number) {
	const rows = await query<{ action: string; note: string | null; created_at: Date; user_id: number | null; user_name: string | null }>(
		`SELECT e.action, e.note, e.created_at, e.user_id, u.name AS user_name
		   FROM job_events e JOIN jobs j ON j.id = e.job_id LEFT JOIN users u ON u.id = e.user_id
		  WHERE j.video_id = $1 AND e.action IN ('released', 'expired', 'returned') ORDER BY e.created_at`,
		[videoId]
	);
	const gaveBack = rows.filter((r) => r.action !== 'returned');
	return {
		givenBack: gaveBack.length,
		people: new Set(gaveBack.map((r) => r.user_id)).size,
		sentBack: rows.filter((r) => r.action === 'returned').length,
		events: rows
	};
}

/** Admin takes a job off a reviewer and puts it back in the queue. */
export async function unlockJob(jobId: number, videoId: number, adminId: number) {
	await tx(async (q) => {
		await q(
			`UPDATE jobs SET status = 'queued', assigned_to = NULL, assigned_at = NULL, locked_until = NULL WHERE id = $1`,
			[jobId]
		);
		await q(`UPDATE videos SET status = 'ready_for_review', updated_at = now() WHERE id = $1`, [videoId]);
		await logEvent(q, jobId, adminId, 'unlocked');
	});
}

export type TaskRow = {
	video_id: number;
	job_id: number | null;
	title: string;
	duration_sec: string | null;
	video_status: string;
	job_status: string | null;
	round: number | null;
	reviewer: string | null;
	locked_until: Date | null;
	held_at: Date | null;
	hold_reason: string | null;
	gave_back: number; // different people who gave it back or let it time out
	sent_back: number; // times the admin sent it back
	lines: number;
	edited: number;
	flagged: number;
	checked: number;
	updated_at: Date;
};

const TASK_SELECT = `
	SELECT v.id AS video_id, j.id AS job_id, v.title, v.duration_sec, v.status AS video_status,
	       j.status AS job_status, j.round, u.name AS reviewer, j.locked_until, j.held_at, j.hold_reason,
	       (SELECT COUNT(DISTINCT e.user_id)::int FROM job_events e JOIN jobs jj ON jj.id = e.job_id
	         WHERE jj.video_id = v.id AND e.action IN ('released', 'expired')) AS gave_back,
	       (SELECT COUNT(*)::int FROM job_events e JOIN jobs jj ON jj.id = e.job_id
	         WHERE jj.video_id = v.id AND e.action = 'returned') AS sent_back,
	       COUNT(s.id)::int AS lines,
	       COUNT(s.id) FILTER (WHERE s.hi_text <> s.hi_text_original OR s.origin <> 'source'
	                            OR s.start_sec <> s.start_sec_original OR s.end_sec <> s.end_sec_original)::int AS edited,
	       COUNT(s.id) FILTER (WHERE s.flag IS NOT NULL)::int AS flagged,
	       COUNT(s.id) FILTER (WHERE s.reviewed_at IS NOT NULL)::int AS checked,
	       v.updated_at
	  FROM videos v
	  LEFT JOIN LATERAL (SELECT * FROM jobs WHERE video_id = v.id ORDER BY round DESC LIMIT 1) j ON TRUE
	  LEFT JOIN users u ON u.id = j.assigned_to
	  LEFT JOIN segments s ON s.video_id = v.id AND s.deleted_at IS NULL`;

export async function listTasks(opts: { status?: string; q?: string; limit?: number; offset?: number } = {}) {
	const where: string[] = [];
	const params: unknown[] = [];
	if (opts.status === 'on_hold') where.push('j.held_at IS NOT NULL');
	else if (opts.status === 'trouble')
		where.push(`(SELECT COUNT(DISTINCT e.user_id) FROM job_events e JOIN jobs jj ON jj.id = e.job_id
		              WHERE jj.video_id = v.id AND e.action IN ('released', 'expired')) >= 2`);
	else if (opts.status) {
		params.push(opts.status);
		where.push(`(j.status = $${params.length} OR v.status = $${params.length})`);
		if (opts.status === 'queued') where.push('j.held_at IS NULL');
	}
	if (opts.q) {
		params.push(`%${opts.q}%`);
		where.push(`(v.title ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
	}
	const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const offset = Math.max(opts.offset ?? 0, 0);
	// Pick the page of videos first, then count lines only for those: stays fast with thousands of videos.
	const [rows, [{ total }]] = await Promise.all([
		query<TaskRow>(
			`WITH page AS (
			   SELECT v.id FROM videos v
			   LEFT JOIN LATERAL (SELECT * FROM jobs WHERE video_id = v.id ORDER BY round DESC LIMIT 1) j ON TRUE
			   LEFT JOIN users u ON u.id = j.assigned_to
			   ${cond} ORDER BY v.updated_at DESC, v.id DESC LIMIT ${limit} OFFSET ${offset})
			 ${TASK_SELECT} WHERE v.id IN (SELECT id FROM page)
			 GROUP BY v.id, j.id, j.status, j.round, u.name, j.locked_until, j.held_at, j.hold_reason
			 ORDER BY v.updated_at DESC, v.id DESC`,
			params
		),
		query<{ total: number }>(
			`SELECT COUNT(*)::int AS total FROM videos v
			   LEFT JOIN LATERAL (SELECT * FROM jobs WHERE video_id = v.id ORDER BY round DESC LIMIT 1) j ON TRUE
			   LEFT JOIN users u ON u.id = j.assigned_to ${cond}`,
			params
		)
	]);
	return Object.assign(rows, { total });
}

export async function loadTask(videoId: number) {
	const [task] = await query<TaskRow & { error: string | null; source_key: string | null; dubbed_key: string | null; peaks_key: string | null; sarvam_job_id: string | null; sarvam_status: string | null; sarvam_progress: number | null; original_filename: string; size_bytes: string | null }>(
		`${TASK_SELECT.replace('v.updated_at', 'v.updated_at, v.error, v.source_key, v.dubbed_key, v.peaks_key, v.sarvam_job_id, v.sarvam_status, v.sarvam_progress, v.original_filename, v.size_bytes')} WHERE v.id = $1 GROUP BY v.id, j.id, j.status, j.round, u.name, j.locked_until, j.held_at, j.hold_reason`,
		[videoId]
	);
	if (!task) return null;
	const [segments, deleted, events, job] = await Promise.all([
		loadSegments(videoId),
		loadDeletedSegments(videoId),
		task.job_id
			? query<{ action: string; note: string | null; created_at: Date; user_name: string | null }>(
					`SELECT e.action, e.note, e.created_at, u.name AS user_name
					   FROM job_events e LEFT JOIN users u ON u.id = e.user_id
					  WHERE e.job_id = $1 ORDER BY e.created_at, e.id`,
					[task.job_id]
				)
			: Promise.resolve([]),
		task.job_id ? loadJob(task.job_id) : Promise.resolve(null)
	]);
	return { task, segments, deleted, events, job: job?.job ?? null };
}

/** Numbers for the admin overview. */
export async function overviewStats() {
	const [[counts], reviewers, [lines]] = await Promise.all([
		query<{
			videos: number;
			waiting: number;
			in_review: number;
			submitted: number;
			approved: number;
			minutes: number;
		}>(
			`SELECT (SELECT COUNT(*)::int FROM videos) AS videos,
			        COUNT(*) FILTER (WHERE j.status = 'queued' OR (j.status = 'assigned' AND j.locked_until <= now()))::int AS waiting,
			        COUNT(*) FILTER (WHERE j.status = 'assigned' AND j.locked_until > now())::int AS in_review,
			        COUNT(*) FILTER (WHERE j.status = 'submitted')::int AS submitted,
			        COUNT(*) FILTER (WHERE j.status IN ('approved', 'done'))::int AS approved,
			        COALESCE((SELECT ROUND(SUM(duration_sec) / 60)::int FROM videos), 0) AS minutes
			   FROM (SELECT DISTINCT ON (video_id) * FROM jobs ORDER BY video_id, round DESC) j`
		),
		query<{ name: string; submitted: number; lines_edited: number; avg_minutes: number | null }>(
			`SELECT u.name,
			        COUNT(DISTINCT e.job_id) FILTER (WHERE e.action = 'submitted')::int AS submitted,
			        (SELECT COUNT(DISTINCT se.segment_id)::int FROM segment_edits se WHERE se.user_id = u.id) AS lines_edited,
			        (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (j.submitted_at - j.assigned_at)) / 60))::int
			           FROM jobs j WHERE j.assigned_to = u.id AND j.submitted_at IS NOT NULL) AS avg_minutes
			   FROM users u LEFT JOIN job_events e ON e.user_id = u.id
			  WHERE u.role = 'reviewer' AND u.active
			  GROUP BY u.id ORDER BY submitted DESC, u.name`
		),
		query<{ total: number; edited: number; flagged: number }>(
			`SELECT COUNT(*)::int AS total,
			        COUNT(*) FILTER (WHERE hi_text <> hi_text_original)::int AS edited,
			        COUNT(*) FILTER (WHERE flag IS NOT NULL)::int AS flagged
			   FROM segments WHERE deleted_at IS NULL`
		)
	]);
	return { counts, reviewers, lines };
}

/** Jobs this reviewer has sent back to the admin, newest first. */
export async function myHistory(userId: number) {
	return query<{ job_id: number; title: string; status: string; submitted_at: Date; edited: number }>(
		`SELECT j.id AS job_id, v.title, j.status, j.submitted_at,
		        (SELECT COUNT(DISTINCT se.segment_id)::int FROM segment_edits se WHERE se.job_id = j.id) AS edited
		   FROM jobs j JOIN videos v ON v.id = j.video_id
		  WHERE j.assigned_to = $1 AND j.submitted_at IS NOT NULL
		  ORDER BY j.submitted_at DESC LIMIT 20`,
		[userId]
	);
}

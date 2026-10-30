// Job workflow against a real Postgres. Runs only when TEST_DATABASE_URL is set,
// and uses its own throwaway rows so it never touches real tasks.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('job workflow (database)', async () => {
	process.env.DATABASE_URL = url;
	const { query } = await import('../src/lib/server/db.ts');
	const jobs = await import('../src/lib/server/jobs.ts');
	const tag = `test-${Date.now()}`;
	let reviewers: number[] = [];
	let adminId = 0;
	let videoId = 0;
	let jobId = 0;

	beforeAll(async () => {
		const mk = async (role: string, n: number) =>
			(
				await query<{ id: number }>(
					`INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, 'x') RETURNING id`,
					[`${tag}-${role}-${n}@test.local`, `${tag} ${role} ${n}`, role]
				)
			)[0].id;
		reviewers = [await mk('reviewer', 1), await mk('reviewer', 2)];
		adminId = await mk('admin', 1);
		videoId = (
			await query<{ id: number }>(
				`INSERT INTO videos (title, original_filename, status) VALUES ($1, 'x.mp4', 'ready_for_review') RETURNING id`,
				[tag]
			)
		)[0].id;
		// Older than any real job so this test's claim picks it first.
		jobId = (
			await query<{ id: number }>(
				`INSERT INTO jobs (video_id, status, created_at) VALUES ($1, 'queued', '2000-01-01') RETURNING id`,
				[videoId]
			)
		)[0].id;
		await query(
			`INSERT INTO segments (video_id, el_segment_id, start_sec, end_sec, en_text, hi_text_original, hi_text)
			 VALUES ($1, 'a', 0, 1, 'Hello', 'नमस्ते', 'नमस्ते'), ($1, 'b', 1, 2, 'Bye', 'अलविदा', 'अलविदा')`,
			[videoId]
		);
	});

	afterAll(async () => {
		await query('DELETE FROM videos WHERE id = $1', [videoId]);
		// a test reviewer may have briefly picked up (and given back) a real job
		const ids = [...reviewers, adminId];
		await query('DELETE FROM job_events WHERE user_id = ANY($1)', [ids]);
		await query('DELETE FROM segment_edits WHERE user_id = ANY($1)', [ids]);
		await query(`DELETE FROM users WHERE email LIKE $1`, [`${tag}-%`]);
	});

	it('gives one job to exactly one of two reviewers pressing at once', async () => {
		const [a, b] = await Promise.all(reviewers.map((r) => jobs.claimNextJob(r)));
		expect([a, b].filter((x) => x === jobId)).toHaveLength(1);
		// release any other real job the second reviewer may have taken
		for (const [i, got] of [a, b].entries()) {
			if (got && got !== jobId) {
				const d = await jobs.loadJob(got);
				await jobs.releaseJob(got, d!.job.video_id, reviewers[i]);
			}
		}
	});

	it('saves only real changes and keeps the edit history', async () => {
		const holder = (await jobs.loadJob(jobId))!.job.assigned_to!;
		const segs = await jobs.loadSegments(videoId);
		const n = await jobs.saveSegments(jobId, videoId, holder, [
			{ id: segs[0].id, hi_text: 'नमस्कार', reviewed: true },
			{ id: segs[1].id, hi_text: 'अलविदा' }, // unchanged
			{ id: 999999999, hi_text: 'not in this video' }
		]);
		expect(n).toBe(1);
		const edits = await query('SELECT * FROM segment_edits WHERE job_id = $1', [jobId]);
		expect(edits).toHaveLength(1);
		const after = await jobs.loadSegments(videoId);
		expect(after[0].hi_text).toBe('नमस्कार');
		expect(after[0].reviewed_at).not.toBeNull();
	});

	it('find & replace changes every matching line', async () => {
		const holder = (await jobs.loadJob(jobId))!.job.assigned_to!;
		const n = await jobs.replaceInJob(jobId, videoId, holder, 'अलविदा', 'फिर मिलेंगे');
		expect(n).toBe(1);
	});

	it('moves timing, refuses overlaps, splits, joins, adds and removes lines', async () => {
		const holder = (await jobs.loadJob(jobId))!.job.assigned_to!;
		let segs = await jobs.loadSegments(videoId);
		// segment a: 0-1, b: 1-2. Shrink a, then try to push b into a.
		await jobs.saveSegments(jobId, videoId, holder, [{ id: segs[0].id, end_sec: 0.8 }]);
		await expect(jobs.saveSegments(jobId, videoId, holder, [{ id: segs[1].id, start_sec: 0.5 }])).rejects.toThrow(/overlaps/);
		// moving both neighbours in one save is fine
		await jobs.saveSegments(jobId, videoId, holder, [
			{ id: segs[0].id, end_sec: 1.2 },
			{ id: segs[1].id, start_sec: 1.2 }
		]);
		await expect(jobs.insertSegment(jobId, videoId, holder, 0.5, 1.5)).rejects.toThrow(/overlaps/);
		const added = await jobs.insertSegment(jobId, videoId, holder, 2, 3);
		const b = await jobs.splitSegment(jobId, videoId, holder, segs[0].id, 0.6);
		segs = await jobs.loadSegments(videoId);
		expect(segs.map((x) => [Number(x.start_sec), Number(x.end_sec)])).toEqual([
			[0, 0.6],
			[0.6, 1.2],
			[1.2, 2],
			[2, 3]
		]);
		await jobs.mergeWithNext(jobId, videoId, holder, segs[0].id);
		await jobs.deleteSegment(jobId, videoId, holder, added);
		segs = await jobs.loadSegments(videoId);
		expect(segs).toHaveLength(2);
		expect(Number(segs[0].end_sec)).toBe(1.2);
		expect((await jobs.loadDeletedSegments(videoId)).map((x) => x.id).sort()).toEqual([added, b].sort());
	});

	it('submit -> send back -> submit -> approve', async () => {
		const holder = (await jobs.loadJob(jobId))!.job.assigned_to!;
		await jobs.submitJob(jobId, videoId, holder, null);
		expect((await jobs.loadJob(jobId))!.job.status).toBe('submitted');

		await jobs.returnJob(jobId, videoId, adminId, 'fix line 2');
		const back = (await jobs.loadJob(jobId))!.job;
		expect(back.status).toBe('assigned');
		expect(back.assigned_to).toBe(holder);
		expect(jobs.holds(back, holder)).toBe(true);

		await jobs.submitJob(jobId, videoId, holder, 'done');
		await jobs.approveJob(jobId, adminId, null);
		expect((await jobs.loadJob(jobId))!.job.status).toBe('approved');

		const events = await query<{ action: string }>('SELECT action FROM job_events WHERE job_id = $1 ORDER BY id', [jobId]);
		expect(events.map((e) => e.action)).toEqual(['claimed', 'submitted', 'returned', 'submitted', 'approved']);
	});
});

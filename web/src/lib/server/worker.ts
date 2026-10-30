import { rm } from 'node:fs/promises';
import { query } from './db.ts';
import { sarvamEnabled } from './sarvam.ts';
import { tempPath } from './storage.ts';
import { pollSarvam, processVideo } from './videos.ts';

const TICK_MS = 15_000;
const g = globalThis as unknown as { __dubdeskWorker?: ReturnType<typeof setInterval> };

/**
 * Background chores. Safe with several web instances: each video is leased with
 * FOR UPDATE SKIP LOCKED, so only one instance works on it at a time.
 */
async function tick() {
	if (sarvamEnabled()) {
		const due = await query<{ id: number; sarvam_job_id: string; sarvam_status: string | null }>(
			`UPDATE videos SET next_poll_at = now() + interval '3 minutes'
			  WHERE id IN (SELECT id FROM videos WHERE status = 'dubbing' AND sarvam_job_id IS NOT NULL
			                 AND next_poll_at <= now() ORDER BY next_poll_at LIMIT 5 FOR UPDATE SKIP LOCKED)
			  RETURNING id, sarvam_job_id, sarvam_status`
		);
		for (const v of due) {
			try {
				await pollSarvam(v.id, v.sarvam_job_id, v.sarvam_status);
			} catch (e) {
				console.error(`[worker] Sarvam check for video ${v.id} failed`, e);
				await query(`UPDATE videos SET error = $2, next_poll_at = now() + interval '1 minute' WHERE id = $1`, [
					v.id,
					(e as Error).message.slice(0, 1000)
				]);
			}
		}
	}

	// A file left "processing" by a restart gets processed again.
	const stuck = await query<{ id: number }>(
		`UPDATE videos SET updated_at = now()
		  WHERE id IN (SELECT id FROM videos WHERE status = 'processing' AND updated_at < now() - interval '15 minutes'
		                 LIMIT 3 FOR UPDATE SKIP LOCKED)
		  RETURNING id`
	);
	for (const v of stuck) void processVideo(v.id);

	// Uploads abandoned for a day: drop the half file and its empty video.
	const dead = await query<{ id: string; video_id: number }>(
		`DELETE FROM uploads WHERE finished_at IS NULL AND created_at < now() - interval '1 day' RETURNING id, video_id`
	);
	for (const u of dead) {
		await rm(tempPath(u.id), { force: true });
		await query(`DELETE FROM videos WHERE id = $1 AND status = 'uploading'`, [u.video_id]);
	}
}

export function startWorker() {
	if (g.__dubdeskWorker) return;
	g.__dubdeskWorker = setInterval(() => {
		tick().catch((e) => console.error('[worker] tick failed', e));
	}, TICK_MS);
	g.__dubdeskWorker.unref?.();
}

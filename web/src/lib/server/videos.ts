import { randomBytes } from 'node:crypto';
import { appendFile, rm } from 'node:fs/promises';
import { query, tx } from './db.ts';
import { buildPeaks, probeDuration } from './media.ts';
import { ensureDirFor, moveInto, sizeOf, tempPath, writeStream } from './storage.ts';
import * as sarvam from './sarvam.ts';
import { pairCues, parseSubtitles, type Cue } from '../srt.ts';

export const CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_BYTES = 4 * 1024 * 1024 * 1024;
const VIDEO_TYPES = /^(video\/(mp4|quicktime|x-matroska|webm|x-msvideo|x-flv|x-ms-wmv)|audio\/(wav|x-wav|mpeg|mp4|x-m4a))$/;
const EXT = /\.(mp4|mov|mkv|webm|avi|flv|wmv|wav|mp3|m4a)$/i;

export const sourceKey = (id: number, name: string) => `videos/${id}/source${(name.match(EXT)?.[0] ?? '.mp4').toLowerCase()}`;
export const dubbedKey = (id: number) => `videos/${id}/dubbed.mp4`;
export const peaksKey = (id: number) => `videos/${id}/peaks.bin`;

export function checkUpload(name: string, size: number, mime: string): string | null {
	if (!EXT.test(name)) return 'Use MP4, MOV, MKV, WebM, AVI, FLV, WMV, WAV, MP3 or M4A.';
	if (mime && !VIDEO_TYPES.test(mime) && mime !== 'application/octet-stream') return `File type ${mime} is not supported.`;
	if (!(size > 0) || size > MAX_BYTES) return 'File must be between 1 byte and 4 GB.';
	return null;
}

export async function startUpload(userId: number, title: string, name: string, size: number, mime: string) {
	return tx(async (q) => {
		const [v] = await q<{ id: number }>(
			`INSERT INTO videos (title, original_filename, status, uploaded_by, size_bytes, mime)
			 VALUES ($1, $2, 'uploading', $3, $4, $5) RETURNING id`,
			[title, name, userId, size, mime || 'application/octet-stream']
		);
		const id = randomBytes(16).toString('hex');
		await q(
			`INSERT INTO uploads (id, video_id, user_id, file_name, mime, size_bytes, chunk_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[id, v.id, userId, name, mime || 'application/octet-stream', size, CHUNK_BYTES]
		);
		return { uploadId: id, videoId: v.id, chunkBytes: CHUNK_BYTES };
	});
}

export type UploadRow = { id: string; video_id: number; user_id: number; file_name: string; mime: string; size_bytes: string; received: string; finished_at: Date | null };

export async function getUpload(id: string) {
	const [u] = await query<UploadRow>('SELECT * FROM uploads WHERE id = $1', [id]);
	return u ?? null;
}

/** Append one chunk. Chunks must arrive in order; a resent chunk the server already has is accepted and skipped. */
export async function writeChunk(u: UploadRow, offset: number, bytes: Uint8Array): Promise<number> {
	const received = Number(u.received);
	if (offset + bytes.length <= received) return received; // duplicate after a retry
	if (offset !== received) throw new Error(`expected offset ${received}, got ${offset}`);
	if (received + bytes.length > Number(u.size_bytes)) throw new Error('more bytes than the declared size');
	const tmp = tempPath(u.id);
	await ensureDirFor(`tmp/${u.id}`);
	await appendFile(tmp, bytes);
	const [row] = await query<{ received: string }>(
		'UPDATE uploads SET received = received + $2 WHERE id = $1 AND received = $3 RETURNING received',
		[u.id, bytes.length, received]
	);
	if (!row) throw new Error('chunk raced with another write');
	return Number(row.received);
}

export async function finishUpload(u: UploadRow) {
	if (Number(u.received) !== Number(u.size_bytes)) throw new Error('upload is not complete');
	const key = sourceKey(u.video_id, u.file_name);
	await moveInto(tempPath(u.id), key);
	await query('UPDATE uploads SET finished_at = now() WHERE id = $1', [u.id]);
	await query(`UPDATE videos SET source_key = $2, status = 'processing', updated_at = now() WHERE id = $1`, [u.video_id, key]);
	void processVideo(u.video_id); // probe + waveform in the background
}

export async function cancelUpload(u: UploadRow) {
	await rm(tempPath(u.id), { force: true });
	await query(`DELETE FROM videos WHERE id = $1 AND status = 'uploading'`, [u.video_id]);
}

/** Read the length and build the waveform. Then the video is ready for subtitles or dubbing. */
export async function processVideo(videoId: number) {
	try {
		const [v] = await query<{ source_key: string }>('SELECT source_key FROM videos WHERE id = $1', [videoId]);
		const duration = await probeDuration(v.source_key);
		await buildPeaks(v.source_key, peaksKey(videoId));
		const [{ n }] = await query<{ n: number }>('SELECT COUNT(*)::int AS n FROM segments WHERE video_id = $1 AND deleted_at IS NULL', [videoId]);
		await query(
			`UPDATE videos SET duration_sec = $2, peaks_key = $3, size_bytes = COALESCE(size_bytes, $4), error = NULL,
			        status = CASE WHEN $5 > 0 THEN 'ready_for_review' ELSE 'uploaded' END, updated_at = now()
			  WHERE id = $1`,
			[videoId, duration, peaksKey(videoId), await sizeOf(v.source_key), n]
		);
		if (n > 0) await ensureJob(videoId, null);
	} catch (e) {
		console.error(`[video ${videoId}] processing failed`, e);
		await query(`UPDATE videos SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [
			videoId,
			(e as Error).message.slice(0, 1000)
		]);
	}
}

/** Create the round-1 review job if the video has none yet. */
async function ensureJob(videoId: number, userId: number | null) {
	await tx(async (q) => {
		const [j] = await q<{ id: number }>(
			`INSERT INTO jobs (video_id, round, status) VALUES ($1, 1, 'queued') ON CONFLICT (video_id, round) DO NOTHING RETURNING id`,
			[videoId]
		);
		if (j) await q(`INSERT INTO job_events (job_id, user_id, action) VALUES ($1, $2, 'created')`, [j.id, userId]);
	});
}

/**
 * Replace a video's lines with English/Hindi subtitles. Allowed only before review starts,
 * so a reviewer's work is never overwritten.
 */
export async function importSubtitles(videoId: number, userId: number | null, enText: string | null, hiText: string | null) {
	const en: Cue[] = enText ? parseSubtitles(enText) : [];
	const hi: Cue[] = hiText ? parseSubtitles(hiText) : [];
	if (!en.length && !hi.length) throw new Error('No subtitle lines found in the file(s).');
	const pairs = pairCues(en, hi);

	await tx(async (q) => {
		const [busy] = await q<{ n: number }>(
			`SELECT COUNT(*)::int AS n FROM jobs WHERE video_id = $1 AND status NOT IN ('queued')`,
			[videoId]
		);
		if (busy.n > 0) throw new Error('Review has already started on this video; lines can no longer be replaced.');
		await q('DELETE FROM segments WHERE video_id = $1', [videoId]);
		for (let i = 0; i < pairs.length; i += 500) {
			const slice = pairs.slice(i, i + 500);
			const params: unknown[] = [];
			const rows = slice.map((p, k) => {
				params.push(videoId, `srt-${i + k + 1}`, p.start, p.end, p.en, p.hi);
				const b = k * 6;
				return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 6}, $${b + 3}, $${b + 4})`;
			});
			await q(
				`INSERT INTO segments (video_id, el_segment_id, start_sec, end_sec, en_text, hi_text_original, hi_text, start_sec_original, end_sec_original)
				 VALUES ${rows.join(', ')}`,
				params
			);
		}
		// A processed file becomes reviewable now; one still processing becomes reviewable when processing ends.
		await q(
			`UPDATE videos SET status = 'ready_for_review', updated_at = now() WHERE id = $1 AND status IN ('uploaded', 'ready_for_review')`,
			[videoId]
		);
	});
	const [v] = await query<{ status: string }>('SELECT status FROM videos WHERE id = $1', [videoId]);
	if (v.status === 'ready_for_review') await ensureJob(videoId, userId);
	return pairs.length;
}

// ---------------- Sarvam ----------------

export async function sendToSarvam(videoId: number) {
	if (!sarvam.sarvamEnabled()) throw new Error('Sarvam is not connected yet (SARVAM_API_KEY is not set).');
	const [v] = await query<{ title: string; source_key: string; mime: string; size_bytes: string; status: string }>(
		'SELECT title, source_key, mime, size_bytes, status FROM videos WHERE id = $1',
		[videoId]
	);
	if (!v?.source_key) throw new Error('This video has no uploaded file.');
	if (!['uploaded', 'failed'].includes(v.status)) throw new Error(`Cannot send a video that is "${v.status}".`);
	const job = await sarvam.createDubJob(v.title);
	await query(`UPDATE videos SET sarvam_job_id = $2, sarvam_status = 'uploading', status = 'dubbing', error = NULL, updated_at = now() WHERE id = $1`, [
		videoId,
		job.job_id
	]);
	try {
		await sarvam.uploadSource(job.upload_url, v.source_key, v.mime, Number(v.size_bytes));
		await sarvam.startJob(job.job_id);
		await query(`UPDATE videos SET sarvam_status = 'queued', next_poll_at = now() + interval '20 seconds' WHERE id = $1`, [videoId]);
	} catch (e) {
		await query(`UPDATE videos SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`, [videoId, (e as Error).message]);
		throw e;
	}
}

/** One check of one dubbing video. Called by the background worker. */
export async function pollSarvam(videoId: number, jobId: string, sarvamStatus: string | null) {
	const later = (s: number) => query(`UPDATE videos SET next_poll_at = now() + make_interval(secs => $2) WHERE id = $1`, [videoId, s]);

	if (sarvamStatus !== 'exporting') {
		const st = await sarvam.liveStatus(jobId);
		await query(`UPDATE videos SET sarvam_status = $2, sarvam_progress = $3, updated_at = now() WHERE id = $1`, [
			videoId,
			st.status,
			Math.round(Number(st.progress ?? 0))
		]);
		if (st.status === 'failed' || st.status === 'deleted') {
			await query(`UPDATE videos SET status = 'failed', error = $2 WHERE id = $1`, [videoId, st.error_message ?? `Sarvam job ${st.status}`]);
			return;
		}
		if (st.status !== 'completed' && st.status !== 'partial_failure') return later(30);
		// Editor Flow does not export by itself.
		await sarvam.exportAll(jobId);
		await query(`UPDATE videos SET sarvam_status = 'exporting' WHERE id = $1`, [videoId]);
		return later(20);
	}

	const entries = await sarvam.exportStatus(jobId);
	const pick = (lang: string, fmt: string) =>
		entries.find((e) => sarvam.entryLang(e) === lang && sarvam.entryFormat(e) === fmt && e.download_url && !e.is_stale);
	const video = pick(sarvam.TARGET_LANG, 'video');
	const hiSrt = pick(sarvam.TARGET_LANG, 'srt');
	if (!video || !hiSrt) return later(20);

	const vres = await fetch(video.download_url!, { signal: AbortSignal.timeout(60 * 60_000) });
	if (!vres.ok || !vres.body) throw new Error(`Downloading the dubbed video failed: ${vres.status}`);
	await writeStream(dubbedKey(videoId), vres.body);
	const hiText = await (await fetch(hiSrt.download_url!)).text();
	const enEntry = pick(sarvam.SRC_LANG, 'srt');
	const enText = enEntry ? await (await fetch(enEntry.download_url!)).text() : null;

	await query(`UPDATE videos SET dubbed_key = $2, sarvam_status = 'exported', next_poll_at = NULL WHERE id = $1`, [videoId, dubbedKey(videoId)]);
	await query(`UPDATE videos SET status = 'uploaded' WHERE id = $1 AND status = 'dubbing'`, [videoId]);
	await importSubtitles(videoId, null, enText, hiText);
}

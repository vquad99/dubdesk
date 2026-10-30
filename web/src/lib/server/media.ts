import { spawn, execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import { ensureDirFor, pathFor } from './storage.ts';

const run = promisify(execFile);

/** Waveform resolution: min/max pairs per second of audio. 100/s = 10 ms, enough for frame-level edits. */
export const PEAKS_PER_SECOND = 100;
const RATE = 8000;

export async function probeDuration(key: string): Promise<number | null> {
	const { stdout } = await run(ffprobe.path, [
		'-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', pathFor(key)
	]);
	const n = Number(stdout.trim());
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Decode the audio once and keep only min/max per 10 ms as signed bytes.
 * File layout: "PK01", uint32 peaks-per-second, then [min, max] int8 pairs.
 * One hour of audio becomes ~720 KB, small enough to send to the browser whole.
 */
export async function buildPeaks(srcKey: string, outKey: string): Promise<number> {
	if (!ffmpegPath) throw new Error('ffmpeg is not available');
	const per = RATE / PEAKS_PER_SECOND;
	const pairs: number[] = [];
	let lo = 32767;
	let hi = -32768;
	let n = 0;
	let carry: Buffer | null = null;

	await new Promise<void>((ok, bad) => {
		const p = spawn(ffmpegPath as string, ['-v', 'error', '-i', pathFor(srcKey), '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', 'pipe:1']);
		let err = '';
		p.stderr.on('data', (d) => (err += d));
		p.stdout.on('data', (chunk: Buffer) => {
			const buf: Buffer = carry ? Buffer.concat([carry, chunk]) : chunk;
			const usable = buf.length - (buf.length % 2);
			for (let i = 0; i < usable; i += 2) {
				const s = buf.readInt16LE(i);
				if (s < lo) lo = s;
				if (s > hi) hi = s;
				if (++n === per) {
					pairs.push(lo >> 8, hi >> 8);
					lo = 32767;
					hi = -32768;
					n = 0;
				}
			}
			carry = usable < buf.length ? buf.subarray(usable) : null;
		});
		p.on('error', bad);
		p.on('close', (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg failed: ${err.slice(0, 300)}`))));
	});
	if (n > 0) pairs.push(lo >> 8, hi >> 8);

	const head = Buffer.alloc(8);
	head.write('PK01', 0, 'ascii');
	head.writeUInt32LE(PEAKS_PER_SECOND, 4);
	await ensureDirFor(outKey);
	await writeFile(pathFor(outKey), Buffer.concat([head, Buffer.from(Int8Array.from(pairs).buffer)]));
	return pairs.length / 2;
}

// ---------------- efficient copies for streaming ----------------

type Probe = { vcodec?: string; acodec?: string; width?: number; height?: number; bitrate?: number };

export async function probe(key: string): Promise<Probe> {
	const { stdout } = await run(ffprobe.path, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=bit_rate', '-of', 'json', pathFor(key)]);
	const j = JSON.parse(stdout) as { streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format?: { bit_rate?: string } };
	const v = j.streams?.find((s) => s.codec_type === 'video');
	const a = j.streams?.find((s) => s.codec_type === 'audio');
	return { vcodec: v?.codec_name, acodec: a?.codec_name, width: v?.width, height: v?.height, bitrate: Number(j.format?.bit_rate) || undefined };
}

function ff(args: string[]): Promise<void> {
	return new Promise((ok, bad) => {
		const p = spawn(ffmpegPath as string, ['-v', 'error', '-y', ...args]);
		let err = '';
		p.stderr.on('data', (d) => (err += d));
		p.on('error', bad);
		p.on('close', (code) => (code === 0 ? ok() : bad(new Error(`ffmpeg: ${err.slice(-400)}`))));
	});
}

/** Above this the upload is heavier than it needs to be for review at full resolution. */
const LEAN_BITRATE = 4_500_000;

/**
 * A copy that starts playing at once (index at the front, "faststart") and is no heavier than
 * needed. An upload that is already H.264/AAC at a sensible bitrate is only re-packed, with no
 * quality change. Anything else is re-encoded at the SAME resolution (capped at 1080p) with
 * near-transparent settings, and kept only if it really is smaller.
 * Returns the bytes of the copy used.
 */
export async function makeWebCopy(srcKey: string, outKey: string): Promise<{ mode: 'repack' | 'encode'; bytes: number }> {
	const info = await probe(srcKey);
	await ensureDirFor(outKey);
	const src = pathFor(srcKey);
	const out = pathFor(outKey);
	const browserReady = info.vcodec === 'h264' && (!info.acodec || info.acodec === 'aac');
	const heavy = (info.bitrate ?? 0) > LEAN_BITRATE || (info.height ?? 0) > 1080;

	if (browserReady && !heavy) {
		await ff(['-i', src, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', out]);
		return { mode: 'repack', bytes: (await stat(out)).size };
	}
	await ff([
		'-i', src, '-map', '0:v:0', '-map', '0:a?',
		'-c:v', 'libx264', '-preset', process.env.MEDIA_PRESET ?? 'veryfast', '-crf', '22', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
		'-vf', "scale='min(1920,iw)':-2",
		'-c:a', 'aac', '-b:a', '128k',
		'-movflags', '+faststart', out
	]);
	const bytes = (await stat(out)).size;
	const srcBytes = (await stat(src)).size;
	if (browserReady && bytes >= srcBytes) {
		// Re-encoding did not save anything: fall back to the lossless re-pack.
		await ff(['-i', src, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', out]);
		return { mode: 'repack', bytes: (await stat(out)).size };
	}
	return { mode: 'encode', bytes };
}

/**
 * Sound only, for listening without the picture (about a tenth of the data of the video).
 * AAC sound is copied as is (no quality change); other formats become AAC 128 kbps.
 */
export async function makeAudioCopy(srcKey: string, outKey: string): Promise<number> {
	const info = await probe(srcKey);
	if (!info.acodec) throw new Error('the file has no sound track');
	await ensureDirFor(outKey);
	const codec = info.acodec === 'aac' ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '128k'];
	await ff(['-i', pathFor(srcKey), '-vn', '-map', '0:a:0', ...codec, '-movflags', '+faststart', pathFor(outKey)]);
	return (await stat(pathFor(outKey))).size;
}

/** The waveform, gzip-compressed once (about 3-5x smaller to send). */
export async function gzipFile(key: string): Promise<void> {
	const data = await readFile(pathFor(key));
	await writeFile(pathFor(key + '.gz'), gzipSync(data, { level: 9 }));
}

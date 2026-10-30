import { spawn, execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
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

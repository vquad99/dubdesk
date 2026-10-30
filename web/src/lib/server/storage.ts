import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

/**
 * Media files live under MEDIA_DIR (a Render persistent disk in production).
 * Keys are relative paths like "videos/12/source.mp4". Swap this module for S3
 * when running more than one web instance.
 */
const ROOT = resolve(process.env.MEDIA_DIR ?? join(process.cwd(), '..', 'data', 'media'));

export function pathFor(key: string): string {
	const full = resolve(ROOT, key);
	if (full !== ROOT && !full.startsWith(ROOT + sep)) throw new Error(`bad media key: ${key}`);
	return full;
}

export async function ensureDirFor(key: string) {
	await mkdir(dirname(pathFor(key)), { recursive: true });
}

export async function sizeOf(key: string): Promise<number | null> {
	try {
		return (await stat(pathFor(key))).size;
	} catch {
		return null;
	}
}

export async function moveInto(src: string, key: string) {
	await ensureDirFor(key);
	await rename(src, pathFor(key));
}

export async function remove(key: string) {
	await rm(pathFor(key), { force: true });
}

export const tempPath = (name: string) => pathFor(join('tmp', name));

export async function writeStream(key: string, body: ReadableStream<Uint8Array>) {
	await ensureDirFor(key);
	await new Promise<void>((ok, bad) => {
		const out = createWriteStream(pathFor(key));
		Readable.fromWeb(body as never)
			.on('error', bad)
			.pipe(out)
			.on('finish', ok)
			.on('error', bad);
	});
}

/** A Response for a stored file, honouring Range so video can seek without downloading it all. */
export async function serve(key: string, mime: string, range: string | null, download?: string): Promise<Response> {
	const size = await sizeOf(key);
	if (size === null) return new Response('Not found', { status: 404 });
	const headers: Record<string, string> = {
		'Content-Type': mime,
		'Accept-Ranges': 'bytes',
		'Cache-Control': 'private, max-age=3600'
	};
	if (download) headers['Content-Disposition'] = `attachment; filename="${download.replace(/"/g, '')}"`;

	const m = range?.match(/^bytes=(\d*)-(\d*)$/);
	if (m && (m[1] || m[2])) {
		let start = m[1] ? Number(m[1]) : size - Number(m[2]);
		let end = m[1] && m[2] ? Number(m[2]) : size - 1;
		start = Math.max(0, start);
		end = Math.min(size - 1, end);
		if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
		const stream = Readable.toWeb(createReadStream(pathFor(key), { start, end })) as ReadableStream;
		return new Response(stream, {
			status: 206,
			headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
		});
	}
	const stream = Readable.toWeb(createReadStream(pathFor(key))) as ReadableStream;
	return new Response(stream, { headers: { ...headers, 'Content-Length': String(size) } });
}

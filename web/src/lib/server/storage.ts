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

export type ServeOptions = {
	range?: string | null;
	ifNoneMatch?: string | null;
	ifRange?: string | null;
	download?: string;
	encoding?: string; // e.g. 'gzip' when the stored file is already compressed
	maxAge?: number; // seconds the browser may reuse it without asking
};

/**
 * A Response for a stored file. Honours Range (seeking fetches only the part needed),
 * ETag / If-None-Match (a file the browser already has costs a 304, no data), and If-Range.
 */
export async function serve(key: string, mime: string, opts: ServeOptions = {}): Promise<Response> {
	let st;
	try {
		st = await stat(pathFor(key));
	} catch {
		return new Response('Not found', { status: 404 });
	}
	const size = st.size;
	const etag = `"${size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
	const headers: Record<string, string> = {
		'Content-Type': mime,
		'Accept-Ranges': 'bytes',
		'Cache-Control': `private, max-age=${opts.maxAge ?? 86400}`,
		ETag: etag,
		'Last-Modified': st.mtime.toUTCString()
	};
	if (opts.encoding) headers['Content-Encoding'] = opts.encoding;
	if (opts.download) headers['Content-Disposition'] = `attachment; filename="${opts.download.replace(/"/g, '')}"`;

	if (opts.ifNoneMatch && opts.ifNoneMatch.split(/\s*,\s*/).includes(etag)) {
		return new Response(null, { status: 304, headers });
	}

	const m = opts.range?.match(/^bytes=(\d*)-(\d*)$/);
	const rangeValid = !opts.ifRange || opts.ifRange === etag;
	if (m && (m[1] || m[2]) && rangeValid && !opts.encoding) {
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

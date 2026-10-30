// Sarvam Dubbing API client (Editor Flow). Docs: https://docs.sarvam.ai/api/api-guides-tutorials/dubbing/overview
// Written to the documented contract; exercised for real only once SARVAM_API_KEY is set.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pathFor } from './storage.ts';

const BASE = process.env.SARVAM_BASE_URL ?? 'https://api.sarvam.ai/dubbing';
export const SRC_LANG = 'en-IN';
export const TARGET_LANG = 'hi-IN';

export const sarvamEnabled = () => !!process.env.SARVAM_API_KEY;

/** Link to the job in Sarvam Content Studio, where lines are edited and re-voiced. */
export function studioUrl(jobId: string | null): string | null {
	if (!jobId) return null;
	const tpl = process.env.SARVAM_STUDIO_URL ?? 'https://indus.sarvam.ai/';
	return tpl.includes('{job_id}') ? tpl.replace('{job_id}', encodeURIComponent(jobId)) : tpl;
}

class SarvamError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
	}
}

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown, attempt = 1): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'api-subscription-key': process.env.SARVAM_API_KEY ?? '',
			...(body ? { 'content-type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined,
		signal: AbortSignal.timeout(120_000)
	});
	// 429 / 503: Sarvam asks for a retry with backoff.
	if ((res.status === 429 || res.status === 503) && attempt < 5) {
		const wait = Number(res.headers.get('retry-after')) * 1000 || 2000 * 2 ** (attempt - 1);
		await new Promise((r) => setTimeout(r, wait));
		return call(method, path, body, attempt + 1);
	}
	const text = await res.text();
	let json: Record<string, unknown> = {};
	try {
		json = text ? JSON.parse(text) : {};
	} catch {
		/* non-JSON error page */
	}
	if (!res.ok) {
		const err = (json.error as { message?: string; code?: string }) ?? {};
		throw new SarvamError(`Sarvam ${res.status}: ${err.code ?? ''} ${err.message ?? text.slice(0, 200)}`.trim(), res.status);
	}
	return ((json.data as T) ?? json) as T;
}

export async function createDubJob(name: string) {
	return call<{ job_id: string; upload_url: string }>('POST', '/jobs', {
		job_name: name.slice(0, 200),
		src_lang: SRC_LANG,
		target_langs: [TARGET_LANG],
		export_options: ['video', 'audio', 'srt'],
		editor_flow: true,
		voice_cloning: true,
		num_speakers: Number(process.env.SARVAM_NUM_SPEAKERS ?? 1)
	});
}

/** PUT the source file to Sarvam's signed upload link. The link carries its own auth: never send the key. */
export async function uploadSource(uploadUrl: string, key: string, mime: string, size: number) {
	const res = await fetch(uploadUrl, {
		method: 'PUT',
		headers: { 'Content-Type': mime, 'x-ms-blob-type': 'BlockBlob', 'Content-Length': String(size) },
		body: Readable.toWeb(createReadStream(pathFor(key))) as ReadableStream,
		// @ts-expect-error Node fetch needs this for a streamed body
		duplex: 'half',
		signal: AbortSignal.timeout(60 * 60_000)
	});
	if (!res.ok) throw new Error(`Upload to Sarvam failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export const startJob = (id: string) => call('POST', `/jobs/${encodeURIComponent(id)}/start`);

export type LiveStatus = { status: string; progress?: number; current_step_label?: string; error_message?: string };
export const liveStatus = (id: string) => call<LiveStatus>('GET', `/jobs/${encodeURIComponent(id)}/live-status`);

export const exportAll = (id: string) =>
	call('POST', `/jobs/${encodeURIComponent(id)}/export-all?target_lang=${encodeURIComponent(TARGET_LANG)}`);

export type ExportEntry = {
	language?: string;
	target_lang?: string;
	format?: string;
	export_format?: string;
	status?: string;
	download_url?: string;
	is_stale?: boolean;
};

export async function exportStatus(id: string): Promise<ExportEntry[]> {
	const out = await call<{ exports?: ExportEntry[] } | ExportEntry[]>('GET', `/jobs/${encodeURIComponent(id)}/export-status?limit=100`);
	return Array.isArray(out) ? out : (out.exports ?? []);
}

export const entryLang = (e: ExportEntry) => e.language ?? e.target_lang ?? '';
export const entryFormat = (e: ExportEntry) => (e.format ?? e.export_format ?? '').toLowerCase();

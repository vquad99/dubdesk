// Send one file to the server in parts, carrying on after a dropped connection.
type Start = Record<string, unknown>;

async function api(url: string, init: RequestInit | undefined, signal: AbortSignal) {
	const res = await fetch(url, { ...init, signal });
	if (!res.ok) {
		let msg = res.statusText;
		try {
			msg = (await res.json()).message ?? msg;
		} catch {
			/* plain */
		}
		throw Object.assign(new Error(msg), { status: res.status });
	}
	return res.json();
}

export type Progress = (sent: number, note?: string) => void;

/**
 * POST /api/admin/uploads with `start`, PUT the parts, then complete.
 * `onUploadId` gets the id as soon as it exists, so the caller can cancel it.
 */
export async function uploadFile(
	file: File,
	start: Start,
	signal: AbortSignal,
	onProgress: Progress,
	onUploadId: (id: string) => void = () => {}
): Promise<{ videoId: number; uploadId: string }> {
	const s = await api('/api/admin/uploads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...start, name: file.name, size: file.size, mime: file.type }) }, signal);
	onUploadId(s.uploadId);
	let offset = 0;
	while (offset < file.size) {
		const blob = file.slice(offset, offset + s.chunkBytes);
		for (let attempt = 1; ; attempt++) {
			try {
				offset = (await api(`/api/admin/uploads/${s.uploadId}?offset=${offset}`, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob }, signal)).received;
				break;
			} catch (e) {
				if (signal.aborted) throw e;
				if ((e as { status?: number }).status === 409) {
					// The server has a different count than we think: ask and carry on from there.
					offset = (await api(`/api/admin/uploads/${s.uploadId}`, undefined, signal)).received;
					break;
				}
				if (attempt >= 5) throw e;
				onProgress(offset, `Connection lost — retrying (${attempt}/4)…`);
				await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
			}
		}
		onProgress(offset);
	}
	await api(`/api/admin/uploads/${s.uploadId}/complete`, { method: 'POST' }, signal);
	return { videoId: s.videoId, uploadId: s.uploadId };
}

export async function cancelUploadId(id: string | null) {
	if (id) await fetch(`/api/admin/uploads/${id}`, { method: 'DELETE' }).catch(() => {});
}

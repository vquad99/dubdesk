<script lang="ts">
	import { goto } from '$app/navigation';
	import { UploadCloud, FileVideo, FileText, X } from '@lucide/svelte';
	import Modal from './Modal.svelte';
	import { toast } from '#lib/toast.svelte.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let title = $state('');
	let file = $state<File | null>(null);
	let en = $state<File | null>(null);
	let hi = $state<File | null>(null);
	let busy = $state(false);
	let sent = $state(0);
	let speed = $state(0);
	let phase = $state('');
	let over = $state(false);
	let abort: AbortController | null = null;
	let uploadId: string | null = null;

	const pct = $derived(file ? Math.floor((sent / file.size) * 100) : 0);
	const mb = (n: number) => (n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1);

	function pick(f: File | null | undefined) {
		if (!f) return;
		file = f;
		if (!title) title = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
	}

	async function api(url: string, init?: RequestInit) {
		const res = await fetch(url, { ...init, signal: abort?.signal });
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

	async function putChunk(offset: number, blob: Blob): Promise<number> {
		for (let attempt = 1; ; attempt++) {
			try {
				const out = await api(`/api/admin/uploads/${uploadId}?offset=${offset}`, {
					method: 'PUT',
					headers: { 'content-type': 'application/octet-stream' },
					body: blob
				});
				return out.received;
			} catch (e) {
				if (abort?.signal.aborted) throw e;
				if ((e as { status?: number }).status === 409) {
					// Server has a different count than we think: ask and carry on from there.
					return (await api(`/api/admin/uploads/${uploadId}`)).received;
				}
				if (attempt >= 5) throw e;
				phase = `Connection lost — retrying (${attempt}/4)…`;
				await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
			}
		}
	}

	async function start() {
		if (!file || !title.trim()) return;
		busy = true;
		abort = new AbortController();
		sent = 0;
		try {
			phase = 'Starting…';
			const s = await api('/api/admin/uploads', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ title: title.trim(), name: file.name, size: file.size, mime: file.type })
			});
			uploadId = s.uploadId;
			const t0 = performance.now();
			let offset = 0;
			while (offset < file.size) {
				phase = 'Uploading';
				offset = await putChunk(offset, file.slice(offset, offset + s.chunkBytes));
				sent = offset;
				speed = offset / ((performance.now() - t0) / 1000);
			}
			phase = 'Finishing…';
			await api(`/api/admin/uploads/${uploadId}/complete`, { method: 'POST' });

			if (en || hi) {
				phase = 'Loading subtitles…';
				const fd = new FormData();
				if (en) fd.set('en', en);
				if (hi) fd.set('hi', hi);
				const r = await api(`/api/admin/videos/${s.videoId}/subtitles`, { method: 'POST', body: fd });
				toast(`Uploaded. ${r.lines} lines loaded from subtitles.`);
			} else toast('Uploaded. Reading the audio now.');
			open = false;
			reset();
			await goto(`/admin/tasks/${s.videoId}`);
		} catch (e) {
			if (!abort?.signal.aborted) toast(`Upload failed: ${(e as Error).message}`, 'error', 7000);
		} finally {
			busy = false;
			phase = '';
		}
	}

	async function cancel() {
		abort?.abort();
		if (uploadId) await fetch(`/api/admin/uploads/${uploadId}`, { method: 'DELETE' }).catch(() => {});
		reset();
		busy = false;
		toast('Upload cancelled.', 'info');
	}
	function reset() {
		title = '';
		file = en = hi = null;
		sent = 0;
		uploadId = null;
	}
</script>

<Modal bind:open title="Upload an English video" width={560}>
	{#if !busy}
		<div class="stack">
			<label
				class="drop"
				class:over
				ondragover={(e) => (e.preventDefault(), (over = true))}
				ondragleave={() => (over = false)}
				ondrop={(e) => (e.preventDefault(), (over = false), pick(e.dataTransfer?.files[0]))}
			>
				<input type="file" accept="video/*,audio/*,.mkv,.flv,.wmv" onchange={(e) => pick((e.target as HTMLInputElement).files?.[0])} />
				{#if file}
					<FileVideo size={26} />
					<strong>{file.name}</strong>
					<span class="muted">{mb(file.size)} MB · click to choose another</span>
				{:else}
					<UploadCloud size={28} />
					<strong>Drop a video here, or click to choose</strong>
					<span class="muted">MP4, MOV, MKV, WebM, AVI · up to 4 GB</span>
				{/if}
			</label>
			<label class="field">Title<input bind:value={title} placeholder="e.g. Transmission of Art — part 1" /></label>
			<div class="subs">
				<p class="eyebrow">Subtitles (optional)</p>
				<p class="muted small">Have lines already? Load them now. Otherwise they come from Sarvam after dubbing.</p>
				<div class="two">
					<label class="sub">
						<FileText size={16} />
						<span>{en ? en.name : 'English SRT / VTT'}</span>
						<input type="file" accept=".srt,.vtt" onchange={(e) => (en = (e.target as HTMLInputElement).files?.[0] ?? null)} />
					</label>
					<label class="sub">
						<FileText size={16} />
						<span>{hi ? hi.name : 'Hindi SRT / VTT'}</span>
						<input type="file" accept=".srt,.vtt" onchange={(e) => (hi = (e.target as HTMLInputElement).files?.[0] ?? null)} />
					</label>
				</div>
			</div>
		</div>
	{:else}
		<div class="progressing">
			<div class="row"><strong>{file?.name}</strong><span class="mono">{pct}%</span></div>
			<div class="progress big"><span style:width="{pct}%"></span></div>
			<div class="row muted small">
				<span>{phase}</span>
				<span>{mb(sent)} / {file ? mb(file.size) : 0} MB{speed ? ` · ${mb(speed)} MB/s` : ''}</span>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		{#if busy}
			<button class="ghost" onclick={cancel}><X size={15} /> Cancel upload</button>
		{:else}
			<button class="ghost" onclick={() => (open = false)}>Close</button>
			<button class="primary" disabled={!file || !title.trim()} onclick={start}><UploadCloud size={16} /> Upload</button>
		{/if}
	{/snippet}
</Modal>

<style>
	.stack {
		display: grid;
		gap: 16px;
	}
	.drop {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 6px;
		padding: 30px 16px;
		border-radius: 16px;
		border: 1.5px dashed var(--line-strong);
		background: var(--surface-2);
		text-align: center;
		cursor: pointer;
		transition:
			border-color 0.2s,
			background-color 0.2s;
	}
	.drop:hover,
	.drop.over {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.drop input,
	.sub input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.drop strong {
		font-weight: 500;
		word-break: break-all;
	}
	.drop .muted {
		font-size: 13px;
	}
	.subs {
		display: grid;
		gap: 6px;
	}
	.small {
		font-size: 13px;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin-top: 4px;
	}
	.sub {
		position: relative;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid var(--line);
		font-size: 13px;
		color: var(--text-2);
		cursor: pointer;
		overflow: hidden;
	}
	.sub span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sub:hover {
		border-color: var(--accent-line);
	}
	.progressing {
		display: grid;
		gap: 10px;
		padding: 8px 0 4px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.row strong {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.progress.big {
		height: 10px;
	}
</style>

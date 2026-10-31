<script lang="ts">
	import { goto } from '$app/navigation';
	import { UploadCloud, FileVideo, FileText, X, Sparkles, FileCheck } from '@lucide/svelte';
	import Modal from './Modal.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { cancelUploadId, uploadFile } from '#lib/chunkUpload.ts';

	let { open = $bindable(false), sarvam = false }: { open?: boolean; sarvam?: boolean } = $props();

	let title = $state('');
	let file = $state<File | null>(null);
	let source = $state<'sarvam' | 'manual' | null>(null);
	let en = $state<File | null>(null);
	let hi = $state<File | null>(null);
	let dub = $state<File | null>(null);
	let busy = $state(false);
	let sent = $state(0);
	let speed = $state(0);
	let phase = $state('');
	let over = $state(false);
	let abort: AbortController | null = null;
	let uploadId: string | null = null;

	const total = $derived((file?.size ?? 0) + (source === 'manual' && dub ? dub.size : 0));
	const pct = $derived(total ? Math.floor((sent / total) * 100) : 0);
	const mb = (n: number) => (n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1);
	// Manual needs both transcripts: reviewers read the English and correct the Hindi.
	const ready = $derived(!!file && !!title.trim() && (source === 'sarvam' ? sarvam : source === 'manual' && !!en && !!hi));
	const missing = $derived(
		!file ? 'Choose the video.' : !title.trim() ? 'Give it a title.' : !source ? 'Choose where the lines come from.' : source === 'manual' && (!en || !hi) ? 'Add both the English and the Hindi transcript.' : ''
	);

	function pick(f: File | null | undefined) {
		if (!f) return;
		file = f;
		if (!title) title = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
	}

	async function start() {
		if (!ready || !file) return;
		busy = true;
		abort = new AbortController();
		sent = 0;
		const t0 = performance.now();
		const progress = (base: number) => (n: number, note?: string) => {
			sent = base + n;
			speed = sent / ((performance.now() - t0) / 1000);
			phase = note ?? 'Uploading';
		};
		try {
			phase = 'Starting…';
			const s = await uploadFile(file, { title: title.trim(), lines: source }, abort.signal, progress(0), (id) => (uploadId = id));
			uploadId = null;
			if (source === 'manual') {
				if (dub) {
					phase = 'Uploading the Hindi video…';
					await uploadFile(dub, { dubbedFor: s.videoId }, abort.signal, progress(file.size), (id) => (uploadId = id));
					uploadId = null;
				}
				phase = 'Loading transcripts…';
				const fd = new FormData();
				fd.set('en', en!);
				fd.set('hi', hi!);
				const res = await fetch(`/api/admin/videos/${s.videoId}/subtitles`, { method: 'POST', body: fd });
				const r = await res.json().catch(() => ({}));
				if (!res.ok) throw new Error(`video uploaded, but the transcripts failed: ${r.message ?? res.statusText}. Open the task and load them again.`);
				toast(`Uploaded. ${r.lines} lines loaded; reviewers can pick it up now.`);
			} else toast('Uploaded. It goes to Sarvam as soon as the file is read; the lines arrive after dubbing.');
			open = false;
			reset();
			await goto(`/admin/tasks/${s.videoId}`);
		} catch (e) {
			if (!abort?.signal.aborted) toast(`Upload failed: ${(e as Error).message}`, 'error', 9000);
		} finally {
			busy = false;
			phase = '';
		}
	}

	async function cancel() {
		abort?.abort();
		await cancelUploadId(uploadId);
		reset();
		busy = false;
		toast('Upload cancelled.', 'info');
	}
	function reset() {
		title = '';
		file = en = hi = dub = null;
		source = null;
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
				<p class="eyebrow">Where do the lines come from? <span class="req">required</span></p>
				<div class="choices" role="radiogroup" aria-label="Where the lines come from">
					<button type="button" role="radio" aria-checked={source === 'sarvam'} class="choice" class:on={source === 'sarvam'} disabled={!sarvam} onclick={() => (source = 'sarvam')}>
						<Sparkles size={18} />
						<strong>Sarvam dubs it</strong>
						<span>Sarvam makes the Hindi video and both transcripts. Reviewers get it when dubbing ends.</span>
						{#if !sarvam}<em>Sarvam is not connected yet (no key added).</em>{/if}
					</button>
					<button type="button" role="radio" aria-checked={source === 'manual'} class="choice" class:on={source === 'manual'} onclick={() => (source = 'manual')}>
						<FileCheck size={18} />
						<strong>I have the transcripts</strong>
						<span>Load English and Hindi SRT/VTT now. Reviewers can pick it up straight away.</span>
					</button>
				</div>
				{#if source === 'manual'}
					<div class="two">
						<label class="sub" class:got={en}>
							<FileText size={16} />
							<span>{en ? en.name : 'English SRT / VTT *'}</span>
							<input type="file" accept=".srt,.vtt" onchange={(e) => (en = (e.target as HTMLInputElement).files?.[0] ?? null)} />
						</label>
						<label class="sub" class:got={hi}>
							<FileText size={16} />
							<span>{hi ? hi.name : 'Hindi SRT / VTT *'}</span>
							<input type="file" accept=".srt,.vtt" onchange={(e) => (hi = (e.target as HTMLInputElement).files?.[0] ?? null)} />
						</label>
						<label class="sub wide" class:got={dub}>
							<FileVideo size={16} />
							<span>{dub ? dub.name : 'Hindi (dubbed) video, MP4 — optional, so both videos play'}</span>
							<input type="file" accept=".mp4,video/mp4" onchange={(e) => (dub = (e.target as HTMLInputElement).files?.[0] ?? null)} />
						</label>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div class="progressing">
			<div class="row"><strong>{file?.name}{source === 'manual' && dub ? ` + ${dub.name}` : ''}</strong><span class="mono">{pct}%</span></div>
			<div class="progress big"><span style:width="{pct}%"></span></div>
			<div class="row muted small">
				<span>{phase}</span>
				<span>{mb(sent)} / {mb(total)} MB{speed ? ` · ${mb(speed)} MB/s` : ''}</span>
			</div>
		</div>
	{/if}
	{#snippet footer()}
		{#if busy}
			<button class="ghost" onclick={cancel}><X size={15} /> Cancel upload</button>
		{:else}
			<button class="ghost" onclick={() => (open = false)}>Close</button>
			{#if missing}<span class="muted small hint">{missing}</span>{/if}
			<button class="primary" disabled={!ready} onclick={start}><UploadCloud size={16} /> Upload</button>
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
	.sub.wide {
		grid-column: 1 / -1;
	}
	.sub.got {
		border-color: var(--accent-line);
		background: var(--accent-soft);
		color: var(--text);
	}
	.req {
		margin-left: 6px;
		color: var(--danger, #c0392b);
		text-transform: none;
		letter-spacing: 0;
	}
	.choices {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.choice {
		display: grid;
		justify-items: start;
		align-content: start;
		gap: 4px;
		padding: 14px;
		height: auto;
		border-radius: 14px;
		border: 1.5px solid var(--line);
		background: var(--panel);
		text-align: left;
		white-space: normal;
		font-weight: 400;
	}
	.choice strong {
		font-weight: 500;
		font-size: 14.5px;
	}
	.choice span,
	.choice em {
		font-size: 12.5px;
		color: var(--muted);
		line-height: 1.4;
	}
	.choice em {
		font-style: normal;
		color: #a14b00;
	}
	.choice.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.choice:disabled {
		opacity: 0.6;
	}
	.hint {
		margin-right: auto;
		align-self: center;
	}
	@media (max-width: 560px) {
		.choices,
		.two {
			grid-template-columns: 1fr;
		}
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

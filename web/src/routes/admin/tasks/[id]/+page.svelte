<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		ArrowLeft,
		CircleCheck,
		Undo2,
		Unlock,
		RefreshCw,
		MessageSquare,
		Download,
		ExternalLink,
		Send,
		FileText,
		LoaderCircle,
		TriangleAlert
	} from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import Badge from '#lib/components/Badge.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { FLAG_LABEL } from '#lib/status.ts';
	import { ago, clock, duration, when } from '#lib/format.ts';
	import type { PageProps } from './$types';
	import type { SubmitFunction } from '$app/forms';

	let { data }: PageProps = $props();

	let show = $state<'changes' | 'all'>('changes');
	let approveOpen = $state(false);
	let backOpen = $state(false);
	let busy = $state(false);

	type S = (typeof data.segments)[number];
	const moved = (s: S) => s.start_sec_original !== null && (s.start_sec !== s.start_sec_original || s.end_sec !== s.end_sec_original);
	const changed = (s: S) => s.hi_text !== s.hi_text_original || !!s.flag || !!s.comment || moved(s) || s.origin !== 'source';
	const dl = (kind: string) => `/api/operator/videos/${data.task.video_id}/download/${kind}`;
	const working = $derived(['processing', 'dubbing', 'uploading'].includes(data.task.video_status));
	let subsOpen = $state(false);

	// While a file is processing or dubbing, refresh every 10 s so the page moves on by itself.
	onMount(() => {
		const t = setInterval(() => working && invalidateAll(), 10_000);
		return () => clearInterval(t);
	});
	const lines = $derived(show === 'changes' ? data.segments.filter(changed) : data.segments);
	const pct = $derived(data.task.lines ? Math.round((data.task.checked / data.task.lines) * 100) : 0);
	const status = $derived(data.job?.status ?? data.task.video_status);

	const after: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				approveOpen = backOpen = subsOpen = false;
				toast(String(result.data?.message ?? 'Done.'));
			} else if (result.type === 'failure') toast(String(result.data?.error ?? 'Could not do that.'), 'error');
			await update();
		};
	};

	const ACTION_TEXT: Record<string, string> = {
		created: 'Task created',
		claimed: 'Picked up',
		released: 'Given back to queue',
		expired: 'Lock ran out',
		submitted: 'Sent for approval',
		approved: 'Approved',
		returned: 'Sent back to reviewer',
		unlocked: 'Unlocked by admin',
		regenerated: 'Regenerated'
	};
</script>

<a class="back" href="/admin/tasks"><ArrowLeft size={15} /> Tasks</a>

<div class="page-head">
	<div>
		<span class="eyebrow">Task</span>
		<h1>{data.task.title}</h1>
		<div class="meta">
			<Badge {status} />
			<span class="chip">{duration(data.task.duration_sec)}</span>
			<span class="chip">{data.task.lines} lines</span>
			{#if data.task.round}<span class="chip">Round {data.task.round}</span>{/if}
		</div>
	</div>
	<div class="actions">
		{#if status === 'submitted'}
			<button class="danger" onclick={() => (backOpen = true)}><Undo2 size={16} /> Send back</button>
			<button class="primary" onclick={() => (approveOpen = true)}><CircleCheck size={16} /> Approve</button>
		{:else if status === 'assigned'}
			<form method="POST" action="?/unlock" use:enhance={after}>
				<button disabled={busy}><Unlock size={16} /> Take back from reviewer</button>
			</form>
		{:else if status === 'uploaded' || data.task.video_status === 'failed'}
			<button onclick={() => (subsOpen = true)}><FileText size={16} /> Load subtitles</button>
			{#if data.task.source_key}
				<form method="POST" action="?/sarvam" use:enhance={after}>
					<button class="primary" disabled={busy || !data.sarvam} title={data.sarvam ? 'Dub this video with Sarvam (Editor Flow)' : 'Add SARVAM_API_KEY to turn this on'}>
						<Send size={16} /> Send to Sarvam
					</button>
				</form>
			{/if}
		{:else if status === 'queued'}
			<button onclick={() => (subsOpen = true)}><FileText size={16} /> Replace subtitles</button>
		{/if}
		{#if data.studio}
			<a class="btn" href={data.studio} target="_blank" rel="noopener"><ExternalLink size={15} /> Open in Sarvam Studio</a>
		{/if}
	</div>
</div>

<div class="layout">
	<section class="card">
		<div class="card-head">
			<div>
				<h2>Lines</h2>
				<p>Original Hindi on the left, the reviewer's version on the right.</p>
			</div>
			<div class="seg" role="group" aria-label="Show">
				<button class:on={show === 'changes'} onclick={() => (show = 'changes')}>Changes only</button>
				<button class:on={show === 'all'} onclick={() => (show = 'all')}>All lines</button>
			</div>
		</div>

		{#if lines.length === 0}
			<EmptyState title="No changes" text="The reviewer has not edited or flagged any line yet." />
		{:else}
			<ol class="lines">
				{#each lines as s (s.id)}
					{@const edited = s.hi_text !== s.hi_text_original}
					<li>
						<div class="top">
							<span class="mono time">{clock(s.start_sec)} – {clock(s.end_sec)}</span>
							{#if s.flag}<Badge label={FLAG_LABEL[s.flag]} tone="danger" />{/if}
							{#if s.origin !== 'source'}<Badge label={s.origin === 'inserted' ? 'New line' : s.origin === 'split' ? 'Split off' : 'Joined'} tone="info" />{/if}
							{#if moved(s)}<Badge label="Timing {clock(s.start_sec_original ?? 0)}–{clock(s.end_sec_original ?? 0)} → {clock(s.start_sec)}–{clock(s.end_sec)}" tone="warn" />{/if}
							{#if edited}<Badge label="Edited" tone="warn" />{/if}
							{#if s.reviewed_at}<Badge label="Checked" tone="ok" />{/if}
						</div>
						<p class="en">{s.en_text}</p>
						{#if edited && !s.hi_text_original}
							<p class="hi added" lang="hi">{s.hi_text || '(empty)'}</p>
						{:else if edited}
							<div class="diff">
								<p class="old" lang="hi">{s.hi_text_original}</p>
								<p class="new" lang="hi">{s.hi_text}</p>
							</div>
						{:else}
							<p class="hi" lang="hi">{s.hi_text}</p>
						{/if}
						{#if s.comment}<p class="comment"><MessageSquare size={14} /> {s.comment}</p>{/if}
					</li>
				{/each}
			</ol>
		{/if}
		{#if data.deleted.length}
			<div class="removed">
				<p class="eyebrow">Removed by reviewer · {data.deleted.length}</p>
				{#each data.deleted as s (s.id)}
					<p><span class="mono time">{clock(s.start_sec)} – {clock(s.end_sec)}</span> <span class="gone" lang="hi">{s.hi_text || '(empty)'}</span></p>
				{/each}
			</div>
		{/if}
	</section>

	<aside class="side">
		<section class="card card-pad">
			<h2>Video</h2>
			{#if data.task.video_status === 'failed' && data.task.error}
				<p class="err"><TriangleAlert size={15} /> {data.task.error}</p>
				{#if data.task.source_key}
					<form method="POST" action="?/reprocess" use:enhance={after}><button class="sm" disabled={busy}><RefreshCw size={14} /> Try again</button></form>
				{/if}
			{/if}
			<dl>
				<dt>File</dt>
				<dd class="file">{data.task.original_filename}{data.task.size_bytes ? ` · ${(Number(data.task.size_bytes) / 1048576).toFixed(1)} MB` : ''}</dd>
				<dt>Stage</dt>
				<dd>
					{#if working}<LoaderCircle size={13} class="spin" />{/if}
					{data.task.video_status === 'processing'
						? 'Reading audio and building the waveform'
						: data.task.video_status === 'dubbing'
							? `Sarvam: ${data.task.sarvam_status ?? 'starting'}${data.task.sarvam_progress ? ` · ${data.task.sarvam_progress}%` : ''}`
							: data.task.video_status === 'uploaded'
								? data.sarvam
									? 'Ready to send to Sarvam'
									: 'Waiting for dub (Sarvam not connected yet — load subtitles to review now)'
								: data.task.video_status.replaceAll('_', ' ')}
				</dd>
				<dt>Waveform</dt>
				<dd>{data.task.peaks_key ? 'Ready' : 'Not yet'}</dd>
			</dl>
			<div class="downloads">
				<p class="eyebrow">Downloads</p>
				<a class="btn btn-sm" aria-disabled={!data.task.dubbed_key} href={dl('dubbed')}><Download size={14} /> Hindi video</a>
				<a class="btn btn-sm" aria-disabled={!data.task.lines} href={dl('hi-srt')}><Download size={14} /> Hindi SRT</a>
				<a class="btn btn-sm" aria-disabled={!data.task.lines} href={dl('en-srt')}><Download size={14} /> English SRT</a>
				<a class="btn btn-sm" aria-disabled={!data.task.lines} href={dl('lines-csv')}><Download size={14} /> All lines (CSV)</a>
			</div>
		</section>
		<section class="card card-pad">
			<h2>Review</h2>
			<dl>
				<dt>Reviewer</dt>
				<dd>{data.task.reviewer ?? 'Not taken'}</dd>
				<dt>Lines checked</dt>
				<dd>
					<div class="progress"><span style:width="{pct}%"></span></div>
					<span class="muted small">{data.task.checked} of {data.task.lines}</span>
				</dd>
				<dt>Edited · Flagged</dt>
				<dd>{data.task.edited} · {data.task.flagged}</dd>
				{#if status === 'assigned' && data.task.locked_until}
					<dt>Lock ends</dt>
					<dd>{ago(data.task.locked_until)}</dd>
				{/if}
				{#if data.job?.admin_note}
					<dt>Last admin note</dt>
					<dd class="note">“{data.job.admin_note}”</dd>
				{/if}
			</dl>
		</section>

		<section class="card card-pad">
			<h2>History</h2>
			{#if data.events.length === 0}
				<p class="muted small">No activity yet.</p>
			{:else}
				<ol class="history">
					{#each data.events as e, i (i)}
						<li>
							<span class="dot {e.action}"></span>
							<div>
								<p><strong>{ACTION_TEXT[e.action] ?? e.action}</strong>{e.user_name ? ` · ${e.user_name}` : ''}</p>
								{#if e.note}<p class="note">“{e.note}”</p>{/if}
								<span class="faint small">{when(e.created_at)}</span>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</aside>
</div>

<Modal bind:open={subsOpen} title="Load subtitles">
	<form id="subs" method="POST" action="?/subtitles" enctype="multipart/form-data" use:enhance={after} class="subs">
		<p class="muted">Each Hindi line becomes one review line; English text is matched to it by time. Loading replaces the current lines.</p>
		<label class="field">English (SRT or VTT)<input type="file" name="en" accept=".srt,.vtt" /></label>
		<label class="field">Hindi (SRT or VTT)<input type="file" name="hi" accept=".srt,.vtt" /></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (subsOpen = false)}>Cancel</button>
		<button class="primary" form="subs" disabled={busy}><FileText size={15} /> Load</button>
	{/snippet}
</Modal>

<Modal bind:open={approveOpen} title="Approve this job?">
	<form id="approve" method="POST" action="?/approve" use:enhance={after}>
		<p class="muted">{data.task.edited} edited lines will be used when the dub is regenerated.</p>
		<label class="field" style="margin-top:14px">
			Note (optional)
			<textarea name="note" rows="3" placeholder="Anything to remember about this job"></textarea>
		</label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (approveOpen = false)}>Cancel</button>
		<button class="primary" form="approve" disabled={busy}><CircleCheck size={16} /> Approve</button>
	{/snippet}
</Modal>

<Modal bind:open={backOpen} title="Send back to {data.task.reviewer ?? 'reviewer'}">
	<form id="sendback" method="POST" action="?/sendBack" use:enhance={after}>
		<p class="muted">The job opens again on their screen with your note on top.</p>
		<label class="field" style="margin-top:14px">
			What should they fix?
			<textarea name="note" rows="4" required placeholder="e.g. Lines 4 and 9 still sound too formal."></textarea>
		</label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (backOpen = false)}>Cancel</button>
		<button class="primary" form="sendback" disabled={busy}><Undo2 size={16} /> Send back</button>
	{/snippet}
</Modal>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 18px;
		color: var(--muted);
		font-size: 14px;
	}
	.back:hover {
		color: var(--text);
	}
	.meta {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		margin-top: 14px;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 320px;
		gap: 18px;
		align-items: start;
	}
	.seg {
		display: flex;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.seg button {
		min-height: 30px;
		padding: 4px 14px;
		font-size: 13px;
		background: transparent;
		box-shadow: none;
		color: var(--muted);
	}
	.seg button.on {
		background: #fff;
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.lines li {
		padding: 18px 24px;
		border-top: 1px solid var(--line);
		display: grid;
		gap: 8px;
	}
	.top {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.time {
		color: var(--muted);
		font-size: 12px;
		margin-right: 4px;
	}
	.en {
		color: var(--text-2);
		font-size: 14px;
	}
	.hi,
	.diff p {
		font-family: 'Noto Sans Devanagari', var(--font);
		font-size: 15.5px;
		line-height: 1.7;
	}
	.diff {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.diff p {
		padding: 10px 14px;
		border-radius: 12px;
	}
	.old {
		background: #fdf1ee;
		color: #781a11;
		text-decoration: line-through;
		text-decoration-color: rgba(120, 26, 17, 0.35);
	}
	.new {
		background: #f2f8eb;
		color: #263d0e;
	}
	.added {
		padding: 10px 14px;
		border-radius: 12px;
		background: #f2f8eb;
		color: #263d0e;
	}
	.removed {
		padding: 16px 24px 20px;
		border-top: 1px solid var(--line);
		display: grid;
		gap: 8px;
		font-size: 14px;
	}
	.gone {
		background: #fdf1ee;
		color: #781a11;
		text-decoration: line-through;
		padding: 2px 8px;
		border-radius: 6px;
		font-family: 'Noto Sans Devanagari', var(--font);
	}
	.err {
		display: flex;
		gap: 8px;
		margin: 12px 0 8px;
		padding: 10px 12px;
		border-radius: 10px;
		background: #fde7e2;
		color: #781a11;
		font-size: 13.5px;
		word-break: break-word;
	}
	.file {
		word-break: break-all;
	}
	.downloads {
		display: grid;
		gap: 6px;
		margin-top: 18px;
		justify-items: start;
	}
	.subs {
		display: grid;
		gap: 14px;
	}
	.subs input[type='file'] {
		background: var(--surface-2);
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
		vertical-align: -2px;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.comment {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 13.5px;
		color: var(--text-2);
		background: var(--surface-2);
		padding: 8px 12px;
		border-radius: 10px;
	}
	.comment :global(svg) {
		margin-top: 3px;
		flex: none;
	}
	.side {
		display: grid;
		gap: 18px;
		position: sticky;
		top: 24px;
	}
	dl {
		display: grid;
		gap: 4px;
		margin: 16px 0 0;
	}
	dt {
		font-size: 12px;
		color: var(--muted);
		margin-top: 10px;
	}
	dd {
		margin: 0;
		font-size: 14.5px;
	}
	dd .progress {
		margin: 6px 0 4px;
	}
	.small {
		font-size: 12.5px;
	}
	.note {
		font-style: italic;
		color: var(--text-2);
	}
	.history {
		list-style: none;
		margin: 16px 0 0;
		padding: 0;
		display: grid;
		gap: 14px;
		font-size: 14px;
	}
	.history li {
		display: flex;
		gap: 12px;
	}
	.dot {
		flex: none;
		width: 9px;
		height: 9px;
		margin-top: 6px;
		border-radius: 50%;
		background: var(--accent-line);
		box-shadow: 0 0 0 3px var(--accent-soft);
	}
	.dot.approved {
		background: #83c040;
		box-shadow: 0 0 0 3px #e3f1d8;
	}
	.dot.returned {
		background: #c43d2b;
		box-shadow: 0 0 0 3px #fde7e2;
	}
	.dot.submitted {
		background: var(--orange);
		box-shadow: 0 0 0 3px var(--orange-soft);
	}
	@media (max-width: 1080px) {
		.layout {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
		}
		.diff {
			grid-template-columns: 1fr;
		}
	}
</style>

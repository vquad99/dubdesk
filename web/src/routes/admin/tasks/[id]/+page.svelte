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
		TriangleAlert,
		CirclePause,
		CirclePlay,
		UserCheck,
		Eye,
		FileVideo
	} from '@lucide/svelte';
	import VideoPlayer from '#lib/components/VideoPlayer.svelte';
	import { cancelUploadId, uploadFile } from '#lib/chunkUpload.ts';
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
	let holdOpen = $state(false);
	let assignOpen = $state(false);
	let busy = $state(false);

	type S = (typeof data.segments)[number];
	const moved = (s: S) => s.start_sec_original !== null && (s.start_sec !== s.start_sec_original || s.end_sec !== s.end_sec_original);
	const changed = (s: S) => s.hi_text !== s.hi_text_original || !!s.flag || !!s.comment || moved(s) || s.origin !== 'source';
	const dl = (kind: string) => `/api/operator/videos/${data.task.video_id}/download/${kind}`;
	const working = $derived(['processing', 'dubbing', 'uploading'].includes(data.task.video_status));
	let subsOpen = $state(false);

	// Player: English or Hindi video, with the line under the play head in both languages.
	let player = $state<VideoPlayer>();
	let time = $state(0);
	let track = $state<'original' | 'dubbed'>('original');
	const src = $derived(track === 'original' ? (data.task.source_key ? `/api/media/${data.task.video_id}/source` : null) : data.task.dubbed_key ? `/api/media/${data.task.video_id}/dubbed` : null);
	const now = $derived(data.segments.find((x) => time >= Number(x.start_sec) && time < Number(x.end_sec)) ?? null);
	function seek(t: number) {
		player?.seek(t);
		time = t;
	}

	// Optional Hindi video upload (for videos Sarvam did not dub).
	let dub = $state<File | null>(null);
	let dubPct = $state(0);
	let dubBusy = $state(false);
	let dubAbort: AbortController | null = null;
	let dubId: string | null = null;
	async function sendDub() {
		if (!dub) return;
		dubBusy = true;
		dubAbort = new AbortController();
		const size = dub.size;
		try {
			await uploadFile(dub, { dubbedFor: data.task.video_id }, dubAbort.signal, (n) => (dubPct = Math.floor((n / size) * 100)), (id) => (dubId = id));
			dubId = null;
			dub = null;
			toast('Hindi video added.');
			await invalidateAll();
		} catch (e) {
			if (!dubAbort.signal.aborted) toast(`Hindi video upload failed: ${(e as Error).message}`, 'error', 8000);
		} finally {
			dubBusy = false;
			dubPct = 0;
		}
	}
	async function cancelDub() {
		dubAbort?.abort();
		await cancelUploadId(dubId);
		dubId = null;
	}

	// While a file is processing or dubbing, refresh every 10 s so the page moves on by itself.
	onMount(() => {
		const t = setInterval(() => working && invalidateAll(), 10_000);
		return () => clearInterval(t);
	});
	const lines = $derived(show === 'changes' ? data.segments.filter(changed) : data.segments);
	const pct = $derived(data.task.lines ? Math.round((data.task.checked / data.task.lines) * 100) : 0);
	const held = $derived(!!data.job?.held_at);
	const status = $derived(held ? 'on_hold' : (data.job?.status ?? data.task.video_status));
	const canManage = $derived(!!data.job && ['queued', 'assigned', 'returned'].includes(data.job.status));
	const trouble = $derived(data.trouble.people >= 2 || data.trouble.sentBack >= 2);

	const after: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				subsOpen = holdOpen = assignOpen = false;
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
		regenerated: 'Regenerated',
		held: 'Stopped by admin',
		resumed: 'Resumed by admin',
		assigned: 'Assigned by admin'
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
		<div class="people">
			<span><span class="faint">Reviewer</span> <b>{data.task.reviewer ?? 'not taken yet'}</b></span>
			<span><span class="faint">Operator</span>
				{#if data.task.job_status === 'approved' || data.task.job_status === 'done'}<b>{data.task.decided_by ?? '—'}</b> <span class="faint">approved {data.task.decided_at ? when(data.task.decided_at) : ''}</span>
				{:else if data.task.checking}<b>{data.task.checking}</b> <span class="faint">checking now</span>
				{:else if data.task.job_status === 'submitted'}<span class="faint">waiting for a check</span>
				{:else if data.task.sent_back && data.task.decided_by}<b>{data.task.decided_by}</b> <span class="faint">sent it back {data.task.sent_back}×</span>
				{:else}<b>—</b>{/if}
			</span>
		</div>
	</div>
	<div class="actions">
		{#if status === 'submitted'}
			<span class="muted small checking">{data.job?.qa_name && data.job.qa_locked_until && new Date(data.job.qa_locked_until) > new Date() ? `${data.job.qa_name} is checking it` : 'Waiting for an operator to check it'}</span>
			{#if data.job?.qa_by && data.job.qa_locked_until && new Date(data.job.qa_locked_until) > new Date()}
				<form method="POST" action="?/freeCheck" use:enhance={after}><button disabled={busy}><Unlock size={16} /> Free the check</button></form>
			{/if}
		{:else if held}
			<form method="POST" action="?/resume" use:enhance={after}>
				<button disabled={busy}><CirclePlay size={16} /> Resume</button>
			</form>
		{:else if status === 'assigned'}
			<form method="POST" action="?/unlock" use:enhance={after}>
				<button disabled={busy}><Unlock size={16} /> Take back from reviewer</button>
			</form>
		{:else if status === 'uploaded' || data.task.video_status === 'failed'}
			<button onclick={() => (subsOpen = true)}><FileText size={16} /> Load transcripts</button>
			{#if data.task.source_key}
				<form method="POST" action="?/sarvam" use:enhance={after}>
					<button class="primary" disabled={busy || !data.sarvam} title={data.sarvam ? 'Dub this video with Sarvam (Editor Flow)' : 'Add SARVAM_API_KEY to turn this on'}>
						<Send size={16} /> Send to Sarvam
					</button>
				</form>
			{/if}
		{:else if status === 'queued'}
			<button onclick={() => (subsOpen = true)}><FileText size={16} /> Replace transcripts</button>
		{/if}
		{#if canManage}
			{#if !held}<button class="danger" onclick={() => (holdOpen = true)}><CirclePause size={16} /> Stop</button>{/if}
			<button class="primary" onclick={() => (assignOpen = true)}><UserCheck size={16} /> Assign to…</button>
		{/if}
		{#if data.job}
			<a class="btn" href="/review/{data.job.id}"><Eye size={15} /> Open full view</a>
		{/if}
		{#if data.studio}
			<a class="btn" href={data.studio} target="_blank" rel="noopener"><ExternalLink size={15} /> Open in Sarvam Studio</a>
		{/if}
	</div>
</div>

{#if !data.job && data.task.lines === 0 && ['uploaded', 'failed'].includes(data.task.video_status)}
	<div class="alert warn fade-up">
		<TriangleAlert size={18} />
		<div><strong>Reviewers cannot get this video yet: it has no lines.</strong>
			{data.sarvam ? 'Send it to Sarvam, or load the English and Hindi transcripts.' : 'Load the English and Hindi transcripts (Sarvam is not connected yet).'} It goes into the reviewers' queue as soon as it has lines.</div>
	</div>
{:else if held}
	<div class="alert hold fade-up">
		<CirclePause size={18} />
		<div><strong>Stopped{data.job?.held_at ? ` ${ago(data.job.held_at)}` : ''}.</strong> Nobody can pick this video up until you resume it or assign it.
			{#if data.job?.hold_reason}<span class="reason">“{data.job.hold_reason}”</span>{/if}</div>
	</div>
{:else if trouble}
	<div class="alert warn fade-up">
		<TriangleAlert size={18} />
		<div><strong>Trouble video:</strong> given back by {data.trouble.people} {data.trouble.people === 1 ? 'person' : 'people'}{data.trouble.sentBack ? `, sent back ${data.trouble.sentBack} ${data.trouble.sentBack === 1 ? 'time' : 'times'}` : ''}. Stop it, or assign it to someone you trust.</div>
	</div>
{/if}
{#if data.trouble.events.length}
	<section class="card gaveback">
		<h3>Given back / sent back</h3>
		<ul>
			{#each data.trouble.events as e, i (i)}
				<li>
					<span class="who">{e.user_name ?? 'System'}</span>
					<span class="what">{e.action === 'released' ? 'gave it back' : e.action === 'expired' ? 'let the lock run out' : 'sent it back (admin)'}</span>
					{#if e.note}<span class="note">“{e.note}”</span>{/if}
					<span class="faint when">{ago(e.created_at)}</span>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="card watch">
	<div class="player">
		<VideoPlayer
			bind:this={player}
			bind:time
			{src}
			length={Number(data.task.duration_sec ?? 0)}
			watermark={data.user ? `${data.user.email} · DubDesk` : ''}
			emptyText={track === 'dubbed' ? 'No Hindi video yet: it comes from Sarvam, or upload one below.' : 'No English video file yet.'}
		/>
	</div>
	<div class="now">
		<div class="toggle" role="group" aria-label="Which video">
			<button class:on={track === 'original'} onclick={() => (track = 'original')}>English video</button>
			<button class:on={track === 'dubbed'} onclick={() => (track = 'dubbed')} title={data.task.dubbed_key ? '' : 'No Hindi video yet'}>Hindi video{data.task.dubbed_key ? '' : ' (none yet)'}</button>
		</div>
		{#if now}
			<p class="eyebrow">Line at {clock(now.start_sec)}</p>
			<p class="cap en">{now.en_text || '—'}</p>
			<p class="cap hi" lang="hi">{now.hi_text || '—'}</p>
		{:else}
			<p class="muted small">{data.segments.length ? 'Play the video: the English and Hindi line show here.' : 'No lines yet.'}</p>
		{/if}
		{#if !data.task.sarvam_job_id && data.task.source_key}
			<div class="dubup">
				<p class="eyebrow">{data.task.dubbed_key ? 'Replace the Hindi video' : 'Add the Hindi video'}</p>
				{#if dubBusy}
					<div class="progress"><span style:width="{dubPct}%"></span></div>
					<span class="muted small">{dubPct}% · <button class="ghost sm" onclick={cancelDub}>Cancel</button></span>
				{:else}
					<label class="pickdub"><FileVideo size={15} /> <span>{dub ? dub.name : 'Choose an MP4'}</span><input type="file" accept=".mp4,video/mp4" onchange={(e) => (dub = (e.target as HTMLInputElement).files?.[0] ?? null)} /></label>
					{#if dub}<button class="primary sm" onclick={sendDub}>Upload</button>{/if}
				{/if}
			</div>
		{/if}
	</div>
</section>

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
							<button class="mono time seek" title="Play from here" onclick={() => seek(Number(s.start_sec))}>{clock(s.start_sec)} – {clock(s.end_sec)}</button>
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

<Modal bind:open={subsOpen} title="Load transcripts">
	<form id="subs" method="POST" action="?/subtitles" enctype="multipart/form-data" use:enhance={after} class="subs">
		<p class="muted">Each Hindi line becomes one review line; English text is matched to it by time. Loading replaces the current lines, and the video goes into the reviewers' queue.</p>
		<label class="field">English (SRT or VTT)<input type="file" name="en" accept=".srt,.vtt" /></label>
		<label class="field">Hindi (SRT or VTT)<input type="file" name="hi" accept=".srt,.vtt" /></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (subsOpen = false)}>Cancel</button>
		<button class="primary" form="subs" disabled={busy}><FileText size={15} /> Load</button>
	{/snippet}
</Modal>



<Modal bind:open={holdOpen} title="Stop this video?">
	<form id="hold" method="POST" action="?/hold" use:enhance={after} class="stack">
		<p class="muted">Nobody can pick it up until you resume it.{data.job?.status === 'assigned' && data.task.reviewer ? ` ${data.task.reviewer} loses it now; their saved edits stay.` : ''}</p>
		<label class="field">Why <span class="faint">(everyone on the task sees this)</span><textarea name="note" rows="3" required placeholder="e.g. Audio is unclear, waiting for a better source file"></textarea></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (holdOpen = false)}>Cancel</button>
		<button class="danger" form="hold" disabled={busy}><CirclePause size={16} /> Stop</button>
	{/snippet}
</Modal>

<Modal bind:open={assignOpen} title="Assign to a reviewer">
	<form id="assign" method="POST" action="?/assign" use:enhance={after} class="stack">
		<p class="muted">The video goes straight to this person and stays theirs for 4 hours{held ? '; the stop is lifted' : ''}.{data.job?.status === 'assigned' && data.task.reviewer ? ` ${data.task.reviewer} loses it.` : ''}</p>
		<label class="field">Reviewer
			<select name="reviewer" required>
				<option value="">Choose…</option>
				{#each data.reviewers as r (r.id)}
					{@const gaveBack = data.trouble.events.some((e) => e.user_name === r.name && e.action !== 'returned')}
					<option value={r.id}>{r.name}{r.vendor ? ` · ${r.vendor}` : ''}{r.busy ? ' · busy on another job' : ''}{gaveBack ? ' · gave this back before' : ''}</option>
				{/each}
			</select>
		</label>
		<label class="field">Note for them <span class="faint">(optional)</span><textarea name="note" rows="2" placeholder="What to watch out for"></textarea></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (assignOpen = false)}>Cancel</button>
		<button class="primary" form="assign" disabled={busy}><UserCheck size={16} /> Assign</button>
	{/snippet}
</Modal>

<style>
	.watch {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
		gap: 18px;
		padding: 16px;
		margin-bottom: 16px;
	}
	.player {
		min-width: 0;
	}
	.now {
		display: grid;
		align-content: start;
		gap: 8px;
		min-width: 0;
	}
	.toggle {
		display: inline-flex;
		gap: 4px;
		padding: 4px;
		border-radius: 999px;
		background: var(--surface-2);
		justify-self: start;
		margin-bottom: 6px;
	}
	.toggle button {
		height: 30px;
		padding: 0 14px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		font-size: 13px;
	}
	.toggle button.on {
		background: var(--panel);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
	}
	.cap {
		margin: 0;
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--surface-2);
		font-size: 15px;
		line-height: 1.5;
	}
	.cap.hi {
		background: var(--accent-soft);
		font-size: 16px;
	}
	.dubup {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		padding-top: 12px;
		border-top: 1px solid var(--line);
	}
	.dubup .eyebrow {
		flex-basis: 100%;
		margin: 0;
	}
	.dubup .progress {
		flex: 1;
	}
	.pickdub {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 7px 12px;
		border-radius: 10px;
		border: 1px solid var(--line);
		font-size: 13px;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
	}
	.pickdub span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pickdub input {
		position: absolute;
		inset: 0;
		opacity: 0;
		cursor: pointer;
	}
	.seek {
		height: auto;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		cursor: pointer;
		font-weight: 400;
	}
	.seek:hover {
		color: var(--accent);
		text-decoration: underline;
	}
	@media (max-width: 860px) {
		.watch {
			grid-template-columns: 1fr;
		}
	}
	.people {
		display: flex;
		gap: 22px;
		flex-wrap: wrap;
		margin-top: 10px;
		font-size: 14px;
	}
	.people b {
		font-weight: 500;
	}
	.checking {
		align-self: center;
	}
	.alert {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 14px 18px;
		margin-bottom: 16px;
		border-radius: var(--radius);
		font-size: 14px;
		line-height: 1.5;
	}
	.alert :global(svg) {
		flex: none;
		margin-top: 2px;
	}
	.alert.hold {
		background: #fdecec;
		color: #7a1010;
	}
	.alert.warn {
		background: var(--orange-soft);
		color: #7a3a07;
	}
	.alert .reason {
		display: block;
		margin-top: 2px;
		font-style: italic;
	}
	.gaveback {
		padding: 14px 18px;
		margin-bottom: 16px;
	}
	.gaveback h3 {
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 8px;
	}
	.gaveback ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
		font-size: 13.5px;
	}
	.gaveback li {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: baseline;
	}
	.gaveback .who {
		font-weight: 500;
	}
	.gaveback .note {
		color: var(--text-2);
		font-style: italic;
	}
	.gaveback .when {
		margin-left: auto;
		font-size: 12.5px;
	}
	.stack {
		display: grid;
		gap: 14px;
	}
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
		font-family: 'Noto Sans Devanagari Variable', var(--font);
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
		font-family: 'Noto Sans Devanagari Variable', var(--font);
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

<script lang="ts">
	import { Download, Check, ClipboardCheck, ArrowRight, Eye } from '@lucide/svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import { STAGES, stageIndex } from '#lib/status.ts';
	import { ago, duration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const done = $derived(data.tasks.filter((t) => t.video_status === 'done').length);
	const working = $derived(data.tasks.length - done);
	const me = $derived(page.data.user?.id);
	const isOperator = $derived(page.data.user?.role === 'operator');
	onMount(() => {
		if (page.url.searchParams.has('approved')) toast('Approved. The video is finished.');
		if (page.url.searchParams.has('returned')) toast('Sent back to the reviewer with your note.');
	});
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Operator</span>
		<h1>Progress</h1>
		<p class="sub">Every video, from upload to finished Hindi dub.</p>
	</div>
</div>

<section class="card queue">
	<div class="q-head">
		<h2><ClipboardCheck size={18} /> Waiting for your check</h2>
		<span class="muted small">Open one, fix what the reviewer missed, then approve it or send it back.</span>
	</div>
	{#if data.queue.length === 0}
		<p class="muted pad">Nothing to check right now.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Video</th><th>Reviewer</th><th>Lines edited</th><th>Sent</th><th></th></tr></thead>
				<tbody>
					{#each data.queue as q (q.job_id)}
						{@const other = q.qa_active && q.qa_by !== me}
						<tr>
							<td><span class="t">{q.title}</span><span class="muted small">{duration(q.duration_sec)} · round {q.round}</span></td>
							<td>{q.reviewer ?? '—'}</td>
							<td>{q.edited}/{q.lines}</td>
							<td class="faint">{q.submitted_at ? ago(q.submitted_at) : '—'}</td>
							<td class="right">
								{#if other}<span class="muted small">{q.qa_name} is checking</span>
								{:else if isOperator}<a class="btn btn-primary btn-sm" href="/review/{q.job_id}">{q.qa_by === me && q.qa_active ? 'Continue' : 'Check'} <ArrowRight size={14} /></a>
								{:else}<a class="btn btn-sm" href="/review/{q.job_id}">View</a>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="tiles">
	<StatTile label="Videos" value={data.total} />
	<StatTile label="In progress" value={working} />
	<StatTile label="Finished" value={done} hint="ready to download" />
</section>

{#if data.tasks.length === 0}
	<section class="card"><EmptyState title="No videos yet" text="Videos show up here as soon as the admin uploads them." /></section>
{:else}
	<div class="list">
		{#each data.tasks as t (t.video_id)}
			{@const at = stageIndex(t.video_status)}
			<article class="card item">
				<div class="head">
					<div>
						<h3>{t.title}</h3>
						<p class="muted small">{duration(t.duration_sec)} · {t.lines} lines · updated {ago(t.updated_at)}</p>
					</div>
					<Badge status={t.video_status} />
				</div>
				<ol class="stepper">
					{#each STAGES as s, i (s.key)}
						<li class:done={i < at || t.video_status === 'done'} class:now={i === at && t.video_status !== 'done'}>
							<span class="node">{#if i < at || t.video_status === 'done'}<Check size={12} strokeWidth={3} />{/if}</span>
							<span class="lbl">{s.label}</span>
						</li>
					{/each}
				</ol>
				<div class="foot">
					<span class="muted small">{t.reviewer ? `Reviewer: ${t.reviewer}` : 'No reviewer yet'}{(t.job_status === 'approved' || t.job_status === 'done') && t.decided_by ? ` · Approved by ${t.decided_by}` : t.checking ? ` · ${t.checking} is checking` : ''}</span>
					<div class="dls">
						{#if t.job_id}<a class="btn btn-sm" href="/review/{t.job_id}" title="Play the English and Hindi video with both transcripts"><Eye size={14} /> Watch</a>{/if}
						<a class="btn btn-sm" aria-disabled={!t.lines} href="/api/operator/videos/{t.video_id}/download/hi-srt"><Download size={14} /> Hindi SRT</a>
						<a class="btn btn-sm" aria-disabled={!t.lines} href="/api/operator/videos/{t.video_id}/download/lines-csv"><Download size={14} /> Lines CSV</a>
						<a class="btn btn-sm btn-primary" aria-disabled={t.video_status !== 'done' && t.job_status !== 'approved'} href="/api/operator/videos/{t.video_id}/download/dubbed"><Download size={14} /> Hindi video</a>
					</div>
				</div>
			</article>
		{/each}
	</div>
{/if}

<style>
	.queue {
		margin-bottom: 18px;
	}
	.q-head {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		padding: 18px 20px 8px;
	}
	.q-head h2 {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 17px;
		font-weight: 500;
	}
	.queue .t {
		display: block;
		font-weight: 500;
	}
	.queue .right {
		text-align: right;
		white-space: nowrap;
	}
	.pad {
		padding: 0 20px 18px;
		margin: 0;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 14px;
		margin-bottom: 18px;
	}
	.list {
		display: grid;
		gap: 14px;
	}
	.item {
		padding: 22px 24px;
		display: grid;
		gap: 20px;
	}
	.head,
	.foot {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.foot {
		align-items: center;
		flex-wrap: wrap;
	}
	.dls {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	h3 {
		font-size: 16px;
	}
	.small {
		font-size: 13px;
		margin-top: 2px;
	}
	.stepper {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(5, 1fr);
	}
	.stepper li {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--faint);
	}
	.stepper li::before {
		content: '';
		position: absolute;
		top: 10px;
		left: -50%;
		right: 50%;
		height: 2px;
		background: var(--line);
		z-index: 0;
	}
	.stepper li:first-child::before {
		display: none;
	}
	.stepper li.done::before,
	.stepper li.now::before {
		background: linear-gradient(90deg, #81a0e9, var(--accent));
	}
	.node {
		position: relative;
		z-index: 1;
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid var(--line-strong);
		color: #fff;
	}
	.done .node {
		background: var(--accent);
		border-color: var(--accent);
	}
	.now .node {
		border-color: var(--accent);
		box-shadow: 0 0 0 4px var(--accent-soft);
	}
	.done .lbl,
	.now .lbl {
		color: var(--text-2);
	}
	.now .lbl {
		font-weight: 500;
	}
</style>

<script lang="ts">
	import { goto } from '$app/navigation';
	import { Search, Upload, ChevronLeft, ChevronRight, TriangleAlert } from '@lucide/svelte';
	import Badge from '#lib/components/Badge.svelte';
	import UploadDialog from '#lib/components/UploadDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { ago, duration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const TABS = [
		{ key: '', label: 'All' },
		{ key: 'queued', label: 'In queue' },
		{ key: 'assigned', label: 'With reviewer' },
		{ key: 'submitted', label: 'Waiting for check' },
		{ key: 'approved', label: 'Approved' },
		{ key: 'uploaded', label: 'Waiting for dub' },
		{ key: 'trouble', label: 'Given back 2+' },
		{ key: 'on_hold', label: 'Stopped' },
		{ key: 'failed', label: 'Failed' }
	];
	let uploadOpen = $state(false);
	const href = (status: string, q: string, page = 1) => {
		const p = new URLSearchParams();
		if (status) p.set('status', status);
		if (q) p.set('q', q);
		if (page > 1) p.set('page', String(page));
		const s = p.toString();
		return `/admin/tasks${s ? '?' + s : ''}`;
	};
	// svelte-ignore state_referenced_locally
	let q = $state(data.q);
	let timer: ReturnType<typeof setTimeout>;
	function search() {
		clearTimeout(timer);
		timer = setTimeout(() => goto(href(data.status, q), { replace: true, reset: false }), 250);
	}
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Tasks</h1>
		<p class="sub">One video is one review job.</p>
	</div>
	<button class="primary" onclick={() => (uploadOpen = true)}><Upload size={16} /> Upload video</button>
</div>

<UploadDialog bind:open={uploadOpen} />

<section class="card">
	<div class="bar">
		<nav class="tabs" aria-label="Filter by status">
			{#each TABS as t (t.key)}
				<a href={href(t.key, data.q)} class:on={data.status === t.key}>{t.label}</a>
			{/each}
		</nav>
		<label class="search">
			<Search size={15} />
			<input type="search" placeholder="Search title or reviewer" bind:value={q} oninput={search} />
		</label>
	</div>

	{#if data.tasks.length === 0}
		<EmptyState
			title={data.q || data.status ? 'No tasks match' : 'No videos yet'}
			text={data.q || data.status ? 'Try another filter or search.' : 'Uploaded videos appear here once dubbed.'}
		/>
	{:else}
		<div class="table-wrap">
			<table>
				<thead>
					<tr><th>Video</th><th>Status</th><th>Reviewer</th><th>Operator</th><th>Lines checked</th><th>Edits</th><th>Updated</th></tr>
				</thead>
				<tbody>
					{#each data.tasks as t (t.video_id)}
						{@const pct = t.lines ? Math.round((t.checked / t.lines) * 100) : 0}
						<tr class="clickable" onclick={() => goto(`/admin/tasks/${t.video_id}`)}>
							<td>
								<a class="title" href="/admin/tasks/{t.video_id}">{t.title}</a>
								<span class="meta">{duration(t.duration_sec)} · {t.lines} lines{t.round && t.round > 1 ? ` · round ${t.round}` : ''}</span>
							</td>
							<td>
								<Badge status={t.held_at ? 'on_hold' : (t.job_status ?? t.video_status)} />
								{#if t.gave_back >= 2 || t.sent_back >= 2}<span class="trouble" title="Given back by {t.gave_back} people, sent back {t.sent_back} times"><TriangleAlert size={12} /> {t.gave_back} gave back</span>{/if}
							</td>
							<td>
								{#if t.reviewer}
									<span class="person"><span class="avatar sm">{t.reviewer.slice(0, 1)}</span>{t.reviewer}</span>
								{:else}<span class="faint">Not taken</span>{/if}
							</td>
							<td>
								{#if t.job_status === 'approved' || t.job_status === 'done'}<span class="who-op"><b>{t.decided_by ?? '—'}</b><span class="faint">approved {t.decided_at ? ago(t.decided_at) : ''}</span></span>
								{:else if t.checking}<span class="who-op"><b>{t.checking}</b><span class="faint">checking now</span></span>
								{:else if t.job_status === 'submitted'}<span class="faint">waiting for check</span>
								{:else if t.sent_back && t.decided_by}<span class="who-op"><b>{t.decided_by}</b><span class="faint">sent back</span></span>
								{:else}<span class="faint">—</span>{/if}
							</td>
							<td class="check">
								<div class="progress"><span style:width="{pct}%"></span></div>
								<span class="muted">{t.checked}/{t.lines}</span>
							</td>
							<td>
								{#if t.edited || t.flagged}
									<span class="muted">{t.edited} edited{t.flagged ? ` · ${t.flagged} flagged` : ''}</span>
								{:else}<span class="faint">—</span>{/if}
							</td>
							<td class="faint">{ago(t.updated_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if data.total > data.perPage}
			<div class="pager">
				<span class="muted">{(data.page - 1) * data.perPage + 1}–{Math.min(data.total, data.page * data.perPage)} of {data.total}</span>
				<a class="btn btn-sm btn-ghost" aria-disabled={data.page <= 1} href={href(data.status, data.q, data.page - 1)}><ChevronLeft size={15} /> Previous</a>
				<a class="btn btn-sm btn-ghost" aria-disabled={data.page * data.perPage >= data.total} href={href(data.status, data.q, data.page + 1)}>Next <ChevronRight size={15} /></a>
			</div>
		{/if}
	{/if}
</section>

<style>
	.bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding: 16px 20px;
		border-bottom: 1px solid var(--line);
	}
	.who-op {
		display: grid;
		line-height: 1.3;
	}
	.who-op b {
		font-weight: 500;
	}
	.who-op .faint {
		font-size: 12px;
	}
	.trouble {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 4px;
		font-size: 12px;
		color: var(--orange);
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 12px;
		background: var(--surface-2);
		overflow-x: auto;
	}
	.tabs a {
		padding: 6px 14px;
		border-radius: 9px;
		font-size: 13.5px;
		color: var(--muted);
		white-space: nowrap;
		transition:
			background-color 0.2s,
			color 0.2s;
	}
	.tabs a:hover {
		color: var(--text);
	}
	.tabs a.on {
		background: #fff;
		color: var(--text);
		font-weight: 500;
		box-shadow: var(--shadow-1);
	}
	.search {
		position: relative;
		display: flex;
		align-items: center;
		color: var(--muted);
	}
	.search :global(svg) {
		position: absolute;
		left: 12px;
		pointer-events: none;
	}
	.search input {
		padding-left: 36px;
		width: 260px;
		border-radius: 999px;
	}
	.title {
		display: block;
		color: var(--text);
		font-weight: 500;
	}
	.meta {
		font-size: 12.5px;
		color: var(--muted);
	}
	.person {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.avatar.sm {
		width: 24px;
		height: 24px;
		font-size: 11px;
	}
	.check {
		min-width: 140px;
	}
	.check .progress {
		width: 90px;
		display: inline-block;
		vertical-align: middle;
		margin-right: 8px;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		padding: 12px 20px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
	.check span.muted {
		font-size: 12.5px;
	}
</style>

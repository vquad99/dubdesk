<script lang="ts">
	import { ArrowRight, CircleCheck, Hand, Send, Undo2, Unlock, RefreshCw, Plus, LogOut as Release } from '@lucide/svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { ago, plural } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const ACTION = {
		created: { icon: Plus, text: 'added' },
		claimed: { icon: Hand, text: 'picked up' },
		released: { icon: Release, text: 'gave back' },
		expired: { icon: Release, text: 'lock ran out on' },
		submitted: { icon: Send, text: 'sent for approval' },
		approved: { icon: CircleCheck, text: 'approved' },
		returned: { icon: Undo2, text: 'sent back' },
		unlocked: { icon: Unlock, text: 'unlocked' },
		regenerated: { icon: RefreshCw, text: 'regenerated' }
	} as const;

	const editRate = $derived(data.lines.total ? Math.round((data.lines.edited / data.lines.total) * 100) : 0);
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Overview</h1>
		<p class="sub">Where every dub stands, and what needs you.</p>
	</div>
	<a class="btn btn-primary" href="/admin/tasks">All tasks <ArrowRight size={16} /></a>
</div>

<section class="tiles">
	<StatTile label="Videos" value={data.counts.videos} hint="{data.counts.minutes} min of video" href="/admin/tasks" />
	<StatTile label="In queue" value={data.counts.waiting} hint="waiting for a reviewer" href="/admin/tasks?status=queued" />
	<StatTile label="In review" value={data.counts.in_review} hint="with a reviewer now" href="/admin/tasks?status=assigned" />
	<StatTile label="Waiting for check" value={data.counts.submitted} hint="the operators approve or send back" href="/admin/tasks?status=submitted" />
	<StatTile label="Approved" value={data.counts.approved} hint="ready to regenerate" href="/admin/tasks?status=approved" />
</section>

<div class="grid">
	<section class="card">
		<div class="card-head">
			<div>
				<h2>Waiting for your approval</h2>
				<p>Reviewers sent these back. Check the changes, then approve or send back.</p>
			</div>
		</div>
		{#if data.needsYou.length === 0}
			<EmptyState title="Nothing to approve" text="When a reviewer sends a job back it shows up here." />
		{:else}
			<div class="table-wrap">
				<table>
					<thead><tr><th>Video</th><th>Reviewer</th><th>Changes</th><th></th></tr></thead>
					<tbody>
						{#each data.needsYou as t (t.video_id)}
							<tr>
								<td><a class="title" href="/admin/tasks/{t.video_id}">{t.title}</a></td>
								<td>{t.reviewer ?? '—'}</td>
								<td class="muted">{plural(t.edited, 'edit')} · {plural(t.flagged, 'flag')}</td>
								<td class="right"><a class="btn btn-sm" href="/admin/tasks/{t.video_id}">Open</a></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="card">
		<div class="card-head"><h2>Recent activity</h2></div>
		{#if data.activity.length === 0}
			<EmptyState title="No activity yet" />
		{:else}
			<ol class="feed">
				{#each data.activity as a, i (i)}
					{@const A = ACTION[a.action as keyof typeof ACTION] ?? ACTION.created}
					<li>
						<span class="ico"><A.icon size={14} /></span>
						<div>
							<p><strong>{a.user_name ?? 'System'}</strong> {A.text} <a href="/admin/tasks/{a.video_id}">{a.title}</a></p>
							{#if a.note}<p class="note">“{a.note}”</p>{/if}
							<span class="faint">{ago(a.created_at)}</span>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</div>

<div class="grid two">
	<section class="card">
		<div class="card-head"><h2>Reviewers</h2></div>
		{#if data.reviewers.length === 0}
			<EmptyState title="No reviewers yet" text="Add reviewers on the Users page.">
				<a class="btn btn-sm" href="/admin/users">Add a reviewer</a>
			</EmptyState>
		{:else}
			<div class="table-wrap">
				<table>
					<thead><tr><th>Name</th><th>Jobs sent</th><th>Lines edited</th><th>Avg. time</th></tr></thead>
					<tbody>
						{#each data.reviewers as r (r.name)}
							<tr>
								<td><span class="person"><span class="avatar">{r.name.slice(0, 1)}</span>{r.name}</span></td>
								<td>{r.submitted}</td>
								<td>{r.lines_edited}</td>
								<td class="muted">{r.avg_minutes === null ? '—' : `${r.avg_minutes} min`}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<section class="card card-pad quality">
		<h2>Dub quality</h2>
		<p class="muted small">Share of lines a reviewer had to change.</p>
		<div class="big">{editRate}<span>%</span></div>
		<div class="progress"><span style:width="{editRate}%"></span></div>
		<div class="row">
			<span><Badge label="{data.lines.edited} edited" tone="warn" /></span>
			<span><Badge label="{data.lines.flagged} flagged" tone="danger" /></span>
			<span><Badge label="{data.lines.total} lines" tone="neutral" /></span>
		</div>
	</section>
</div>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 14px;
		margin-bottom: 18px;
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
		gap: 18px;
		margin-bottom: 18px;
		align-items: start;
	}
	.grid.two {
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
	}
	.title {
		color: var(--text);
		font-weight: 500;
	}
	.title:hover {
		color: var(--accent);
	}
	.right {
		text-align: right;
	}
	.feed {
		list-style: none;
		margin: 0;
		padding: 0 24px 20px;
		display: grid;
		gap: 16px;
	}
	.feed li {
		display: flex;
		gap: 12px;
		font-size: 14px;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 9px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.note {
		color: var(--text-2);
		font-style: italic;
		margin-top: 2px;
	}
	.faint {
		font-size: 12px;
	}
	.person {
		display: inline-flex;
		align-items: center;
		gap: 10px;
	}
	.quality {
		display: grid;
		gap: 10px;
	}
	.small {
		font-size: 13.5px;
	}
	.big {
		font-size: 56px;
		font-weight: 300;
		letter-spacing: -0.05em;
		line-height: 1;
		margin-top: 8px;
	}
	.big span {
		font-size: 24px;
		color: var(--muted);
	}
	.row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 6px;
	}
	@media (max-width: 960px) {
		.grid,
		.grid.two {
			grid-template-columns: 1fr;
		}
	}
</style>

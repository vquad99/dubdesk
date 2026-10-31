<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { ArrowRight, Clock, Headphones, LoaderCircle } from '@lucide/svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { ago, plural } from '#lib/format.ts';
	import { hm } from '#lib/hm.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);

	onMount(() => {
		const p = page.url.searchParams;
		if (p.get('sent')) toast('Job sent to admin. Thank you.');
		if (p.get('released')) toast('Job given back to the queue.', 'info');
		if (p.size) replaceState('/review', {});
	});
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Reviewer</span>
		<h1>Your queue</h1>
		<p class="sub">Pick up the next video, check every line, send it back.</p>
	</div>
</div>

<a class="card earned" href="/profile?tab=pay">
	<span class="e-item"><span class="e-l">Video completed this month</span><strong>{hm(data.earned.thisMonth.approved_min)}</strong></span>
	<span class="e-item"><span class="e-l">Waiting for approval</span><strong>{hm(data.earned.pendingMin)}</strong></span>
	<span class="e-item"><span class="e-l">All time</span><strong>{hm(data.earned.allTime.approved_min)}</strong></span>
	{#if data.earned.thisMonth.amount}<span class="e-item"><span class="e-l">Earned this month</span><strong>{data.earned.currency}{data.earned.thisMonth.amount.toLocaleString('en-IN')}</strong></span>{/if}
	<span class="e-go">Details <ArrowRight size={14} /></span>
</a>

{#if data.current}
	{@const c = data.current}
	{@const pct = c.lines ? Math.round((c.checked / c.lines) * 100) : 0}
	<section class="card current">
		<div class="text">
			<span class="eyebrow">You are working on</span>
			<p class="count"><strong>{c.title}</strong></p>
			<div class="prog"><div class="progress"><span style:width="{pct}%"></span></div><span class="muted small">{c.checked} of {c.lines} lines checked</span></div>
			<p class="muted"><Clock size={13} /> Stays yours until {ago(c.locked_until)}; working on it extends this.</p>
			{#if c.admin_note}<p class="note">Admin note: {c.admin_note}</p>{/if}
		</div>
		<a class="btn btn-primary big" href="/review/{c.id}">Continue <ArrowRight size={17} /></a>
	</section>
{/if}

<section class="card hero" class:quiet={!!data.current}>
	<div class="icon"><Headphones size={26} strokeWidth={1.6} /></div>
	<div class="text">
		<p class="count">
			{#if data.waiting === 0}No videos waiting{:else}<strong>{data.waiting}</strong> {data.waiting === 1 ? 'video' : 'videos'} waiting{/if}
		</p>
		<p class="muted"><Clock size={13} /> A job stays yours for {data.lockHours} hours after you pick it up.</p>
		{#if form?.error}<p class="error">{form.error}</p>{/if}
	</div>
	<form
		method="POST"
		action="?/claim"
		use:enhance={() => {
			busy = true;
			return async ({ update }) => {
				await update();
				busy = false;
			};
		}}
	>
		<button class="primary big" disabled={data.waiting === 0 || busy || !!data.current} title={data.current ? 'Finish or give back your current job first' : ''}>
			{#if busy}<LoaderCircle size={17} class="spin" />{/if} Get next job <ArrowRight size={17} />
		</button>
	</form>
</section>

<section class="card">
	<div class="card-head">
		<div>
			<h2>Your recent work</h2>
			<p>Jobs you sent back to the admin.</p>
		</div>
	</div>
	{#if data.history.length === 0}
		<EmptyState title="Nothing yet" text="Jobs you finish will be listed here." />
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Video</th><th>Status</th><th>Lines edited</th><th>Sent</th></tr></thead>
				<tbody>
					{#each data.history as h (h.job_id)}
						<tr>
							<td class="title">{h.title}</td>
							<td><Badge status={h.status} /></td>
							<td>{plural(h.edited, 'line')}</td>
							<td class="faint">{ago(h.submitted_at)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.earned {
		display: flex;
		align-items: center;
		gap: 28px;
		flex-wrap: wrap;
		padding: 16px 22px;
		margin-bottom: 16px;
		color: var(--text);
		text-decoration: none;
		background: linear-gradient(90deg, var(--accent-soft), var(--panel) 75%);
		border: 1px solid var(--accent-line);
	}
	.e-item {
		display: grid;
		gap: 2px;
	}
	.e-l {
		font-size: 11.5px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.e-item strong {
		font-size: 22px;
		font-weight: 400;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.e-go {
		margin-left: auto;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: var(--accent);
	}
	.hero {
		display: flex;
		align-items: center;
		gap: 22px;
		padding: 28px;
		margin-bottom: 18px;
		background:
			radial-gradient(ellipse 50% 120% at 100% 0%, rgba(190, 210, 255, 0.45), transparent 70%),
			radial-gradient(ellipse 30% 90% at 95% 0%, rgba(249, 115, 12, 0.1), transparent 70%),
			#fff;
		flex-wrap: wrap;
	}
	.current {
		display: flex;
		align-items: center;
		gap: 22px;
		padding: 26px 28px;
		margin-bottom: 14px;
		flex-wrap: wrap;
		background:
			radial-gradient(ellipse 50% 140% at 100% 0%, rgba(249, 115, 12, 0.12), transparent 70%),
			#fff;
		border-color: #fddcce;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 12px;
		margin: 6px 0 2px;
	}
	.prog .progress {
		width: 220px;
	}
	.small {
		font-size: 12.5px;
	}
	.note {
		margin-top: 4px;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--orange-soft);
		color: #682906;
		font-size: 13.5px;
	}
	.hero.quiet {
		opacity: 0.75;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 18px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.text {
		flex: 1;
		min-width: 220px;
		display: grid;
		gap: 4px;
	}
	.count {
		font-size: 22px;
		font-weight: 300;
		letter-spacing: -0.02em;
	}
	.count strong {
		font-weight: 500;
	}
	.text .muted {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13.5px;
	}
	.big {
		min-height: 48px;
		padding: 10px 24px;
		font-size: 15px;
	}
	.title {
		font-weight: 500;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>

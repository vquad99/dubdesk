<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Settings2, PlugZap, ExternalLink } from '@lucide/svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { when } from '#lib/format.ts';
	import { workTime } from '#lib/activity.ts';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let showSettings = $state(false);
	let busy = $state(false);

	const s = $derived(data.settings);
	const priced = $derived(s.ratePerMin > 0);
	const mins = (m: number) => (m >= 100 ? Math.round(m).toLocaleString('en-IN') : m.toFixed(1));
	const money = (m: number) =>
		`${s.currency}${(m * s.ratePerMin).toLocaleString('en-IN', { maximumFractionDigits: m * s.ratePerMin >= 100 ? 0 : 2 })}`;
	const monthName = (k: string) =>
		k === 'all' ? 'All time' : new Date(k + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	const used = $derived(s.monthlyMinutes ? Math.min(100, Math.round((data.month.minutes / s.monthlyMinutes) * 100)) : 0);
	const left = $derived(Math.max(0, s.monthlyMinutes - data.month.minutes));
	const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

	const team = $derived(
		data.people.reduce(
			(t, p) => ({
				approved: t.approved + p.jobs_approved,
				checked: t.checked + p.lines_checked,
				edited: t.edited + p.lines_edited,
				revoice: t.revoice + p.revoice_min
			}),
			{ approved: 0, checked: 0, edited: 0, revoice: 0 }
		)
	);

	const saved: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				showSettings = false;
				toast('Saved.');
			} else if (result.type === 'failure') toast(String(result.data?.error ?? 'Could not save.'), 'error');
			await update({ reset: false });
		};
	};
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Sarvam usage</h1>
		<p class="sub">What Sarvam dubbing used, who used it, and what each person produced in return.</p>
	</div>
	<div class="head-actions">
		<select aria-label="Period" value={data.period} onchange={(e) => goto(`?month=${e.currentTarget.value}`, { replace: true })}>
			{#each data.months as m (m)}<option value={m}>{monthName(m)}</option>{/each}
			<option value="all">All time</option>
		</select>
		<button onclick={() => (showSettings = !showSettings)}><Settings2 size={16} /> Price & plan</button>
	</div>
</div>

{#if !data.connected}
	<div class="notice fade-up"><PlugZap size={17} /><span><strong>Sarvam is not connected.</strong> Add <code>SARVAM_API_KEY</code> in Render → Environment. Until then nothing is sent to Sarvam and usage stays at zero.</span></div>
{/if}

{#if showSettings}
	<section class="card settings fade-up">
		<form method="POST" action="?/settings" use:enhance={saved} class="set-grid">
			<label class="field">Currency<input name="currency" value={s.currency} maxlength="5" /></label>
			<label class="field">Price per minute of video<input name="rate" type="number" step="0.01" min="0" value={s.ratePerMin} /></label>
			<label class="field">Plan: minutes per month<input name="limit" type="number" step="1" min="0" value={s.monthlyMinutes} placeholder="0 = no limit" /></label>
			<button class="primary" disabled={busy}>Save</button>
		</form>
		<p class="muted small">Sarvam bills dubbing per minute of video. Copy the price and the plan minutes from your Sarvam dashboard so the cost and “left this month” figures match your bill.
			<a href="https://dashboard.sarvam.ai/" target="_blank" rel="noopener noreferrer">Open Sarvam dashboard <ExternalLink size={12} /></a></p>
	</section>
{/if}

<div class="tiles">
	<StatTile label="Sarvam minutes" value={mins(data.total.minutes)} hint="{monthName(data.period)} · {data.total.videos} {data.total.videos === 1 ? 'video' : 'videos'}" />
	<StatTile label="Cost" value={priced ? money(data.total.minutes) : '—'} hint={priced ? `at ${s.currency}${s.ratePerMin} a minute` : 'set the price per minute'} />
	<div class="tile plan">
		<span class="label">This month vs plan</span>
		{#if s.monthlyMinutes}
			<span class="value">{used}%</span>
			<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={used} aria-label="Plan used"><i class:hot={used >= 90} class:warm={used >= 70 && used < 90} style="width: {used}%"></i></div>
			<span class="hint">{mins(data.month.minutes)} of {mins(s.monthlyMinutes)} min · {mins(left)} left</span>
		{:else}
			<span class="value">{mins(data.month.minutes)}</span>
			<span class="hint">minutes this month · set the plan size to see what is left</span>
		{/if}
	</div>
	<StatTile label="Lines corrected" value={team.edited} hint="{mins(team.revoice)} min to re-voice · {team.approved} approved" />
</div>

<section class="card">
	<div class="card-head">
		<h2>By person</h2>
		<span class="muted small">Spent = videos they sent to Sarvam. Output = their review work in {monthName(data.period).toLowerCase()}.</span>
	</div>
	{#if data.people.length}
		<div class="table-wrap">
			<table class="people">
				<thead>
					<tr>
						<th>Person</th>
						<th class="num grp">Sarvam spent</th>
						<th class="num grp">Reviews</th>
						<th class="num">Lines checked</th>
						<th class="num">Lines corrected</th>
						<th class="num">Worked</th>
						<th class="num grp" title="Sarvam minutes of the videos this person reviewed">Sarvam on reviews</th>
					</tr>
				</thead>
				<tbody>
					{#each data.people as p (p.id)}
						<tr>
							<td class="who">
								<a class="pname" href="/admin/users/{p.id}">{p.name}</a>
								<span class="faint">{p.role}</span>
							</td>
							<td class="num grp">
								{#if p.sent}<strong>{mins(p.sarvam_min)} min</strong><span class="sub2">{p.sent} {p.sent === 1 ? 'video' : 'videos'}{priced ? ` · ${money(p.sarvam_min)}` : ''}</span>{:else}<span class="faint">—</span>{/if}
							</td>
							<td class="num grp">
								{#if p.jobs_sent}<strong>{p.jobs_sent} sent</strong><span class="sub2">{p.jobs_approved} approved · {mins(p.reviewed_min)} min of video</span>{:else}<span class="faint">—</span>{/if}
							</td>
							<td class="num">{p.lines_checked || '—'}</td>
							<td class="num">
								{#if p.lines_edited}<strong>{p.lines_edited}</strong><span class="sub2">{pct(p.lines_edited, p.lines_checked)} of checked · {mins(p.revoice_min)} min re-voice</span>{:else}—{/if}
							</td>
							<td class="num">{p.work_sec ? workTime(p.work_sec) : '—'}</td>
							<td class="num grp">
								{#if p.behind_min}<strong>{mins(p.behind_min)} min</strong><span class="sub2">{priced ? money(p.behind_min) : ''}{priced && p.jobs_approved ? ` · ${money(p.behind_min / p.jobs_approved)} per approved` : ''}</span>{:else}<span class="faint">—</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<EmptyState title="Nothing in this period" text="Usage and review work will show here." />
	{/if}
</section>

<section class="card">
	<div class="card-head">
		<h2>By video</h2>
		<span class="muted small">Every send to Sarvam in {monthName(data.period).toLowerCase()}.</span>
	</div>
	{#if data.videos.length}
		<div class="table-wrap">
			<table>
				<thead><tr><th>When</th><th>Video</th><th>Sent by</th><th class="num">Minutes</th>{#if priced}<th class="num">Cost</th>{/if}<th>Reviewer</th><th class="num">Lines corrected</th><th class="num">Re-voice min</th><th>Status</th></tr></thead>
				<tbody>
					{#each data.videos as v (v.id)}
						<tr>
							<td class="faint nowrap">{when(v.created_at)}</td>
							<td>{#if v.video_id}<a href="/admin/tasks/{v.video_id}">{v.title}</a>{:else}{v.title}{/if}{#if v.sarvam_job_id}<span class="jobid mono" title="Sarvam job">{v.sarvam_job_id.slice(0, 8)}</span>{/if}</td>
							<td>{v.sent_by ?? '—'}</td>
							<td class="num">{mins(v.minutes)}</td>
							{#if priced}<td class="num">{money(v.minutes)}</td>{/if}
							<td>{v.reviewer ?? '—'}</td>
							<td class="num">{v.lines_edited || '—'}</td>
							<td class="num">{v.revoice_min ? mins(v.revoice_min) : '—'}</td>
							<td>{#if v.status}<Badge status={v.status} />{:else}—{/if}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<EmptyState title="No videos sent to Sarvam in this period" text="Use “Dub with Sarvam” on a task to start one." />
	{/if}
</section>

<style>
	.head-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.head-actions select {
		min-width: 170px;
	}
	.notice {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px 16px;
		margin-bottom: 16px;
		border-radius: var(--radius);
		background: var(--orange-soft);
		color: var(--text-2);
		font-size: 14px;
	}
	.notice :global(svg) {
		color: var(--orange);
		flex: none;
		margin-top: 2px;
	}
	.settings {
		padding: 18px 20px;
		margin-bottom: 16px;
		display: grid;
		gap: 10px;
	}
	.set-grid {
		display: grid;
		grid-template-columns: 110px 1fr 1fr auto;
		gap: 12px;
		align-items: end;
	}
	@media (max-width: 760px) {
		.set-grid {
			grid-template-columns: 1fr;
		}
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 14px;
		margin-bottom: 18px;
	}
	.tile {
		display: grid;
		gap: 6px;
		padding: 18px 20px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--panel);
	}
	.tile .label {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.tile .value {
		font-size: 32px;
		font-weight: 300;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}
	.tile .hint {
		font-size: 13px;
		color: var(--muted);
	}
	.meter {
		height: 6px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.meter i {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: var(--accent);
		transition: width 0.5s var(--ease);
	}
	.meter i.warm {
		background: var(--orange);
	}
	.meter i.hot {
		background: var(--danger);
	}
	section.card {
		margin-bottom: 18px;
	}
	.card-head {
		display: flex;
		align-items: baseline;
		gap: 12px;
		flex-wrap: wrap;
		padding: 18px 20px 6px;
	}
	.card-head h2 {
		font-size: 17px;
		font-weight: 500;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	th.grp,
	td.grp {
		border-left: 1px solid var(--line);
	}
	.who {
		white-space: nowrap;
	}
	.people th {
		white-space: normal;
	}
	.who .faint {
		display: block;
		font-size: 12.5px;
		text-transform: capitalize;
	}
	.pname {
		font-weight: 500;
		color: var(--text);
	}
	.people td.num strong {
		display: block;
		font-weight: 500;
	}
	.sub2 {
		display: block;
		font-size: 12px;
		color: var(--muted);
	}
	.pname:hover {
		color: var(--accent);
	}
	.nowrap {
		white-space: nowrap;
	}
	.jobid {
		margin-left: 8px;
		font-size: 11.5px;
		color: var(--faint);
	}
	.small {
		font-size: 13px;
	}
</style>

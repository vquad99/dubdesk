<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { ArrowRight, Clock, Mail, CalendarDays, LogIn } from '@lucide/svelte';
	import EarningsCard from './EarningsCard.svelte';
	import { hm } from '#lib/hm.ts';
	import Badge from './Badge.svelte';
	import StatTile from './StatTile.svelte';
	import DayBars from './DayBars.svelte';
	import ActivityList from './ActivityList.svelte';
	import EmptyState from './EmptyState.svelte';
	import { workTime } from '#lib/activity.ts';
	import { ago, when } from '#lib/format.ts';

	type P = Awaited<ReturnType<typeof import('#lib/server/profile.ts').loadProfile>> & {};
	let {
		p,
		activity,
		self = false,
		activityHref = null,
		security
	}: {
		p: NonNullable<P>;
		activity: Parameters<typeof ActivityList>[1]['rows'];
		self?: boolean;
		activityHref?: string | null;
		security?: Snippet;
	} = $props();

	const s = $derived(p.stats);
	const decided = $derived(s.approved + s.sent_back);
	const approvalRate = $derived(decided ? Math.round((s.approved / decided) * 100) : null);
	const avgJob = $derived.by(() => {
		const done = p.jobs.filter((j) => j.submitted_at);
		return done.length ? Math.round(done.reduce((a, j) => a + j.seconds, 0) / done.length) : 0;
	});
	const ROLE_TONE = { admin: 'accent', reviewer: 'info', operator: 'warn' } as const;
	const initials = $derived(
		p.user.name
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);
	const isReviewer = $derived(p.user.role === 'reviewer');
	const isOperator = $derived(p.user.role === 'operator');

	// Sub-pages, one per kind of data; the choice lives in the address (?tab=) so it can be linked.
	const tabs = $derived(
		[
			{ key: 'overview', label: 'Overview' },
			isReviewer && p.earned ? { key: 'pay', label: 'Video & pay' } : null,
			isReviewer || isOperator ? { key: 'time', label: 'Working time' } : null,
			isReviewer ? { key: 'jobs', label: `Jobs${p.jobs.length ? ` (${p.jobs.length})` : ''}` } : null,
			{ key: 'activity', label: 'Activity' },
			security ? { key: 'security', label: 'Security' } : null
		].filter((t): t is { key: string; label: string } => !!t)
	);
	const tab = $derived.by(() => {
		const want = page.url.searchParams.get('tab') ?? 'overview';
		return tabs.some((t) => t.key === want) ? want : 'overview';
	});
	const tabHref = (k: string) => {
		const u = new URLSearchParams(page.url.search);
		if (k === 'overview') u.delete('tab');
		else u.set('tab', k);
		const q = u.toString();
		return q ? `?${q}` : page.url.pathname;
	};
</script>

<section class="card hero">
	<span class="big-avatar">{initials}</span>
	<div class="who">
		<div class="name">
			<h1>{p.user.name}</h1>
			<Badge label={p.user.role[0].toUpperCase() + p.user.role.slice(1)} tone={ROLE_TONE[p.user.role as keyof typeof ROLE_TONE]} />
			{#if !p.user.active}<Badge label="Turned off" tone="neutral" />{/if}
		</div>
		<div class="facts">
			<span><Mail size={14} /> {p.user.email}</span>
			<span><CalendarDays size={14} /> Joined {when(p.user.created_at)}</span>
			<span><LogIn size={14} /> Last login {p.user.last_login_at ? ago(p.user.last_login_at) : 'never'}</span>
		</div>
	</div>
	{#if p.current}
		<a class="now" href="/review/{p.current.job_id}">
			<span class="eyebrow">{self ? 'You are working on' : 'Working on'}</span>
			<strong>{p.current.title}</strong>
			<span class="muted small"><Clock size={12} /> lock ends {ago(p.current.locked_until)}</span>
			{#if self}<span class="go">Continue <ArrowRight size={14} /></span>{/if}
		</a>
	{/if}
</section>

<nav class="ptabs" aria-label="Profile sections">
	{#each tabs as t (t.key)}
		<a href={tabHref(t.key)} class:on={tab === t.key} aria-current={tab === t.key ? 'page' : undefined} data-sveltekit-noscroll data-sveltekit-replacestate>{t.label}</a>
	{/each}
</nav>

{#if tab === 'overview'}
{#if isReviewer && p.earned}
	<a class="month card" href={tabHref('pay')} data-sveltekit-noscroll data-sveltekit-replacestate>
		<span class="eyebrow">Video completed this month</span>
		<strong>{hm(p.earned.thisMonth.approved_min)}</strong>
		<span class="muted small">{p.earned.thisMonth.approved} approved · {hm(p.earned.pendingMin)} waiting for approval{p.earned.thisMonth.amount ? ` · ${p.earned.currency}${p.earned.thisMonth.amount.toLocaleString('en-IN')}` : ''}</span>
		<span class="go">Video & pay <ArrowRight size={14} /></span>
	</a>
{/if}
{#if isReviewer}
	<section class="tiles">
		<StatTile label="Jobs sent" value={s.jobs_sent} hint="sent for approval" />
		<StatTile label="Approval rate" value={approvalRate === null ? '—' : `${approvalRate}%`} hint="{s.approved} approved · {s.sent_back} sent back" />
		<StatTile label="Lines checked" value={s.lines_checked} hint="{s.lines_edited} with text fixed" />
		<StatTile label="Timing changes" value={s.timing_changes} hint="{s.flags} problems flagged" />
		<StatTile label="Working time" value={workTime(s.seconds)} hint="{workTime(s.seconds_week)} in the last 7 days" />
		<StatTile label="Average per job" value={avgJob ? workTime(avgJob) : '—'} hint="active time on sent jobs" />
	</section>
{/if}
{#if isOperator}
	<section class="tiles">
		<StatTile label="Videos approved" value={s.checks_approved} hint="after checking the reviewer's work" />
		<StatTile label="Sent back" value={s.checks_returned} hint="to the reviewer, with a note" />
		<StatTile label="Video approved" value={hm(s.checked_min)} hint="total length of the videos they approved" />
		<StatTile label="Lines fixed" value={s.lines_edited} hint="corrected while checking" />
		<StatTile label="Working time" value={workTime(s.seconds)} hint="{workTime(s.seconds_week)} in the last 7 days" />
	</section>
{/if}
{#if p.user.role === 'admin'}
	<section class="tiles">
		<StatTile label="Videos uploaded" value={s.videos_uploaded} />
	</section>
{/if}

{/if}

{#if tab === 'pay' && p.earned}
	<EarningsCard e={p.earned} {self} />
{/if}

{#if tab === 'time'}
<section class="card card-pad chart-card">
	<div class="head">
		<div>
			<h2>Working time, last 30 days</h2>
			<p class="muted small">Minutes with the review screen open and in use. Hover a day for line changes and actions.</p>
		</div>
		<span class="sum">{workTime(p.days.reduce((a, d) => a + d.minutes, 0) * 60)}</span>
	</div>
	<DayBars days={p.days} />
</section>

{/if}

{#if tab === 'jobs'}
	<section class="card">
		<div class="card-head">
			<div>
				<h2>Job history</h2>
				<p>Every video {self ? 'you have' : 'they have'} worked on, newest first.</p>
			</div>
		</div>
		{#if p.jobs.length === 0}
			<EmptyState title="No jobs yet" text="Jobs appear here once picked up from the queue." />
		{:else}
			<div class="table-wrap">
				<table>
					<thead>
						<tr><th>Video</th><th>Result</th><th>Checked</th><th>Edits</th><th>Time</th><th>Sent</th></tr>
					</thead>
					<tbody>
						{#each p.jobs as j (j.job_id)}
							<tr>
								<td>
									<span class="title">{j.title}</span>
									<span class="meta">Round {j.round}{j.returned ? ` · sent back ${j.returned}×` : ''}{j.assigned_at ? ` · picked up ${when(j.assigned_at)}` : ''}</span>
								</td>
								<td><Badge status={j.status} /></td>
								<td class="nowrap">{j.checked}/{j.lines}</td>
								<td>{j.edits}</td>
								<td class="nowrap">{workTime(j.seconds)}</td>
								<td class="faint nowrap">{j.submitted_at ? ago(j.submitted_at) : '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{/if}

{#if tab === 'activity'}
	<section class="card">
		<div class="card-head">
			<h2>Recent activity</h2>
			{#if activityHref}<a class="btn btn-sm btn-ghost" href={activityHref}>Full log <ArrowRight size={14} /></a>{/if}
		</div>
		<div class="feed">
			{#if activity.length === 0}
				<EmptyState title="Nothing yet" />
			{:else}
				<ActivityList rows={activity} showUser={false} linkVideos={!self} />
			{/if}
		</div>
	</section>
{/if}

{#if tab === 'security' && security}
	{@render security()}
{/if}

<style>
	.ptabs {
		display: flex;
		gap: 4px;
		margin: 0 0 18px;
		padding: 4px;
		border-radius: 999px;
		background: var(--surface-2);
		width: fit-content;
		max-width: 100%;
		overflow-x: auto;
	}
	.ptabs a {
		padding: 7px 16px;
		border-radius: 999px;
		font-size: 14px;
		color: var(--muted);
		text-decoration: none;
		white-space: nowrap;
		transition:
			background 0.2s,
			color 0.2s;
	}
	.ptabs a:hover {
		color: var(--text);
	}
	.ptabs a.on {
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-1);
		font-weight: 500;
	}
	.month {
		display: grid;
		gap: 4px;
		padding: 18px 22px;
		margin-bottom: 16px;
		text-decoration: none;
		color: var(--text);
		background: linear-gradient(90deg, var(--accent-soft), var(--panel) 70%);
		border: 1px solid var(--accent-line);
	}
	.month strong {
		font-size: 30px;
		font-weight: 300;
		letter-spacing: -0.03em;
	}
	.month .go {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: var(--accent);
	}
	.hero {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 24px;
		margin-bottom: 16px;
		flex-wrap: wrap;
		background:
			radial-gradient(ellipse 45% 140% at 100% 0%, rgba(190, 210, 255, 0.4), transparent 70%),
			radial-gradient(ellipse 25% 100% at 96% 0%, rgba(249, 115, 12, 0.08), transparent 70%),
			#fff;
	}
	.big-avatar {
		display: grid;
		place-items: center;
		width: 68px;
		height: 68px;
		border-radius: 50%;
		font-size: 24px;
		font-weight: 500;
		color: #fff;
		background: linear-gradient(135deg, #81a0e9, #3333cc);
		box-shadow: 0 0 0 4px #fff, 0 0 0 5px var(--line);
		flex: none;
	}
	.who {
		flex: 1;
		min-width: 240px;
		display: grid;
		gap: 8px;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.name h1 {
		font-size: 30px;
	}
	.facts {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		font-size: 13.5px;
		color: var(--muted);
	}
	.facts span,
	.small {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.now {
		display: grid;
		gap: 4px;
		padding: 14px 18px;
		border-radius: 16px;
		background: var(--orange-soft);
		border: 1px solid #fddcce;
		color: var(--text);
		min-width: 220px;
		transition: box-shadow 0.2s;
	}
	.now:hover {
		box-shadow: var(--shadow-2);
		color: var(--text);
	}
	.now strong {
		font-weight: 500;
	}
	.go {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 13px;
		color: #a5460f;
		font-weight: 500;
	}
	.small {
		font-size: 12.5px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
		margin-bottom: 16px;
	}
	.chart-card {
		margin-bottom: 16px;
		display: grid;
		gap: 16px;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}
	.head p {
		margin-top: 2px;
	}
	.sum {
		font-size: 22px;
		font-weight: 300;
		letter-spacing: -0.02em;
		white-space: nowrap;
	}
	.title {
		display: block;
		font-weight: 500;
	}
	.meta {
		font-size: 12px;
		color: var(--muted);
	}
	.nowrap {
		white-space: nowrap;
	}
	.feed {
		padding: 0 24px 12px;
	}
</style>

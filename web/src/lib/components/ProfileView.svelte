<script lang="ts">
	import { ArrowRight, Clock, Mail, CalendarDays, LogIn } from '@lucide/svelte';
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
		activityHref = null
	}: {
		p: NonNullable<P>;
		activity: Parameters<typeof ActivityList>[1]['rows'];
		self?: boolean;
		activityHref?: string | null;
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
	const isReviewer = $derived(p.user.role !== 'operator');
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
{#if p.user.role === 'admin'}
	<section class="tiles">
		<StatTile label="Videos uploaded" value={s.videos_uploaded} />
		<StatTile label="Reviews decided" value={s.approvals_given} hint="approved or sent back" />
	</section>
{/if}

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

<div class="split">
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
</div>

<style>
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
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
		gap: 16px;
		align-items: start;
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
		max-height: 560px;
		overflow-y: auto;
	}
	@media (max-width: 1000px) {
		.split {
			grid-template-columns: 1fr;
		}
	}
</style>

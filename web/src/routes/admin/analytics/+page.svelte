<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Download, Radio, Settings2, Users as UsersIcon, Clock3, CircleCheck, PenLine } from '@lucide/svelte';
	import TrendChart, { type Series } from '#lib/components/TrendChart.svelte';
	import HourBars from '#lib/components/HourBars.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { workTime } from '#lib/activity.ts';
	import { hm } from '#lib/hm.ts';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// ---------- live monitor: polled every 20 s while the tab is visible ----------
	// Starts from the page data, then the poll replaces it; a filter change reloads the page data.
	let polled = $state<typeof data.live | null>(null);
	const liveData = $derived(polled ?? data.live);
	let liveErr = $state(false);
	async function refreshLive() {
		if (document.hidden) return;
		try {
			const r = await fetch('/api/admin/live', { headers: { accept: 'application/json' } });
			if (!r.ok) throw new Error(String(r.status));
			polled = await r.json();
			liveErr = false;
		} catch {
			liveErr = true;
		}
	}
	onMount(() => {
		const t = setInterval(refreshLive, 20_000);
		const vis = () => !document.hidden && refreshLive();
		document.addEventListener('visibilitychange', vis);
		return () => {
			clearInterval(t);
			document.removeEventListener('visibilitychange', vis);
		};
	});
	const sinceText = (d: string | Date) => {
		const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000));
		return s < 60 ? `${s}s ago` : `${Math.round(s / 60)} min ago`;
	};
	const working = $derived(liveData.people.filter((p) => p.working));
	const idle = $derived(liveData.people.filter((p) => !p.working));

	// ---------- filters ----------
	const RANGES = [
		['today', 'Today'],
		['7d', 'Last 7 days'],
		['30d', 'Last 30 days'],
		['month', 'This month'],
		['lastmonth', 'Last month'],
		['90d', 'Last 90 days'],
		['custom', 'Custom dates']
	] as const;
	function setParam(changes: Record<string, string | null>) {
		const u = new URL(page.url.href);
		for (const [k, v] of Object.entries(changes)) {
			if (v === null || v === '') u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		goto(u.pathname + u.search, { replace: true });
	}
	const exportHref = (kind: string) => {
		const u = new URLSearchParams(page.url.search);
		u.set('kind', kind);
		if (!u.get('range')) u.set('range', data.range.preset);
		if (kind === 'trend') u.set('gran', data.gran);
		return `/api/admin/analytics.csv?${u}`;
	};

	// ---------- trend ----------
	type MetricKey = 'checked' | 'corrected' | 'approved_min' | 'active_min' | 'approved';
	const METRICS: { key: MetricKey; label: string; fmt: (v: number) => string }[] = [
		{ key: 'checked', label: 'Lines checked', fmt: (v) => Math.round(v).toLocaleString('en-IN') },
		{ key: 'corrected', label: 'Lines corrected', fmt: (v) => Math.round(v).toLocaleString('en-IN') },
		{ key: 'approved_min', label: 'Approved video min', fmt: (v) => (v >= 10 ? Math.round(v) : v.toFixed(1)).toString() },
		{ key: 'active_min', label: 'Active hours', fmt: (v) => (v / 60 >= 10 ? Math.round(v / 60) : (v / 60).toFixed(1)).toString() },
		{ key: 'approved', label: 'Reviews approved', fmt: (v) => Math.round(v).toString() }
	];
	let metric = $state<MetricKey>('checked');
	let view = $state<'team' | 'people'>('team');
	const m = $derived(METRICS.find((x) => x.key === metric)!);

	const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
	const OTHER = '#9a9a9a';
	const nameOf = $derived(new Map(data.people.map((p) => [p.id, p.name])));
	const idx = $derived(new Map(data.labels.map((l, i) => [l, i])));

	const series = $derived.by((): Series[] => {
		const zero = () => data.labels.map(() => 0);
		if (view === 'team' || data.userId) {
			const v = zero();
			for (const r of data.rows) {
				const i = idx.get(r.bucket);
				if (i !== undefined) v[i] += r[metric];
			}
			return [{ key: 'team', name: data.userId ? (nameOf.get(data.userId) ?? 'Person') : 'Team', values: v }];
		}
		const per = new Map<number, number[]>();
		for (const r of data.rows) {
			const i = idx.get(r.bucket);
			if (i === undefined) continue;
			if (!per.has(r.user_id)) per.set(r.user_id, zero());
			per.get(r.user_id)![i] += r[metric];
		}
		const ranked = [...per.entries()].map(([id, v]) => ({ id, v, total: v.reduce((a, b) => a + b, 0) })).filter((x) => x.total > 0);
		ranked.sort((a, b) => b.total - a.total);
		const top = ranked.slice(0, 6).sort((a, b) => a.id - b.id);
		const rest = ranked.slice(6);
		const out: Series[] = top.map((x) => ({ key: `u${x.id}`, name: nameOf.get(x.id) ?? `#${x.id}`, values: x.v }));
		if (rest.length) {
			const v = zero();
			for (const x of rest) x.v.forEach((n, i) => (v[i] += n));
			out.push({ key: 'other', name: `${rest.length} others`, values: v });
		}
		return out;
	});
	const colorOf = (key: string) => {
		if (key === 'other') return OTHER;
		if (key === 'team') return PALETTE[0];
		const i = series.findIndex((s) => s.key === key);
		return PALETTE[i % PALETTE.length];
	};
	const tick = (l: string) => {
		const d = new Date(l + 'T00:00:00Z');
		if (data.gran === 'month') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
		return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	};
	const tip = (l: string) => {
		const d = new Date(l + 'T00:00:00Z');
		if (data.gran === 'month') return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
		const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
		return data.gran === 'week' ? `Week of ${day}` : day;
	};

	// ---------- KPIs for the period ----------
	const tot = $derived(
		data.people.reduce(
			(t, p) => ({
				checked: t.checked + p.checked,
				corrected: t.corrected + p.corrected,
				approved: t.approved + p.approved,
				returned: t.returned + p.returned,
				approved_min: t.approved_min + p.approved_min,
				active_min: t.active_min + p.active_min,
				amount: t.amount + p.amount,
				people: t.people + (p.checked || p.active_min ? 1 : 0)
			}),
			{ checked: 0, corrected: 0, approved: 0, returned: 0, approved_min: 0, active_min: 0, amount: 0, people: 0 }
		)
	);
	const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
	const perHour = (lines: number, min: number) => (min >= 1 ? Math.round(lines / (min / 60)) : null);
	const money = (v: number) => `${data.rates.currency}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
	const hrs = (min: number) => (min >= 60 ? `${(min / 60).toFixed(1)} h` : `${Math.round(min)} min`);

	// ---------- people / payments ----------
	type SortKey = 'name' | 'checked' | 'corrected' | 'approved_min' | 'active_min' | 'speed' | 'amount';
	let sortKey = $state<SortKey>('amount');
	let sortDir = $state<1 | -1>(-1);
	const sortVal = (p: (typeof data.people)[number], k: SortKey) =>
		k === 'name' ? p.name.toLowerCase() : k === 'speed' ? (perHour(p.checked, p.active_min) ?? -1) : p[k];
	const rows = $derived(
		[...data.people].sort((a, b) => {
			const x = sortVal(a, sortKey);
			const y = sortVal(b, sortKey);
			return (x < y ? -1 : x > y ? 1 : 0) * sortDir || a.name.localeCompare(b.name);
		})
	);
	function sortBy(k: SortKey) {
		if (sortKey === k) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortKey = k;
			sortDir = k === 'name' ? 1 : -1;
		}
	}
	const vendors = $derived.by(() => {
		const map = new Map<string, { people: number; amount: number; approved_min: number; active_min: number }>();
		for (const p of data.people) {
			if (!p.amount && !p.active_min && !p.checked) continue;
			const k = p.vendor || 'No vendor';
			const v = map.get(k) ?? { people: 0, amount: 0, approved_min: 0, active_min: 0 };
			v.people++;
			v.amount += p.amount;
			v.approved_min += p.approved_min;
			v.active_min += p.active_min;
			map.set(k, v);
		}
		return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
	});

	let ratesOpen = $state(false);
	let busy = $state(false);
	const saved: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				ratesOpen = false;
				toast('Pay rates saved.');
			} else if (result.type === 'failure') toast(String(result.data?.error ?? 'Could not save.'), 'error');
			await update({ reset: false });
		};
	};
	const noRates = $derived(!data.rates.perMin && !data.rates.perHour && !data.rates.perLine && !data.people.some((p) => p.custom_rate));
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Analytics</h1>
		<p class="sub">Live work, trends per annotator, and what each person and vendor is owed.</p>
	</div>
</div>

<!-- ================= LIVE ================= -->
<section class="card live">
	<div class="card-head">
		<h2><span class="pulse" class:err={liveErr} aria-hidden="true"></span> Live now</h2>
		<span class="muted small">{liveErr ? 'Could not refresh — retrying' : `Updates every 20 s · ${new Date(liveData.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}</span>
	</div>
	<div class="live-tiles">
		<div class="lt"><span class="lt-l"><UsersIcon size={14} /> Online</span><span class="lt-v">{liveData.online}</span><span class="lt-h">signed in, last 5 min</span></div>
		<div class="lt"><span class="lt-l"><Radio size={14} /> Working</span><span class="lt-v">{liveData.working}</span><span class="lt-h">in a review right now</span></div>
		<div class="lt"><span class="lt-l"><CircleCheck size={14} /> Last hour</span><span class="lt-v">{liveData.lastHour.checked}</span><span class="lt-h">lines checked · {liveData.lastHour.corrected} corrected</span></div>
		<div class="lt"><span class="lt-l"><Clock3 size={14} /> Last hour</span><span class="lt-v">{Math.round(liveData.lastHour.active_min)}</span><span class="lt-h">active minutes · {liveData.lastHour.people} {liveData.lastHour.people === 1 ? 'person' : 'people'}</span></div>
	</div>

	{#if working.length}
		<div class="who-list">
			{#each working as p (p.id)}
				{@const done = p.lines_total ? Math.round(((p.lines_checked ?? 0) / p.lines_total) * 100) : 0}
				<div class="who-row">
					<span class="avatar">{p.name.slice(0, 1).toUpperCase()}<i class="dot on"></i></span>
					<span class="who-name"><a href="/admin/users/{p.id}">{p.name}</a><span class="faint">{p.vendor ?? p.role}</span></span>
					<span class="who-job">
						{#if p.job_id}
							<span class="job-title">{p.video_title}</span>
							<span class="bar" title="{p.lines_checked}/{p.lines_total} lines checked"><i style="width:{done}%"></i></span>
							<span class="faint small">{p.lines_checked}/{p.lines_total} lines · {done}%</span>
						{/if}
					</span>
					<span class="who-hour"><b>{p.hour_checked}</b> checked · <b>{p.hour_corrected}</b> corrected · <b>{Math.round(p.hour_active_min)}</b> min<span class="faint small">last hour</span></span>
					<span class="faint small nowrap">{sinceText(p.last_seen)}</span>
				</div>
			{/each}
		</div>
	{/if}
	{#if idle.length}
		<p class="idle-line"><span class="faint">Online, not in a review:</span>
			{#each idle as p, i (p.id)}<a href="/admin/users/{p.id}">{p.name}</a><span class="faint">&nbsp;({p.role})</span>{i < idle.length - 1 ? ', ' : ''}{/each}
		</p>
	{/if}
	{#if !liveData.people.length}<p class="muted small pad">Nobody is signed in right now.</p>{/if}

	<div class="sub-head"><h3>Last 24 hours</h3><span class="faint small">lines checked per hour (India time) · hover for detail</span></div>
	<div class="hours-pad"><HourBars hours={liveData.hours} /></div>
</section>

<!-- ================= FILTERS ================= -->
<div class="filters-bar card">
	<label class="field inline">Period
		<select value={data.range.preset} onchange={(e) => setParam({ range: e.currentTarget.value, from: null, to: null })}>
			{#each RANGES as [k, l] (k)}<option value={k}>{l}</option>{/each}
		</select>
	</label>
	{#if data.range.preset === 'custom'}
		<label class="field inline">From<input type="date" value={data.range.from} onchange={(e) => setParam({ range: 'custom', from: e.currentTarget.value })} /></label>
		<label class="field inline">To<input type="date" value={data.range.to} onchange={(e) => setParam({ range: 'custom', to: e.currentTarget.value })} /></label>
	{/if}
	<div class="seg" role="group" aria-label="Group by">
		{#each ['day', 'week', 'month'] as g (g)}
			<button class:on={data.gran === g} onclick={() => setParam({ gran: g === 'day' ? null : g })}>{g === 'day' ? 'Daily' : g === 'week' ? 'Weekly' : 'Monthly'}</button>
		{/each}
	</div>
	<label class="field inline">Annotator
		<select value={String(data.userId ?? '')} onchange={(e) => setParam({ user: e.currentTarget.value || null })}>
			<option value="">Everyone</option>
			{#each [...data.people].sort((a, b) => a.name.localeCompare(b.name)) as p (p.id)}<option value={String(p.id)}>{p.name}</option>{/each}
		</select>
	</label>
	<span class="spacer"></span>
	<span class="faint small">{data.range.from} → {data.range.to}</span>
	<a class="btn" href={exportHref('trend')} data-sveltekit-reload><Download size={15} /> Trend CSV</a>
	<a class="btn btn-primary" href={exportHref('payments')} data-sveltekit-reload><Download size={15} /> Payments CSV</a>
</div>

<!-- ================= KPIs ================= -->
<div class="kpis">
	<div class="kpi"><span class="k-l">Lines checked</span><span class="k-v">{tot.checked.toLocaleString('en-IN')}</span><span class="k-h">{tot.people} active {tot.people === 1 ? 'annotator' : 'annotators'}</span></div>
	<div class="kpi"><span class="k-l">Correction rate</span><span class="k-v">{pct(tot.corrected, tot.checked)}</span><span class="k-h">{tot.corrected.toLocaleString('en-IN')} lines corrected</span></div>
	<div class="kpi"><span class="k-l">Speed</span><span class="k-v">{perHour(tot.checked, tot.active_min) ?? '—'}</span><span class="k-h">lines per active hour · {hrs(tot.active_min)} worked</span></div>
	<div class="kpi"><span class="k-l">First-pass approval</span><span class="k-v">{pct(tot.approved, tot.approved + tot.returned)}</span><span class="k-h">{tot.approved} approved · {tot.returned} sent back</span></div>
	<div class="kpi"><span class="k-l">Video completed</span><span class="k-v">{hm(tot.approved_min)}</span><span class="k-h">{tot.approved_min ? `${(tot.active_min / tot.approved_min).toFixed(1)} min of work per video min` : 'nothing approved yet'}</span></div>
	<div class="kpi"><span class="k-l">To pay</span><span class="k-v">{noRates ? '—' : money(tot.amount)}</span><span class="k-h">{noRates ? 'set pay rates below' : `${vendors.length} ${vendors.length === 1 ? 'vendor' : 'vendors'}`}</span></div>
</div>

<!-- ================= TREND ================= -->
<section class="card">
	<div class="card-head">
		<h2>Trend</h2>
		<div class="seg small-seg" role="group" aria-label="Measure">
			{#each METRICS as x (x.key)}<button class:on={metric === x.key} onclick={() => (metric = x.key)}>{x.label}</button>{/each}
		</div>
		<span class="spacer"></span>
		{#if !data.userId}
			<div class="seg small-seg" role="group" aria-label="View">
				<button class:on={view === 'team'} onclick={() => (view = 'team')}>Team</button>
				<button class:on={view === 'people'} onclick={() => (view = 'people')}>By annotator</button>
			</div>
		{/if}
	</div>
	<div class="chart-wrap">
		{#if data.rows.length}
			<TrendChart labels={data.labels} {series} format={m.fmt} tickLabel={tick} tipLabel={tip} {colorOf} />
		{:else}
			<EmptyState title="No work in this period" text="Pick a longer period or another annotator." />
		{/if}
	</div>
</section>

<!-- ================= PEOPLE + PAYMENTS ================= -->
<section class="card">
	<div class="card-head">
		<h2>Annotators & payments</h2>
		<span class="muted small">{data.range.from} → {data.range.to}. Click a heading to sort.</span>
		<span class="spacer"></span>
		<button class="sm" onclick={() => (ratesOpen = !ratesOpen)}><Settings2 size={14} /> Pay rates</button>
	</div>

	{#if ratesOpen}
		<form method="POST" action="?/rates" use:enhance={saved} class="rates fade-up">
			<label class="field">Currency<input name="currency" value={data.rates.currency} maxlength="5" /></label>
			<label class="field">Per minute of approved video<input name="perMin" type="number" step="0.01" min="0" value={data.rates.perMin} /></label>
			<label class="field">Per active hour<input name="perHour" type="number" step="0.01" min="0" value={data.rates.perHour} /></label>
			<label class="field">Per corrected line<input name="perLine" type="number" step="0.01" min="0" value={data.rates.perLine} /></label>
			<button class="primary" disabled={busy}>Save</button>
			<p class="muted small span">Main rule: pay per minute of video the reviewer completed and the operator approved (× 60 = per video hour). Amount = approved video minutes × rate + active hours × rate + corrected lines × rate. Use one or mix them. A different rate for one person or vendor is set on <a href="/admin/users">Users</a> → edit.</p>
		</form>
	{/if}

	<div class="table-wrap">
		<table class="pay">
			<thead>
				<tr>
					<th><button class="th" onclick={() => sortBy('name')}>Annotator</button></th>
					<th class="num"><button class="th" onclick={() => sortBy('checked')}>Checked</button></th>
					<th class="num"><button class="th" onclick={() => sortBy('corrected')}>Corrected</button></th>
					<th class="num">Reviews</th>
					<th class="num"><button class="th" onclick={() => sortBy('approved_min')}>Video completed</button></th>
					<th class="num"><button class="th" onclick={() => sortBy('active_min')}>Active</button></th>
					<th class="num"><button class="th" onclick={() => sortBy('speed')}>Lines / hour</button></th>
					<th class="num">Rate</th>
					<th class="num"><button class="th" onclick={() => sortBy('amount')}>Amount</button></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as p (p.id)}
					<tr class:dim={!p.checked && !p.active_min && !p.approved}>
						<td class="who"><a href="/admin/users/{p.id}">{p.name}</a><span class="faint">{p.vendor ?? (p.role === 'reviewer' ? 'no vendor' : p.role)}</span></td>
						<td class="num">{p.checked || '—'}</td>
						<td class="num">{#if p.corrected}{p.corrected}<span class="sub2">{pct(p.corrected, p.checked)}</span>{:else}—{/if}</td>
						<td class="num">{#if p.submitted || p.approved}{p.approved} ok · {p.returned} back<span class="sub2">{pct(p.approved, p.approved + p.returned)} first pass</span>{:else}—{/if}</td>
						<td class="num">{p.approved_min ? hm(p.approved_min) : '—'}</td>
						<td class="num">{p.active_min ? workTime(Math.round(p.active_min * 60)) : '—'}</td>
						<td class="num">{perHour(p.checked, p.active_min) ?? '—'}</td>
						<td class="num rate">
							{#if p.rate_min || p.rate_hour || p.rate_line}
								{#if p.rate_min}<span>{money(p.rate_min)}/min</span>{/if}
								{#if p.rate_hour}<span>{money(p.rate_hour)}/h</span>{/if}
								{#if p.rate_line}<span>{money(p.rate_line)}/line</span>{/if}
								{#if p.custom_rate}<span class="own">own rate</span>{/if}
							{:else}—{/if}
						</td>
						<td class="num amt">{p.amount ? money(p.amount) : '—'}</td>
					</tr>
				{/each}
			</tbody>
			{#if vendors.length}
				<tfoot>
					{#each vendors as [name, v] (name)}
						<tr class="vend"><td>{name} <span class="faint">· {v.people} {v.people === 1 ? 'person' : 'people'}</span></td><td colspan="3"></td><td class="num">{hm(v.approved_min)}</td><td class="num">{workTime(Math.round(v.active_min * 60))}</td><td colspan="2"></td><td class="num amt">{money(v.amount)}</td></tr>
					{/each}
					<tr class="grand"><td>Total</td><td class="num">{tot.checked}</td><td class="num">{tot.corrected}</td><td class="num">{tot.approved} ok · {tot.returned} back</td><td class="num">{hm(tot.approved_min)}</td><td class="num">{workTime(Math.round(tot.active_min * 60))}</td><td class="num">{perHour(tot.checked, tot.active_min) ?? '—'}</td><td></td><td class="num amt">{money(tot.amount)}</td></tr>
				</tfoot>
			{/if}
		</table>
	</div>
</section>

<style>
	.card-head {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		padding: 18px 20px 8px;
	}
	.card-head h2 {
		font-size: 17px;
		font-weight: 500;
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	section.card {
		margin-bottom: 18px;
	}
	.spacer {
		flex: 1;
	}
	.small {
		font-size: 13px;
	}
	.nowrap {
		white-space: nowrap;
	}
	.pad {
		padding: 0 20px 12px;
	}
	/* live */
	.pulse {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #1baf7a;
		box-shadow: 0 0 0 0 rgba(27, 175, 122, 0.5);
		animation: pulse 2s infinite;
	}
	.pulse.err {
		background: var(--orange);
		animation: none;
	}
	@keyframes pulse {
		70% {
			box-shadow: 0 0 0 8px rgba(27, 175, 122, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(27, 175, 122, 0);
		}
	}
	.live-tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		padding: 6px 20px 14px;
	}
	.lt {
		display: grid;
		gap: 2px;
		padding: 14px 16px;
		border-radius: var(--radius);
		background: var(--surface-2);
	}
	.lt-l {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.lt-v {
		font-size: 30px;
		font-weight: 300;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}
	.lt-h {
		font-size: 12.5px;
		color: var(--muted);
	}
	.who-list {
		display: grid;
		border-top: 1px solid var(--line);
	}
	.who-row {
		display: grid;
		grid-template-columns: 36px minmax(120px, 1fr) minmax(180px, 2fr) minmax(200px, 1.4fr) 70px;
		gap: 12px;
		align-items: center;
		padding: 10px 20px;
		border-bottom: 1px solid var(--line);
		font-size: 13.5px;
	}
	@media (max-width: 900px) {
		.who-row {
			grid-template-columns: 36px 1fr;
		}
		.who-job,
		.who-hour {
			grid-column: 2;
		}
	}
	.avatar {
		position: relative;
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 600;
	}
	.dot {
		position: absolute;
		right: -1px;
		bottom: -1px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		border: 2px solid var(--panel);
		background: var(--faint);
	}
	.dot.on {
		background: #1baf7a;
	}
	.who-name {
		display: grid;
		line-height: 1.3;
	}
	.who-name a {
		font-weight: 500;
		color: var(--text);
	}
	.who-name .faint {
		font-size: 12px;
	}
	.who-job {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.job-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bar {
		height: 5px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		background: #2a78d6;
		border-radius: 999px;
		transition: width 0.5s var(--ease);
	}
	.who-hour {
		color: var(--text-2);
	}
	.who-hour .faint {
		display: block;
	}
	.who-hour b {
		font-weight: 500;
		color: var(--text);
	}
	.idle-line {
		padding: 10px 20px;
		font-size: 13px;
		margin: 0;
		border-bottom: 1px solid var(--line);
	}
	.idle-line a {
		color: var(--text-2);
	}
	.sub-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 14px 20px 4px;
	}
	.sub-head h3 {
		font-size: 14px;
		font-weight: 500;
	}
	.hours-pad {
		padding: 0 20px 16px;
	}
	/* filters */
	.filters-bar {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
		padding: 14px 20px;
		margin-bottom: 18px;
		position: sticky;
		top: 0;
		z-index: 5;
	}
	.field.inline {
		min-width: 150px;
	}
	.seg {
		display: inline-flex;
		padding: 3px;
		gap: 2px;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.seg button {
		min-height: 32px;
		padding: 4px 14px;
		background: transparent;
		box-shadow: none;
		color: var(--muted);
		font-size: 13px;
	}
	.seg button.on {
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
	.small-seg button {
		min-height: 28px;
		padding: 3px 11px;
		font-size: 12.5px;
	}
	/* kpis */
	.kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 12px;
		margin-bottom: 18px;
	}
	.kpi {
		display: grid;
		gap: 3px;
		padding: 16px 18px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--panel);
	}
	.k-l {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.k-v {
		font-size: 28px;
		font-weight: 300;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}
	.k-h {
		font-size: 12.5px;
		color: var(--muted);
	}
	.chart-wrap {
		padding: 8px 20px 18px;
	}
	/* table */
	.rates {
		display: grid;
		grid-template-columns: 100px repeat(3, 1fr) auto;
		gap: 12px;
		align-items: end;
		padding: 6px 20px 16px;
	}
	.rates .span {
		grid-column: 1 / -1;
		margin: 0;
	}
	@media (max-width: 800px) {
		.rates {
			grid-template-columns: 1fr;
		}
	}
	.num {
		text-align: right;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.th {
		all: unset;
		cursor: pointer;
	}
	.th:hover {
		color: var(--accent);
	}
	.pay .who {
		display: grid;
		line-height: 1.3;
	}
	.pay .who a {
		font-weight: 500;
		color: var(--text);
	}
	.pay .who .faint {
		font-size: 12px;
	}
	.sub2 {
		display: block;
		font-size: 12px;
		color: var(--muted);
	}
	.rate span {
		display: block;
		font-size: 12.5px;
	}
	.rate .own {
		color: var(--accent);
	}
	.amt {
		font-weight: 500;
	}
	tr.dim td {
		opacity: 0.55;
	}
	tfoot td {
		background: var(--surface-2);
	}
	tr.vend td {
		font-size: 13px;
	}
	tr.grand td {
		font-weight: 500;
		border-top: 1px solid var(--line-strong);
	}
</style>

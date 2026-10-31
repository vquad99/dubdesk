<script lang="ts">
	// Video completed (approved) and the pay it earns: this month, last month, all time, last 6 months.
	import type { Earnings } from '#lib/server/analytics.ts';
	import { hm } from '#lib/hm.ts';

	let { e, self = false }: { e: Earnings; self?: boolean } = $props();

	const money = (v: number) => `${e.currency}${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
	const paid = $derived(e.rates.perMin > 0 || e.rates.perHour > 0 || e.rates.perLine > 0);
	const max = $derived(Math.max(1, ...e.months.map((m) => m.approved_min)));
	const monthName = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
	const rateText = $derived(
		[
			e.rates.perMin ? `${money(e.rates.perMin)} per minute of approved video (${money(e.rates.perMin * 60)} per video hour)` : '',
			e.rates.perHour ? `${money(e.rates.perHour)} per active hour` : '',
			e.rates.perLine ? `${money(e.rates.perLine)} per corrected line` : ''
		]
			.filter(Boolean)
			.join(' + ')
	);
</script>

<div class="earn">
	<div class="tiles">
		<div class="t main">
			<span class="l">Video completed · this month</span>
			<span class="v">{hm(e.thisMonth.approved_min)}</span>
			<span class="h">{e.thisMonth.approved} {e.thisMonth.approved === 1 ? 'video' : 'videos'} approved{paid ? ` · ${money(e.thisMonth.amount)}` : ''}</span>
		</div>
		<div class="t">
			<span class="l">Last month</span>
			<span class="v">{hm(e.lastMonth.approved_min)}</span>
			<span class="h">{e.lastMonth.approved} approved{paid ? ` · ${money(e.lastMonth.amount)}` : ''}</span>
		</div>
		<div class="t">
			<span class="l">All time</span>
			<span class="v">{hm(e.allTime.approved_min)}</span>
			<span class="h">{e.allTime.approved} approved{paid ? ` · ${money(e.allTime.amount)}` : ''}</span>
		</div>
		<div class="t wait">
			<span class="l">Waiting for approval</span>
			<span class="v">{hm(e.pendingMin)}</span>
			<span class="h">{e.pendingJobs} {e.pendingJobs === 1 ? 'video' : 'videos'} · counts once approved</span>
		</div>
	</div>

	<p class="how">
		{#if paid}<strong>How pay is worked out:</strong> {rateText}.{:else}No pay rate is set yet{self ? '; your admin sets it' : ' (Analytics → Pay rates, or Users → edit for this person)'}.{/if}
		Only video the operator has checked and approved counts.
	</p>

	<div class="months">
		<h3>Last 6 months</h3>
		<table>
			<thead><tr><th>Month</th><th class="bar-col">Video completed</th><th class="num">Videos</th>{#if paid}<th class="num">Pay</th>{/if}</tr></thead>
			<tbody>
				{#each [...e.months].reverse() as m (m.month)}
					<tr>
						<td class="nowrap">{monthName(m.month)}</td>
						<td class="bar-col">
							<div class="bar-row">
								<span class="bar"><i style="width:{Math.max(m.approved_min ? 2 : 0, (m.approved_min / max) * 100)}%"></i></span>
								<span class="bv">{hm(m.approved_min)}</span>
							</div>
						</td>
						<td class="num">{m.approved || '—'}</td>
						{#if paid}<td class="num">{m.amount ? money(m.amount) : '—'}</td>{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.earn {
		display: grid;
		gap: 16px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
		gap: 12px;
	}
	.t {
		display: grid;
		gap: 3px;
		padding: 16px 18px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--panel);
	}
	.t.main {
		background: linear-gradient(180deg, var(--accent-soft), var(--panel) 80%);
		border-color: var(--accent-line);
	}
	.t.wait {
		background: var(--surface-2);
	}
	.l {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.v {
		font-size: 28px;
		font-weight: 300;
		letter-spacing: -0.03em;
		font-variant-numeric: tabular-nums;
	}
	.h {
		font-size: 13px;
		color: var(--muted);
	}
	.how {
		margin: 0;
		font-size: 13.5px;
		color: var(--text-2);
	}
	.months {
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--panel);
		padding: 14px 18px 8px;
	}
	.months h3 {
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 4px;
	}
	table {
		width: 100%;
	}
	td,
	th {
		padding: 8px 6px;
	}
	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.nowrap {
		white-space: nowrap;
	}
	.bar-col {
		width: 55%;
	}
	.bar-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.bar {
		flex: 1;
		height: 8px;
		border-radius: 999px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.bar i {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: #2a78d6;
	}
	.bv {
		min-width: 92px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-size: 13px;
	}
</style>

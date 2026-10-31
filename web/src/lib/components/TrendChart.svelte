<script module lang="ts">
	export type Series = { key: string; name: string; values: number[] };
</script>

<script lang="ts">
	// Line chart over time. One series = the team; several = one per person (fixed colour order,
	// a person keeps their colour while others are filtered). Hover shows every value at that point.
	let {
		labels,
		series,
		format = (v: number) => String(Math.round(v)),
		tickLabel = (l: string) => l,
		tipLabel = (l: string) => l,
		colorOf
	}: {
		labels: string[];
		series: Series[];
		format?: (v: number) => string;
		tickLabel?: (l: string) => string;
		tipLabel?: (l: string) => string;
		colorOf: (key: string) => string;
	} = $props();

	const H = 240;
	const PAD = { top: 16, right: 16, bottom: 26, left: 44 };
	let width = $state(700);
	let hover = $state<number | null>(null);

	const max = $derived(Math.max(1, ...series.flatMap((s) => s.values)));
	function nice(m: number) {
		const p = 10 ** Math.floor(Math.log10(m));
		const f = m / p;
		const step = (f <= 1.5 ? 0.25 : f <= 3 ? 0.5 : f <= 7 ? 1 : 2) * p;
		return { top: Math.ceil(m / step) * step, step };
	}
	const scale = $derived(nice(max));
	const ticks = $derived(Array.from({ length: Math.round(scale.top / scale.step) + 1 }, (_, i) => i * scale.step));
	const innerW = $derived(Math.max(10, width - PAD.left - PAD.right));
	const x = (i: number) => PAD.left + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
	const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / scale.top);
	const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
	const area = (vals: number[]) => `${path(vals)}L${x(vals.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
	// Show at most ~8 x labels.
	const every = $derived(Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(innerW / 90)))));

	function move(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		const px = e.clientX - r.left;
		if (labels.length <= 1) return (hover = 0);
		hover = Math.max(0, Math.min(labels.length - 1, Math.round(((px - PAD.left) / innerW) * (labels.length - 1))));
	}
	const sorted = $derived(hover === null ? [] : [...series].sort((a, b) => b.values[hover!] - a.values[hover!]));
	const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(x(hover) - 90, 0), width - 200));
	const single = $derived(series.length === 1);
</script>

{#if labels.length === 1}
	<!-- One period only: a line needs two points, so rank the values as bars instead. -->
	{@const ranked = [...series].sort((a, b) => Number(a.key === 'other') - Number(b.key === 'other') || b.values[0] - a.values[0])}
	{@const top = Math.max(1, ...ranked.map((s) => s.values[0]))}
	<div class="rank" role="list" aria-label="{tipLabel(labels[0])}">
		<p class="rank-day">{tipLabel(labels[0])}</p>
		{#each ranked as s (s.key)}
			<div class="rank-row" role="listitem">
				<span class="rank-name"><i style="background:{colorOf(s.key)}"></i>{s.name}</span>
				<span class="rank-bar"><b style="width:{(s.values[0] / top) * 100}%; background:{colorOf(s.key)}"></b></span>
				<span class="rank-v">{format(s.values[0])}</span>
			</div>
		{/each}
	</div>
{:else}
<div class="chart" bind:clientWidth={width}>
	{#if series.length > 1}
		<ul class="legend">
			{#each series as s (s.key)}<li><i style="background:{colorOf(s.key)}"></i>{s.name}</li>{/each}
		</ul>
	{/if}
	<svg {width} height={H} role="img" aria-label="Trend chart" onpointermove={move} onpointerleave={() => (hover = null)}>
		{#each ticks as t (t)}
			<line class="grid" x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} />
			<text class="ytick" x={PAD.left - 8} y={y(t) + 4}>{format(t)}</text>
		{/each}
		{#each labels as l, i (l)}
			{#if i % every === 0}<text class="xtick" x={x(i)} y={H - 6}>{tickLabel(l)}</text>{/if}
		{/each}
		{#if single}
			<path d={area(series[0].values)} fill={colorOf(series[0].key)} opacity="0.08" />
		{/if}
		{#each series as s (s.key)}
			<path d={path(s.values)} fill="none" stroke={colorOf(s.key)} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
		{/each}
		{#if labels.length <= 31}
			{#each series as s (s.key)}
				{#each s.values as v, i (i)}
					{#if v > 0 && (single || hover === i || labels.length <= 2)}<circle cx={x(i)} cy={y(v)} r="3.5" fill={colorOf(s.key)} stroke="var(--panel)" stroke-width="2" />{/if}
				{/each}
			{/each}
		{/if}
		{#if hover !== null}
			<line class="cross" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
			{#if labels.length > 31}
				{#each series as s (s.key)}<circle cx={x(hover)} cy={y(s.values[hover])} r="4" fill={colorOf(s.key)} stroke="var(--panel)" stroke-width="2" />{/each}
			{/if}
		{/if}
	</svg>
	{#if hover !== null}
		<div class="tip" style="left:{tipLeft}px">
			<strong>{tipLabel(labels[hover])}</strong>
			{#each sorted.slice(0, 10) as s (s.key)}
				<span class="row"><i style="background:{colorOf(s.key)}"></i><span class="nm">{s.name}</span><b>{format(s.values[hover])}</b></span>
			{/each}
			{#if series.length > 1}
				<span class="row total"><span class="nm">Total</span><b>{format(series.reduce((a, s) => a + s.values[hover!], 0))}</b></span>
			{/if}
		</div>
	{/if}
</div>
{/if}

<style>
	.rank {
		display: grid;
		gap: 8px;
	}
	.rank-day {
		margin: 0 0 4px;
		font-size: 13px;
		color: var(--muted);
	}
	.rank-row {
		display: grid;
		grid-template-columns: minmax(120px, 200px) 1fr 70px;
		gap: 12px;
		align-items: center;
		font-size: 13.5px;
	}
	.rank-name {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--text-2);
	}
	.rank-name i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	.rank-bar {
		height: 10px;
		border-radius: 999px;
		background: var(--surface-2);
		overflow: hidden;
	}
	.rank-bar b {
		display: block;
		height: 100%;
		border-radius: 0 4px 4px 0;
	}
	.rank-v {
		text-align: right;
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--line);
		stroke-width: 1;
	}
	.ytick,
	.xtick {
		font-size: 11px;
		fill: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.ytick {
		text-anchor: end;
	}
	.xtick {
		text-anchor: middle;
	}
	.cross {
		stroke: var(--line-strong);
		stroke-width: 1;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
		font-size: 12.5px;
		color: var(--text-2);
	}
	.legend li,
	.row {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend i,
	.row i {
		width: 10px;
		height: 10px;
		border-radius: 3px;
		flex: none;
	}
	.tip {
		position: absolute;
		top: 30px;
		width: 200px;
		padding: 10px 12px;
		display: grid;
		gap: 4px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow-2);
		font-size: 12.5px;
		pointer-events: none;
		z-index: 2;
	}
	.tip strong {
		font-weight: 500;
		margin-bottom: 2px;
	}
	.row .nm {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-2);
	}
	.row b {
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.row.total {
		border-top: 1px solid var(--line);
		padding-top: 4px;
		margin-top: 2px;
	}
</style>

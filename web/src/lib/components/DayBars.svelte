<script lang="ts">
	// One series: active minutes per day. Lines edited and actions ride along in the tooltip
	// (a second measure never gets its own axis).
	type Day = { day: string; minutes: number; edits: number; actions: number };
	let { days }: { days: Day[] } = $props();

	const H = 150;
	const PAD_TOP = 14;
	let width = $state(600);
	let hover = $state<number | null>(null);

	const max = $derived(Math.max(10, ...days.map((d) => d.minutes)));
	const step = $derived(max <= 30 ? 10 : max <= 60 ? 15 : max <= 180 ? 30 : 60);
	const top = $derived(Math.ceil(max / step) * step);
	const ticks = $derived(Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step));
	const slot = $derived(width / Math.max(1, days.length));
	const bw = $derived(Math.max(4, Math.min(24, slot - 4)));
	const y = (v: number) => PAD_TOP + (H - PAD_TOP) * (1 - v / top);
	const label = (d: string) => new Date(d + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
	const total = $derived(days.reduce((s, d) => s + d.minutes, 0));
</script>

<div class="chart" bind:clientWidth={width}>
	<svg {width} height={H + 22} role="img" aria-label="Active minutes per day for the last 30 days, {total} minutes in total">
		{#each ticks as t (t)}
			<line x1="0" x2={width} y1={y(t) + 0.5} y2={y(t) + 0.5} class="grid" />
			<text x="0" y={y(t) - 4} class="tick">{t === 0 ? '' : `${t} min`}</text>
		{/each}
		{#each days as d, i (d.day)}
			{@const x = i * slot + (slot - bw) / 2}
			{@const h = (H - PAD_TOP) * (d.minutes / top)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
				<rect x={i * slot} y="0" width={slot} height={H} fill="transparent" />
				{#if d.minutes > 0}
					<path
						class="bar"
						class:dim={hover !== null && hover !== i}
						d="M{x},{H} V{H - h + Math.min(4, h)} q0,-{Math.min(4, h)} {Math.min(4, h)},-{Math.min(4, h)} H{x + bw - Math.min(4, h)} q{Math.min(4, h)},0 {Math.min(4, h)},{Math.min(4, h)} V{H} Z"
					/>
				{:else}
					<rect x={x} y={H - 2} width={bw} height="2" rx="1" class="zero" />
				{/if}
			</g>
		{/each}
		<line x1="0" x2={width} y1={H + 0.5} y2={H + 0.5} class="base" />
		{#each days as d, i (d.day)}
			{#if (i % 7 === 0 && i < days.length - 4) || i === days.length - 1}
				<text x={i * slot + slot / 2} y={H + 16} class="tick" text-anchor="middle">{label(d.day)}</text>
			{/if}
		{/each}
	</svg>
	{#if hover !== null}
		{@const d = days[hover]}
		<div class="tip" style:left="{Math.min(width - 150, Math.max(0, hover * slot + slot / 2 - 75))}px">
			<strong>{label(d.day)}</strong>
			<span><i class="sw"></i>{d.minutes} min working</span>
			<span>{d.edits} line changes · {d.actions} actions</span>
		</div>
	{/if}
	<table class="sr">
		<caption>Active minutes per day</caption>
		<thead><tr><th>Day</th><th>Minutes</th><th>Line changes</th><th>Actions</th></tr></thead>
		<tbody>
			{#each days as d (d.day)}<tr><td>{d.day}</td><td>{d.minutes}</td><td>{d.edits}</td><td>{d.actions}</td></tr>{/each}
		</tbody>
	</table>
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.grid {
		stroke: #f0f0ef;
		stroke-width: 1;
	}
	.base {
		stroke: #e0e0dd;
		stroke-width: 1;
	}
	.tick {
		fill: var(--muted);
		font-size: 11px;
		font-family: var(--font);
	}
	.bar {
		fill: #6a88e2;
		transition: opacity 0.15s;
	}
	.bar.dim {
		opacity: 0.45;
	}
	.zero {
		fill: #e6e6e4;
	}
	.tip {
		position: absolute;
		top: -6px;
		width: 150px;
		display: grid;
		gap: 2px;
		padding: 8px 10px;
		border-radius: 10px;
		background: #fff;
		box-shadow: var(--shadow-3);
		font-size: 12.5px;
		color: var(--text-2);
		pointer-events: none;
	}
	.tip strong {
		color: var(--text);
		font-weight: 500;
	}
	.sw {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
		background: #6a88e2;
		margin-right: 6px;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
	}
</style>

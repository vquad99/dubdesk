<script lang="ts">
	// Last 24 hours, one bar per hour: lines checked. Hover shows the hour's other figures.
	type Hour = { hour: string; checked: number; corrected: number; active_min: number; people: number };
	let { hours }: { hours: Hour[] } = $props();

	const H = 150;
	const TOP = 12;
	const BOTTOM = 22;
	let width = $state(600);
	let hover = $state<number | null>(null);

	const max = $derived(Math.max(4, ...hours.map((h) => h.checked)));
	// About four gridlines whatever the size: 1, 2 or 5 times a power of ten.
	const step = $derived.by(() => {
		const raw = max / 4;
		const p = 10 ** Math.floor(Math.log10(raw));
		const f = raw / p;
		return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
	});
	const top = $derived(Math.ceil(max / step) * step);
	const ticks = $derived(Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step));
	// Room for the widest y label (e.g. "2000").
	const LEFT = $derived(14 + String(top).length * 7);
	const slot = $derived((width - LEFT) / Math.max(1, hours.length));
	const bw = $derived(Math.max(4, Math.min(22, slot - 4)));
	const y = (v: number) => TOP + (H - TOP - BOTTOM) * (1 - v / top);
	const hh = (h: string) => Number(h.slice(11, 13));
	const ampm = (n: number) => (n === 0 ? '12a' : n < 12 ? `${n}a` : n === 12 ? '12p' : `${n - 12}p`);
	const label = (h: string) => ampm(hh(h));
	const tipLeft = $derived(hover === null ? 0 : Math.min(Math.max(LEFT + hover * slot - 70, 0), width - 170));
</script>

<div class="hours" bind:clientWidth={width}>
	<svg {width} height={H} role="img" aria-label="Lines checked per hour, last 24 hours">
		{#each ticks as t (t)}
			<line class="grid" x1={LEFT} x2={width} y1={y(t)} y2={y(t)} />
			<text class="ytick" x={LEFT - 6} y={y(t) + 4}>{t}</text>
		{/each}
		{#each hours as h, i (h.hour)}
			{@const x = LEFT + i * slot + (slot - bw) / 2}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)}>
				<rect class="hit" x={LEFT + i * slot} y={TOP} width={slot} height={H - TOP - BOTTOM} />
				{#if h.checked > 0}
					<path class="bar" class:now={i === hours.length - 1} class:on={hover === i}
						d="M{x},{y(0)} V{y(h.checked) + Math.min(4, (y(0) - y(h.checked)) / 2)} q0,-4 4,-4 h{bw - 8} q4,0 4,4 V{y(0)} Z" />
				{:else if h.active_min > 0}
					<rect class="idle" x={x} y={y(0) - 2} width={bw} height="2" rx="1" />
				{/if}
				{#if i % 3 === 0 || i === hours.length - 1}<text class="xtick" x={LEFT + i * slot + slot / 2} y={H - 6}>{i === hours.length - 1 ? 'now' : label(h.hour)}</text>{/if}
			</g>
		{/each}
	</svg>
	{#if hover !== null}
		{@const h = hours[hover]}
		<div class="tip" style="left:{tipLeft}px">
			<strong>{label(h.hour)} – {ampm((hh(h.hour) + 1) % 24)}</strong>
			<span><b>{h.checked}</b> lines checked</span>
			<span><b>{h.corrected}</b> lines corrected</span>
			<span><b>{Math.round(h.active_min)}</b> active minutes</span>
			<span><b>{h.people}</b> {h.people === 1 ? 'person' : 'people'} working</span>
		</div>
	{/if}
</div>

<style>
	.hours {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
	}
	.grid {
		stroke: var(--line);
	}
	.ytick,
	.xtick {
		font-size: 11px;
		fill: var(--muted);
	}
	.ytick {
		text-anchor: end;
	}
	.xtick {
		text-anchor: middle;
	}
	.hit {
		fill: transparent;
	}
	.bar {
		fill: #2a78d6;
		opacity: 0.85;
		transition: opacity 0.15s;
	}
	.bar.now {
		fill: #1c5cab;
	}
	.bar.on {
		opacity: 1;
	}
	.idle {
		fill: #86b6ef;
	}
	.tip {
		position: absolute;
		top: 0;
		width: 170px;
		padding: 10px 12px;
		display: grid;
		gap: 2px;
		background: var(--panel);
		border: 1px solid var(--line);
		border-radius: 12px;
		box-shadow: var(--shadow-2);
		font-size: 12.5px;
		color: var(--text-2);
		pointer-events: none;
	}
	.tip strong {
		color: var(--text);
		font-weight: 500;
		margin-bottom: 2px;
	}
	.tip b {
		color: var(--text);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
</style>

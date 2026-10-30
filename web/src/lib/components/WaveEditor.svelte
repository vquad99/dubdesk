<script lang="ts" module>
	export type WaveLine = {
		id: number;
		n: number;
		start: number;
		end: number;
		text: string;
		state: 'plain' | 'edited' | 'flagged' | 'checked';
	};
	export type Peaks = { rate: number; data: Int8Array };

	/** Parse the server's peaks file: "PK01", uint32 rate, then int8 [min, max] pairs. */
	export function parsePeaks(buf: ArrayBuffer): Peaks | null {
		if (buf.byteLength < 8) return null;
		const head = new TextDecoder().decode(new Uint8Array(buf, 0, 4));
		if (head !== 'PK01') return null;
		return { rate: new DataView(buf).getUint32(4, true), data: new Int8Array(buf, 8) };
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { duration as fmt } from '#lib/format.ts';

	let {
		peaks = null,
		length,
		lines,
		time,
		selected = null,
		playing = false,
		editable = true,
		zoom = $bindable(80),
		range = $bindable(null),
		onseek,
		onselect,
		onpreview,
		oncommit
	}: {
		peaks?: Peaks | null;
		length: number;
		lines: WaveLine[];
		time: number;
		selected?: number | null;
		playing?: boolean;
		editable?: boolean;
		zoom?: number; // pixels per second
		range?: { start: number; end: number } | null; // free selection on empty audio
		onseek: (t: number) => void;
		onselect: (id: number) => void;
		onpreview: (id: number, start: number, end: number) => void;
		oncommit: (id: number, start: number, end: number) => void;
	} = $props();

	const MIN = 0.1;
	const EDGE_PX = 7;

	let box = $state<HTMLDivElement>();
	let canvas = $state<HTMLCanvasElement>();
	let width = $state(800);
	const HEIGHT = 150;
	let viewStart = $state(0);

	const total = $derived(Math.max(length, ...lines.map((l) => l.end), 1));
	const viewLen = $derived(width / zoom);
	const maxStart = $derived(Math.max(0, total - viewLen));
	const x = (t: number) => (t - viewStart) * zoom;
	const tAt = (px: number) => viewStart + px / zoom;
	const visible = $derived(lines.filter((l) => l.end >= viewStart && l.start <= viewStart + viewLen));

	export function fit() {
		zoom = Math.max(2, width / total);
		viewStart = 0;
	}
	export function zoomBy(f: number, aroundT?: number) {
		const at = aroundT ?? time;
		const px = x(at);
		zoom = Math.min(800, Math.max(Math.max(2, width / total), zoom * f));
		viewStart = Math.min(Math.max(0, at - px / zoom), Math.max(0, total - width / zoom));
	}
	export function reveal(t: number) {
		if (t < viewStart || t > viewStart + viewLen) viewStart = Math.min(maxStart, Math.max(0, t - viewLen * 0.25));
	}

	// Follow the play head while playing.
	$effect(() => {
		if (playing && (time > viewStart + viewLen * 0.9 || time < viewStart)) {
			viewStart = Math.min(maxStart, Math.max(0, time - viewLen * 0.1));
		}
	});

	// ---------- drawing ----------
	function draw() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(HEIGHT * dpr);
		const g = canvas.getContext('2d')!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, width, HEIGHT);

		// second grid
		const step = zoom > 120 ? 1 : zoom > 30 ? 5 : zoom > 8 ? 15 : 60;
		g.strokeStyle = 'rgba(0,0,0,0.05)';
		g.lineWidth = 1;
		for (let s = Math.ceil(viewStart / step) * step; s < viewStart + viewLen; s += step) {
			const px = Math.round(x(s)) + 0.5;
			g.beginPath();
			g.moveTo(px, 0);
			g.lineTo(px, HEIGHT);
			g.stroke();
		}
		const mid = HEIGHT / 2;
		g.strokeStyle = 'rgba(0,0,0,0.08)';
		g.beginPath();
		g.moveTo(0, mid + 0.5);
		g.lineTo(width, mid + 0.5);
		g.stroke();

		if (!peaks) return;
		const { rate, data } = peaks;
		const count = data.length / 2;
		// colour per pixel: selected line orange, other lines indigo, gaps grey
		const sorted = visible;
		let k = 0;
		for (let px = 0; px < width; px++) {
			const t0 = tAt(px);
			const t1 = tAt(px + 1);
			let i0 = Math.floor(t0 * rate);
			let i1 = Math.max(i0 + 1, Math.floor(t1 * rate));
			if (i1 <= 0 || i0 >= count) continue;
			i0 = Math.max(0, i0);
			i1 = Math.min(count, i1);
			let lo = 127;
			let hi = -128;
			for (let i = i0; i < i1; i++) {
				const a = data[i * 2];
				const b = data[i * 2 + 1];
				if (a < lo) lo = a;
				if (b > hi) hi = b;
			}
			while (k < sorted.length && sorted[k].end < t0) k++;
			const line = k < sorted.length && sorted[k].start <= t0 ? sorted[k] : null;
			g.fillStyle = !line ? '#c9c9c5' : line.id === selected ? '#f9730c' : line.state === 'flagged' ? '#c43d2b' : '#6a88e2';
			const y0 = mid - (hi / 128) * (mid - 6);
			const y1 = mid - (lo / 128) * (mid - 6);
			g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
		}
	}
	$effect(() => {
		// redraw on any of these
		void [peaks, zoom, viewStart, width, selected, lines.map((l) => `${l.start},${l.end},${l.state}`).join()];
		draw();
	});

	onMount(() => {
		const ro = new ResizeObserver(([e]) => (width = Math.max(200, e.contentRect.width)));
		if (box) ro.observe(box);
		return () => ro.disconnect();
	});

	// ---------- pointer ----------
	type Drag = { id: number; mode: 'start' | 'end' | 'move'; t0: number; s0: number; e0: number; lo: number; hi: number; moved: boolean };
	let drag = $state<Drag | null>(null);
	let free = $state<{ t0: number; moved: boolean } | null>(null);
	let hover = $state<{ id: number; mode: 'start' | 'end' | 'move' } | null>(null);

	function bounds(id: number) {
		const i = lines.findIndex((l) => l.id === id);
		return { lo: i > 0 ? lines[i - 1].end : 0, hi: i < lines.length - 1 ? lines[i + 1].start : total };
	}
	function hit(px: number): { id: number; mode: 'start' | 'end' | 'move' } | null {
		for (const l of visible) {
			const a = x(l.start);
			const b = x(l.end);
			if (editable && Math.abs(px - a) <= EDGE_PX) return { id: l.id, mode: 'start' };
			if (editable && Math.abs(px - b) <= EDGE_PX) return { id: l.id, mode: 'end' };
			if (px > a && px < b) return { id: l.id, mode: 'move' };
		}
		return null;
	}
	const localX = (e: PointerEvent) => e.clientX - (box?.getBoundingClientRect().left ?? 0);

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		const px = localX(e);
		const h = hit(px);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (h) {
			const l = lines.find((q) => q.id === h.id)!;
			onselect(l.id);
			drag = { id: l.id, mode: h.mode, t0: tAt(px), s0: l.start, e0: l.end, ...bounds(l.id), moved: false };
		} else {
			free = { t0: tAt(px), moved: false };
			range = null;
		}
	}
	function move(e: PointerEvent) {
		const px = localX(e);
		if (!drag && !free) {
			hover = hit(px);
			return;
		}
		const t = Math.min(total, Math.max(0, tAt(px)));
		if (free) {
			if (Math.abs(t - free.t0) * zoom > 4) free.moved = true;
			if (free.moved) range = { start: Math.min(free.t0, t), end: Math.max(free.t0, t) };
			return;
		}
		if (!drag || !editable) return;
		const d = t - drag.t0;
		if (Math.abs(d) * zoom > 3) drag.moved = true;
		if (!drag.moved) return;
		let s = drag.s0;
		let en = drag.e0;
		if (drag.mode === 'start') s = Math.min(Math.max(drag.lo, drag.s0 + d), drag.e0 - MIN);
		else if (drag.mode === 'end') en = Math.max(Math.min(drag.hi, drag.e0 + d), drag.s0 + MIN);
		else {
			const len = drag.e0 - drag.s0;
			s = Math.min(Math.max(drag.lo, drag.s0 + d), drag.hi - len);
			en = s + len;
		}
		onpreview(drag.id, round(s), round(en));
	}
	function up(e: PointerEvent) {
		const px = localX(e);
		if (drag) {
			const l = lines.find((q) => q.id === drag!.id);
			if (drag.moved && l && (l.start !== drag.s0 || l.end !== drag.e0)) oncommit(l.id, l.start, l.end);
			else onseek(tAt(px));
		} else if (free && !free.moved) onseek(tAt(px));
		drag = null;
		free = null;
	}
	const round = (t: number) => Math.round(t * 1000) / 1000;

	function wheel(e: WheelEvent) {
		e.preventDefault();
		if (e.ctrlKey || e.metaKey) {
			zoomBy(e.deltaY < 0 ? 1.25 : 0.8, tAt(e.clientX - (box?.getBoundingClientRect().left ?? 0)));
		} else {
			const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / zoom;
			viewStart = Math.min(maxStart, Math.max(0, viewStart + d));
		}
	}

	const cursor = $derived(
		drag ? (drag.mode === 'move' ? 'grabbing' : 'ew-resize') : hover ? (hover.mode === 'move' ? (editable ? 'grab' : 'pointer') : 'ew-resize') : 'crosshair'
	);
	const ticks = $derived.by(() => {
		const step = zoom > 120 ? 1 : zoom > 30 ? 5 : zoom > 8 ? 15 : 60;
		const out: number[] = [];
		for (let s = Math.ceil(viewStart / step) * step; s <= viewStart + viewLen; s += step) out.push(s);
		return out;
	});
</script>

<div class="wave" bind:this={box}>
	<div class="ruler">
		{#each ticks as t (t)}<span style:left="{x(t)}px" style:transform={x(t) < 24 ? "none" : "translateX(-50%)"}>{fmt(t)}</span>{/each}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="area"
		style:height="{HEIGHT}px"
		style:cursor
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointerleave={() => (hover = null)}
		onwheel={wheel}
	>
		<canvas bind:this={canvas} style:width="{width}px" style:height="{HEIGHT}px"></canvas>
		{#if !peaks}<div class="nowave">No audio waveform yet — it appears once the video is uploaded.</div>{/if}

		{#if range}
			<div class="range" style:left="{x(range.start)}px" style:width="{(range.end - range.start) * zoom}px"></div>
		{/if}

		{#each visible as l (l.id)}
			<div
				class="region {l.state}"
				class:sel={l.id === selected}
				class:dragging={drag?.id === l.id && drag.moved}
				style:left="{x(l.start)}px"
				style:width="{Math.max(2, (l.end - l.start) * zoom)}px"
			>
				{#if (l.end - l.start) * zoom > 40}
					<span class="txt" lang="hi">{l.text}</span>
					<span class="foot">#{l.n} &nbsp;{(l.end - l.start).toFixed(2)}s</span>
				{/if}
				{#if editable}<i class="h l"></i><i class="h r"></i>{/if}
			</div>
		{/each}

		<div class="head" style:left="{x(time)}px"></div>
	</div>
	<input
		class="pan"
		type="range"
		min="0"
		max={maxStart}
		step="0.01"
		bind:value={viewStart}
		aria-label="Scroll the waveform"
		disabled={maxStart <= 0}
	/>
</div>

<style>
	.wave {
		display: grid;
		gap: 4px;
		user-select: none;
		-webkit-user-select: none;
	}
	.ruler {
		position: relative;
		height: 16px;
		overflow: hidden;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--muted);
	}
	.ruler span {
		position: absolute;
		white-space: nowrap;
	}
	.area {
		position: relative;
		overflow: hidden;
		border-radius: 12px;
		background: linear-gradient(180deg, #fcfcfb, #f6f6f4);
		box-shadow: inset 0 0 0 1px var(--line);
		touch-action: none;
	}
	canvas {
		position: absolute;
		inset: 0;
		display: block;
	}
	.nowave {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--faint);
		font-size: 13px;
		pointer-events: none;
	}
	.range {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(51, 51, 204, 0.08);
		border-left: 1px dashed var(--accent);
		border-right: 1px dashed var(--accent);
		pointer-events: none;
	}
	.region {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(106, 136, 226, 0.07);
		border-left: 1px solid rgba(106, 136, 226, 0.55);
		border-right: 1px solid rgba(106, 136, 226, 0.55);
		pointer-events: none;
		overflow: hidden;
	}
	.region.checked {
		background: rgba(131, 192, 64, 0.08);
		border-color: rgba(110, 163, 53, 0.6);
	}
	.region.edited {
		background: rgba(249, 115, 12, 0.06);
	}
	.region.flagged {
		background: rgba(196, 61, 43, 0.07);
		border-color: rgba(196, 61, 43, 0.55);
	}
	.region.sel {
		background: rgba(249, 115, 12, 0.1);
		border-left: 2px solid var(--orange);
		border-right: 2px solid var(--orange);
	}
	.region.dragging {
		background: rgba(249, 115, 12, 0.16);
	}
	.txt {
		position: absolute;
		top: 6px;
		left: 8px;
		right: 8px;
		font-family: 'Noto Sans Devanagari', var(--font);
		font-size: 12px;
		line-height: 1.35;
		color: var(--text-2);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-shadow: 0 0 3px #fff, 0 0 3px #fff;
	}
	.foot {
		position: absolute;
		bottom: 5px;
		left: 8px;
		font-family: var(--mono);
		font-size: 10.5px;
		color: var(--muted);
		white-space: nowrap;
		text-shadow: 0 0 3px #fff;
	}
	.h {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 26px;
		margin-top: -13px;
		border-radius: 3px;
		background: rgba(106, 136, 226, 0.6);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.h.l {
		left: -1px;
	}
	.h.r {
		right: -1px;
	}
	.region.sel .h {
		opacity: 1;
		background: var(--orange);
	}
	.head {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: #c43d2b;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.6);
		pointer-events: none;
	}
	.head::before {
		content: '';
		position: absolute;
		top: -1px;
		left: -5px;
		border: 6px solid transparent;
		border-top-color: #c43d2b;
	}
	.pan {
		width: 100%;
		height: 6px;
		padding: 0;
		margin: 2px 0 0;
		accent-color: var(--slate);
		background: transparent;
		border: none;
	}
	.pan:hover {
		background: transparent;
	}
</style>

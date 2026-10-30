<script lang="ts">
	import { Play, Pause, RotateCcw, RotateCw, Maximize, Film } from '@lucide/svelte';
	import { duration as fmt } from '#lib/format.ts';

	let {
		src = null,
		length = 0,
		time = $bindable(0),
		playing = $bindable(false),
		rate = $bindable(1),
		controls = true,
		fill = false,
		emptyText = 'No video file yet.'
	}: {
		fill?: boolean;
		src?: string | null;
		length?: number;
		time?: number;
		playing?: boolean;
		rate?: number;
		controls?: boolean;
		emptyText?: string;
	} = $props();

	let video = $state<HTMLVideoElement>();
	let frame = $state<HTMLDivElement>();
	let total = $derived(video?.duration && isFinite(video.duration) ? video.duration : length);

	// With no file, a clock stands in for the video so lines still follow the time.
	let raf = 0;
	let last = 0;
	function tick(now: number) {
		if (!playing || src) return;
		time = Math.min(total, time + ((now - last) / 1000) * rate);
		last = now;
		if (time >= total) playing = false;
		else raf = requestAnimationFrame(tick);
	}
	$effect(() => {
		if (src) return;
		if (playing) {
			last = performance.now();
			raf = requestAnimationFrame(tick);
		}
		return () => cancelAnimationFrame(raf);
	});

	$effect(() => {
		if (!video) return;
		video.playbackRate = rate;
		if (playing && video.paused) video.play().catch(() => (playing = false));
		if (!playing && !video.paused) video.pause();
	});

	export function seek(t: number) {
		time = Math.max(0, Math.min(total || t, t));
		if (video) video.currentTime = time;
	}
	export function fullScreen() {
		frame?.requestFullscreen?.();
	}
	export function toggle() {
		if (!playing && time >= total) seek(0);
		playing = !playing;
	}

	function fullscreen() {
		frame?.requestFullscreen?.();
	}
</script>

<div class="player" class:fill bind:this={frame}>
	<div class="screen">
		{#if src}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={video}
				{src}
				preload="metadata"
				ontimeupdate={() => video && (time = video.currentTime)}
				onended={() => (playing = false)}
				onclick={toggle}
			></video>
		{:else}
			<div class="empty">
				<Film size={28} />
				<p>{emptyText}</p>
				<span>Preview clock runs so lines still follow play.</span>
			</div>
		{/if}
	</div>

	{#if controls}<div class="controls">
		<button type="button" class="icon" aria-label="Back 5 seconds" onclick={() => seek(time - 5)}><RotateCcw size={16} /></button>
		<button type="button" class="play" aria-label={playing ? 'Pause' : 'Play'} onclick={toggle}>
			{#if playing}<Pause size={18} />{:else}<Play size={18} />{/if}
		</button>
		<button type="button" class="icon" aria-label="Forward 5 seconds" onclick={() => seek(time + 5)}><RotateCw size={16} /></button>
		<span class="time">{fmt(time)} / {fmt(total)}</span>
		<input
			class="scrub"
			type="range"
			min="0"
			max={total || 0}
			step="0.1"
			value={time}
			aria-label="Position"
			oninput={(e) => seek(Number((e.target as HTMLInputElement).value))}
		/>
		<select bind:value={rate} aria-label="Speed">
			<option value={0.75}>0.75×</option>
			<option value={1}>1×</option>
			<option value={1.25}>1.25×</option>
			<option value={1.5}>1.5×</option>
		</select>
		{#if src}<button type="button" class="icon" aria-label="Full screen" onclick={fullscreen}><Maximize size={16} /></button>{/if}
	</div>{/if}
</div>

<style>
	.player {
		display: grid;
		gap: 10px;
	}
	.screen {
		aspect-ratio: 16 / 9;
		border-radius: 14px;
		overflow: hidden;
		background: #141414;
	}
	video {
		width: 100%;
		height: 100%;
		display: block;
		cursor: pointer;
		object-fit: contain;
	}
	.fill {
		height: 100%;
		grid-template-rows: minmax(0, 1fr) auto;
	}
	.fill .screen {
		aspect-ratio: auto;
		height: 100%;
		border-radius: 12px;
	}
	.empty {
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 6px;
		color: #b3b3b3;
		text-align: center;
		padding: 16px;
	}
	.empty p {
		margin: 4px 0 0;
		color: #e6e6e6;
		font-size: 14px;
	}
	.empty span {
		font-size: 12px;
		color: #999;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.controls button {
		min-height: 0;
		box-shadow: none;
	}
	.icon {
		padding: 8px;
		background: transparent;
	}
	.icon:hover {
		background: var(--surface-2);
	}
	.play {
		width: 38px;
		height: 38px;
		padding: 0;
		display: grid;
		place-items: center;
		background: var(--slate);
		color: #fff;
	}
	.play:hover {
		background: #1f2127;
	}
	.time {
		font-family: ui-monospace, Menlo, monospace;
		font-size: 12.5px;
		color: var(--muted);
		white-space: nowrap;
		margin: 0 4px;
	}
	.scrub {
		flex: 1;
		min-width: 30px;
		padding: 0;
		border: none;
		accent-color: var(--slate);
		height: 4px;
	}
	select {
		flex: none;
		padding: 4px 22px 4px 8px;
		background-position: right 6px center;
		font-size: 12.5px;
		border-radius: 8px;
	}
</style>

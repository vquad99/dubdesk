<script lang="ts">
	import { Play, Pause, RotateCcw, RotateCw, Maximize, Film, Headphones } from '@lucide/svelte';
	import { duration as fmt } from '#lib/format.ts';

	let {
		src = null,
		audioSrc = null,
		audioOnly = false,
		watermark = '',
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
		/** Sound-only file; used instead of the video when audioOnly is on (far less data). */
		audioSrc?: string | null;
		audioOnly?: boolean;
		/** Faint text over the picture (the viewer's name), so a screen recording can be traced. */
		watermark?: string;
		length?: number;
		time?: number;
		playing?: boolean;
		rate?: number;
		controls?: boolean;
		emptyText?: string;
	} = $props();

	let media = $state<HTMLMediaElement>();
	let frame = $state<HTMLDivElement>();
	let buffering = $state(false);
	const soundOnly = $derived(audioOnly && !!audioSrc);
	const url = $derived(soundOnly ? audioSrc : src);
	let total = $derived(media?.duration && isFinite(media.duration) ? media.duration : length);

	// With no file, a clock stands in for the video so lines still follow the time.
	let raf = 0;
	let last = 0;
	function tick(now: number) {
		if (!playing || url) return;
		time = Math.min(total, time + ((now - last) / 1000) * rate);
		last = now;
		if (time >= total) playing = false;
		else raf = requestAnimationFrame(tick);
	}
	$effect(() => {
		if (url) return;
		if (playing) {
			last = performance.now();
			raf = requestAnimationFrame(tick);
		}
		return () => cancelAnimationFrame(raf);
	});

	// While playing, read the position every frame (smooth play head; timeupdate is only ~4/s).
	let frameLoop = 0;
	function follow() {
		if (media && !media.paused) {
			time = media.currentTime;
			frameLoop = requestAnimationFrame(follow);
		}
	}

	$effect(() => {
		if (!media) return;
		media.playbackRate = rate;
		if (playing && media.paused) media.play().then(() => (frameLoop = requestAnimationFrame(follow))).catch(() => (playing = false));
		if (!playing && !media.paused) media.pause();
		return () => cancelAnimationFrame(frameLoop);
	});

	// Switching Original / Dubbed / Sound only keeps the place and the play state.
	function restore() {
		if (!media) return;
		if (Math.abs(media.currentTime - time) > 0.05) media.currentTime = time;
		media.playbackRate = rate;
		if (playing) media.play().then(() => (frameLoop = requestAnimationFrame(follow))).catch(() => (playing = false));
	}

	export function seek(t: number) {
		time = Math.max(0, Math.min(total || t, t));
		if (media) media.currentTime = time;
	}
	export function fullScreen() {
		frame?.requestFullscreen?.();
	}
	export function toggle() {
		if (!playing && time >= total) seek(0);
		playing = !playing;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="player" class:fill bind:this={frame} oncontextmenu={(e) => e.preventDefault()}>
	<div class="screen">
		{#if soundOnly}
			<!-- svelte-ignore a11y_media_has_caption -->
			<audio
				bind:this={media}
				src={url}
				preload="auto"
				onloadedmetadata={restore}
				ontimeupdate={() => media && (time = media.currentTime)}
				onwaiting={() => (buffering = true)}
				onplaying={() => (buffering = false)}
				onended={() => (playing = false)}
			></audio>
			<button type="button" class="sound" onclick={toggle}>
				<span class="pulse" class:on={playing}><Headphones size={30} /></span>
				<strong>Sound only</strong>
				<span>Saving data: about a tenth of the video. Turn off to see the picture.</span>
			</button>
		{:else if url}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				bind:this={media}
				src={url}
				preload="metadata"
				playsinline
				disablepictureinpicture
				controlslist="nodownload noremoteplayback"
				onloadedmetadata={restore}
				ontimeupdate={() => media && (time = media.currentTime)}
				onwaiting={() => (buffering = true)}
				onplaying={() => (buffering = false)}
				onended={() => (playing = false)}
				onclick={toggle}
			></video>
			{#if watermark}
				<div class="mark" aria-hidden="true">
					{#each Array(6) as _, i (i)}<span>{watermark}</span>{/each}
				</div>
			{/if}
		{:else}
			<div class="empty">
				<Film size={28} />
				<p>{emptyText}</p>
				<span>Preview clock runs so lines still follow play.</span>
			</div>
		{/if}
		{#if buffering && playing}<span class="buffer" aria-label="Loading"></span>{/if}
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
		{#if url}<button type="button" class="icon" aria-label="Full screen" onclick={fullScreen}><Maximize size={16} /></button>{/if}
	</div>{/if}
</div>

<style>
	.player {
		display: grid;
		gap: 10px;
	}
	.screen {
		position: relative;
		aspect-ratio: 16 / 9;
		border-radius: 14px;
		overflow: hidden;
		background: #141414;
	}
	.mark {
		position: absolute;
		inset: -20%;
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		align-content: space-around;
		justify-items: center;
		transform: rotate(-24deg);
		pointer-events: none;
		user-select: none;
	}
	.mark span {
		font-size: 13px;
		letter-spacing: 0.04em;
		color: rgba(255, 255, 255, 0.11);
		text-shadow: 0 0 1px rgba(0, 0, 0, 0.15);
		white-space: nowrap;
	}
	.sound {
		width: 100%;
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 8px;
		border-radius: 0;
		background:
			radial-gradient(ellipse 60% 70% at 50% 40%, rgba(106, 136, 226, 0.25), transparent 70%),
			#141414;
		color: #e6e6e6;
		box-shadow: none;
		text-align: center;
		white-space: normal;
	}
	.sound:hover {
		background:
			radial-gradient(ellipse 60% 70% at 50% 40%, rgba(106, 136, 226, 0.32), transparent 70%),
			#141414;
		color: #fff;
	}
	.sound strong {
		font-weight: 500;
		font-size: 15px;
	}
	.sound > span:last-child {
		font-size: 12px;
		color: #999;
		max-width: 280px;
	}
	.pulse {
		display: grid;
		place-items: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.06);
	}
	.pulse.on {
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			box-shadow: 0 0 0 12px rgba(106, 136, 226, 0.12);
		}
	}
	.buffer {
		position: absolute;
		top: 50%;
		left: 50%;
		width: 34px;
		height: 34px;
		margin: -17px 0 0 -17px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		animation: spin 0.8s linear infinite;
		pointer-events: none;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
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

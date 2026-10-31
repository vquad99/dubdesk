<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import {
		ArrowLeft,
		Check,
		CircleCheck,
		ExternalLink,
		Cloud,
		CloudOff,
		Keyboard,
		LoaderCircle,
		Play,
		Replace,
		RotateCcw,
		Send,
		Undo2,
		TriangleAlert,
		ZoomIn,
		ZoomOut,
		Maximize2,
		Scissors,
		Merge,
		Plus,
		Trash2,
		ChevronsLeft,
		ChevronsRight,
		ArrowLeftToLine,
		ArrowRightToLine,
		SkipBack,
		Pause,
		RotateCw,
		Maximize,
		Search,
		Clock3,
		MessageSquare,
		Headphones
	} from '@lucide/svelte';
	import VideoPlayer from '#lib/components/VideoPlayer.svelte';
	import WaveEditor, { parsePeaks, type Peaks, type WaveLine } from '#lib/components/WaveEditor.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { FLAG_LABEL } from '#lib/status.ts';
	import { clock, plural } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Seg = (typeof data.segments)[number];
	type Line = {
		id: number;
		start: number;
		end: number;
		origStart: number | null;
		origEnd: number | null;
		origin: string;
		speaker: string | null;
		en: string;
		original: string;
		hi: string;
		flag: string | null;
		comment: string;
		reviewed: boolean;
	};
	const toLine = (s: Seg): Line => ({
		id: s.id,
		start: Number(s.start_sec),
		end: Number(s.end_sec),
		origStart: s.start_sec_original === null ? null : Number(s.start_sec_original),
		origEnd: s.end_sec_original === null ? null : Number(s.end_sec_original),
		origin: s.origin,
		speaker: s.speaker,
		en: s.en_text,
		original: s.hi_text_original,
		hi: s.hi_text,
		flag: s.flag,
		comment: s.comment ?? '',
		reviewed: !!s.reviewed_at
	});

	// svelte-ignore state_referenced_locally
	let lines = $state<Line[]>(data.segments.map(toLine));
	// svelte-ignore state_referenced_locally
	const editable = data.editable;
	// svelte-ignore state_referenced_locally
	const job = data.job;
	const media = (kind: string) => `/api/media/${job.video_id}/${kind}`;
	// svelte-ignore state_referenced_locally
	const mode = data.mode;
	// A reviewer goes back to their queue, an operator to the check list, an admin to the task.
	// svelte-ignore state_referenced_locally
	const backHref = mode === 'review' ? '/review' : data.user?.role === 'operator' ? '/operator' : `/admin/tasks/${job.video_id}`;
	let approveOpen = $state(false);
	let backOpen = $state(false);
	let approveForm = $state<HTMLFormElement>();
	let backForm = $state<HTMLFormElement>();
	let stopForm = $state<HTMLFormElement>();

	const isEdited = (l: Line) =>
		l.hi.trim() !== l.original || l.origin !== 'source' || l.start !== l.origStart || l.end !== l.origEnd;
	const timingChanged = (l: Line) => l.origStart !== null && (l.start !== l.origStart || l.end !== l.origEnd);

	// ---------- player ----------
	let player = $state<ReturnType<typeof VideoPlayer>>();
	let wave = $state<ReturnType<typeof WaveEditor>>();
	let time = $state(0);
	let playing = $state(false);
	let track = $state<'original' | 'dubbed'>(job.dubbed_key ? 'dubbed' : 'original');
	let stopAt = $state<number | null>(null);
	// svelte-ignore state_referenced_locally
	let active = $state<number | null>(lines[0]?.id ?? null);
	let follow = $state(true);
	let zoom = $state(80);
	let range = $state<{ start: number; end: number } | null>(null);
	let rate = $state(1);
	let editTiming = $state(false);
	// Sound only: about a tenth of the data. On by itself on slow or data-saver connections; remembered per browser.
	let soundOnly = $state(false);
	const audioSrc = $derived(
		track === 'original' ? (job.audio_key ? media('audio') : null) : job.dubbed_audio_key ? media('dubbed-audio') : null
	);
	onMount(() => {
		let saved: string | null = null;
		try {
			saved = localStorage.getItem('dubdesk.soundOnly');
		} catch {
			/* storage blocked */
		}
		const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
		soundOnly = saved !== null ? saved === '1' : !!(c?.saveData || /(^|-)2g|3g/.test(c?.effectiveType ?? ''));
	});
	function setSoundOnly(v: boolean) {
		soundOnly = v;
		try {
			localStorage.setItem('dubdesk.soundOnly', v ? '1' : '0');
		} catch {
			/* storage blocked */
		}
	}
	const short = (t: number) => clock(t).slice(0, 5);
	let peaks = $state<Peaks | null>(null);
	const length = $derived(Number(job.duration_sec) || Math.max(0, ...lines.map((l) => l.end)));
	const current = $derived(lines.find((l) => l.id === active) ?? null);
	const src = $derived(track === 'original' ? (job.source_key ? media('source') : null) : job.dubbed_key ? media('dubbed') : null);

	$effect(() => {
		if (stopAt !== null && playing && time >= stopAt) {
			playing = false;
			stopAt = null;
		}
	});
	$effect(() => {
		if (!playing || !follow) return;
		const at = lines.find((l) => time >= l.start && time < l.end);
		if (at && at.id !== active) {
			active = at.id;
			scrollToLine(at.id);
		}
	});

	// Scroll only the line list, never the page, so the top bar and player stay put.
	let list = $state<HTMLDivElement>();
	function scrollToLine(id: number) {
		const el = document.getElementById(`line-${id}`);
		if (!list || !el) return;
		const top = el.offsetTop;
		if (top < list.scrollTop || top + el.offsetHeight > list.scrollTop + list.clientHeight) {
			list.scrollTo({ top: top - list.clientHeight / 3, behavior: 'smooth' });
		}
	}
	function seekTo(t: number) {
		player?.seek(t);
		time = t;
	}
	function playLine(l: Line, before = 0) {
		select(l.id, true);
		player?.seek(Math.max(0, l.start - before));
		stopAt = l.end;
		playing = true;
	}
	function select(id: number, scroll = false) {
		active = id;
		const l = lines.find((q) => q.id === id);
		if (l) wave?.reveal(l.start);
		if (scroll) scrollToLine(id);
	}
	function step(dir: 1 | -1) {
		const i = lines.findIndex((l) => l.id === active);
		const next = lines[Math.min(lines.length - 1, Math.max(0, i + dir))];
		if (next) {
			select(next.id, true);
			seekTo(next.start);
		}
	}

	// ---------- autosave ----------
	type Change = { id: number; start_sec?: number; end_sec?: number; hi_text?: string; flag?: string | null; comment?: string; reviewed?: boolean };
	let pending = new Map<number, Change>();
	let saveState = $state<'saved' | 'dirty' | 'saving' | 'error'>('saved');
	let savedAt = $state<Date | null>(null);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const api = `/api/review/jobs/${job.id}/segments`;

	function mark(l: Line, patch: Partial<Omit<Change, 'id'>>) {
		if (!editable) return;
		pending.set(l.id, { ...(pending.get(l.id) ?? { id: l.id }), ...patch });
		saveState = 'dirty';
		clearTimeout(timer);
		timer = setTimeout(flush, 1200);
	}

	async function post(body: unknown) {
		const res = await fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		if (!res.ok) {
			let msg = res.statusText;
			try {
				msg = (await res.json()).message ?? msg;
			} catch {
				/* plain text */
			}
			throw new Error(msg);
		}
		return res.json();
	}

	async function flush(): Promise<boolean> {
		clearTimeout(timer);
		if (pending.size === 0) return true;
		const batch = [...pending.values()];
		pending = new Map();
		saveState = 'saving';
		try {
			await post({ changes: batch });
			savedAt = new Date();
			saveState = pending.size ? 'dirty' : 'saved';
			return true;
		} catch (e) {
			for (const c of batch) if (!pending.has(c.id)) pending.set(c.id, c);
			saveState = 'error';
			toast(`Could not save: ${(e as Error).message.slice(0, 140)}`, 'error', 6000);
			return false;
		}
	}

	beforeNavigate(({ cancel, type }) => {
		if (pending.size && type !== 'leave' && !confirm('Some changes are not saved yet. Leave anyway?')) cancel();
	});

	// ---------- line text / flags ----------
	function setFlag(l: Line, f: string) {
		l.flag = l.flag === f ? null : f;
		mark(l, { flag: l.flag });
	}
	function toggleChecked(l: Line) {
		l.reviewed = !l.reviewed;
		mark(l, { reviewed: l.reviewed });
	}
	/** The next line still to check after `from` (wrapping round), or null when all are checked. */
	function nextUnchecked(from?: Line): Line | null {
		const i = from ? lines.indexOf(from) : -1;
		return [...lines.slice(i + 1), ...lines.slice(0, i + 1)].find((q) => !q.reviewed) ?? null;
	}
	function goTo(l: Line, focusText = false) {
		select(l.id, true);
		seekTo(l.start);
		if (focusText) requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`#line-${l.id} textarea[data-lang="hi"]`)?.focus());
	}
	/** Mark this line checked and move to the next one still to check: the reviewer's main loop. */
	function checkAndNext(l: Line, focusText = false) {
		if (!l.reviewed) toggleChecked(l);
		const next = nextUnchecked(l);
		if (next) goTo(next, focusText);
		else toast('Every line is checked. Send it on when ready.');
	}
	function jumpToUnchecked() {
		const next = nextUnchecked(current ?? undefined);
		if (next) goTo(next);
		else toast('Every line is checked.');
	}

	// Hindi needs about 15 letters a second to be spoken comfortably; above this the dub will rush or overrun.
	const MAX_CPS = 17;
	const speechRate = (l: Line) => l.hi.replace(/\s+/g, '').length / Math.max(0.1, l.end - l.start);
	function resetLine(l: Line) {
		l.hi = l.original;
		mark(l, { hi_text: l.hi });
	}

	// ---------- timing ----------
	const r3 = (t: number) => Math.round(t * 1000) / 1000;
	function neighbours(l: Line) {
		const i = lines.indexOf(l);
		return { lo: i > 0 ? lines[i - 1].end : 0, hi: i < lines.length - 1 ? lines[i + 1].start : Math.max(length, l.end) };
	}
	function setTiming(l: Line, start: number, end: number, save = true) {
		const { lo, hi } = neighbours(l);
		start = r3(Math.max(lo, Math.min(start, end - 0.1)));
		end = r3(Math.min(hi, Math.max(end, start + 0.1)));
		if (end - start < 0.1) {
			toast('No room: the line would overlap its neighbour.', 'error');
			return;
		}
		l.start = start;
		l.end = end;
		if (save) mark(l, { start_sec: start, end_sec: end });
	}
	function previewTiming(id: number, s: number, e: number) {
		const l = lines.find((q) => q.id === id);
		if (l) {
			l.start = s;
			l.end = e;
		}
	}
	function commitTiming(id: number, s: number, e: number) {
		const l = lines.find((q) => q.id === id);
		if (l) mark(l, { start_sec: s, end_sec: e });
	}
	const setStartHere = () => current && setTiming(current, time, current.end);
	const setEndHere = () => current && setTiming(current, current.start, time);
	const nudge = (which: 'start' | 'end', d: number) =>
		current && setTiming(current, which === 'start' ? current.start + d : current.start, which === 'end' ? current.end + d : current.end);

	function parseClock(v: string): number | null {
		const m = v.trim().match(/^(?:(\d+):)?(\d+)(?:[.,](\d{1,3}))?$/);
		if (!m) return null;
		return Number(m[1] ?? 0) * 60 + Number(m[2]) + Number((m[3] ?? '0').padEnd(3, '0')) / 1000;
	}
	function typedTime(l: Line, which: 'start' | 'end', e: Event) {
		const input = e.target as HTMLInputElement;
		const t = parseClock(input.value);
		if (t === null) {
			toast('Write time as mm:ss.mmm, e.g. 01:15.250', 'error');
			input.value = clock(which === 'start' ? l.start : l.end);
			return;
		}
		setTiming(l, which === 'start' ? t : l.start, which === 'end' ? t : l.end);
		input.value = clock(which === 'start' ? l.start : l.end);
	}

	// ---------- structure: split / merge / insert / delete ----------
	let busyOp = $state(false);
	async function op(body: Record<string, unknown>, done: string) {
		if (!editable || busyOp || !(await flush())) return;
		busyOp = true;
		try {
			const out = await post(body);
			lines = (out.segments as Seg[]).map(toLine);
			if (out.focus) select(out.focus, true);
			else if (!lines.some((l) => l.id === active)) active = lines[0]?.id ?? null;
			range = null;
			savedAt = new Date();
			toast(done);
		} catch (e) {
			toast((e as Error).message, 'error');
		} finally {
			busyOp = false;
		}
	}
	function cursorIn(l: Line, lang: 'hi' | 'en') {
		const el = document.querySelector<HTMLTextAreaElement>(`#line-${l.id} textarea[data-lang="${lang}"]`);
		return el && document.activeElement === el ? el.selectionStart : undefined;
	}
	const split = () =>
		current &&
		op({ op: 'split', id: current.id, at: r3(time > current.start && time < current.end ? time : (current.start + current.end) / 2), hiCut: cursorIn(current, 'hi') }, 'Line split in two.');
	const merge = () => current && op({ op: 'merge', id: current.id }, 'Lines joined.');
	function insert() {
		let start = range?.start ?? time;
		let end = range?.end ?? time + 1.5;
		const inside = lines.find((l) => start >= l.start && start < l.end);
		if (inside) {
			return toast(`The play head is inside line ${lines.indexOf(inside) + 1}. Move it to a gap, or drag across empty audio.`, 'error');
		}
		const prevEnd = Math.max(0, ...lines.filter((l) => l.end <= start).map((l) => l.end));
		const nextStart = Math.min(Math.max(length, end), ...lines.filter((l) => l.start >= start).map((l) => l.start));
		start = Math.max(start, prevEnd);
		end = Math.min(end, nextStart);
		if (end - start < 0.1) return toast('No free space here. Move the play head to a gap, or drag across empty audio.', 'error');
		op({ op: 'insert', start: r3(start), end: r3(end) }, 'New line added. Type its Hindi text.');
	}
	let delOpen = $state(false);
	const del = () => current && op({ op: 'delete', id: current.id }, 'Line removed.').then(() => (delOpen = false));

	// ---------- filters + counts ----------
	let filter = $state<'all' | 'todo' | 'edited' | 'flagged'>('all');
	const counts = $derived({
		checked: lines.filter((l) => l.reviewed).length,
		edited: lines.filter(isEdited).length,
		flagged: lines.filter((l) => l.flag).length
	});
	const shown = $derived(
		lines.filter((l) => (filter === 'todo' ? !l.reviewed : filter === 'edited' ? isEdited(l) : filter === 'flagged' ? !!l.flag : true))
	);
	const pct = $derived(lines.length ? Math.round((counts.checked / lines.length) * 100) : 0);
	const waveLines = $derived<WaveLine[]>(
		lines.map((l, i) => ({
			id: l.id,
			n: i + 1,
			start: l.start,
			end: l.end,
			text: l.hi,
			state: l.flag ? 'flagged' : isEdited(l) ? 'edited' : l.reviewed ? 'checked' : 'plain'
		}))
	);
	const cps = (l: Line) => speechRate(l).toFixed(1);

	// ---------- find & replace ----------
	let findOpen = $state(false);
	let find = $state('');
	let replaceWith = $state('');
	let replacing = $state(false);
	const matches = $derived(find ? lines.filter((l) => l.hi.includes(find)).length : 0);
	async function replaceAll() {
		if (!find || !(await flush())) return;
		replacing = true;
		try {
			const out = await post({ find, replace: replaceWith });
			lines = (out.segments as Seg[]).map(toLine);
			savedAt = new Date();
			toast(`Replaced in ${plural(out.saved, 'line')}.`);
			findOpen = false;
		} catch (e) {
			toast(`Replace failed: ${(e as Error).message.slice(0, 120)}`, 'error');
		} finally {
			replacing = false;
		}
	}

	// ---------- submit / give back ----------
	let submitOpen = $state(false);
	let releaseOpen = $state(false);
	let submitForm = $state<HTMLFormElement>();
	let releaseForm = $state<HTMLFormElement>();
	let sending = $state(false);
	async function send(form?: HTMLFormElement) {
		sending = true;
		if (!(await flush())) {
			sending = false;
			return;
		}
		form?.requestSubmit();
	}

	// ---------- keyboard ----------
	let keysOpen = $state(false);
	function onKey(e: KeyboardEvent) {
		const typing = (e.target as HTMLElement)?.closest('input, textarea, select');
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 's') {
			e.preventDefault();
			flush().then((ok) => ok && toast('Saved.'));
			return;
		}
		if (mod && e.key.toLowerCase() === 'f' && editable) {
			e.preventDefault();
			findOpen = true;
			return;
		}
		if (editable && e.key === 'F11') {
			e.preventDefault();
			setStartHere();
			return;
		}
		if (editable && e.key === 'F12') {
			e.preventDefault();
			setEndHere();
			return;
		}
		if (typing) {
			if (e.key === 'Escape') (e.target as HTMLElement).blur();
			// Ctrl/Cmd+Enter while typing a line: done with it, go to the next one to check.
			else if (mod && e.key === 'Enter' && editable && current) {
				e.preventDefault();
				checkAndNext(current, true);
			}
			return;
		}
		const k = e.key;
		if (k === ' ') {
			e.preventDefault();
			player?.toggle();
		} else if (k === 'j' || k === 'ArrowDown') {
			e.preventDefault();
			step(1);
		} else if (k === 'k' || k === 'ArrowUp') {
			e.preventDefault();
			step(-1);
		} else if (k === 'ArrowLeft') seekTo(Math.max(0, time - (e.shiftKey ? 5 : 0.5)));
		else if (k === 'ArrowRight') seekTo(time + (e.shiftKey ? 5 : 0.5));
		else if (k === 'p' && current) playLine(current);
		else if (k === 'b' && current) playLine(current, 1);
		else if (k === '+' || k === '=') wave?.zoomBy(1.25);
		else if (k === '-') wave?.zoomBy(0.8);
		else if (!editable) return;
		else if (k === 'c' && current) {
			if (current.reviewed) toggleChecked(current);
			else checkAndNext(current);
		} else if (k === 'n') jumpToUnchecked();
		else if (k === 's' && current) split();
		else if (k === 'm' && current) merge();
		else if (k === 'i') insert();
		else if ((k === 'Delete' || k === 'Backspace') && current) delOpen = true;
		else if (k === '[') nudge('start', e.shiftKey ? 0.1 : -0.1);
		else if (k === ']') nudge('end', e.shiftKey ? -0.1 : 0.1);
		else if (k === 'e' && current) {
			e.preventDefault();
			document.querySelector<HTMLTextAreaElement>(`#line-${current.id} textarea[data-lang="hi"]`)?.focus();
		} else if (k === '?') keysOpen = true;
	}

	onMount(() => {
		const warn = (e: BeforeUnloadEvent) => {
			if (pending.size) e.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		// Working-time tracking: a beat every 30 s while the reviewer is active on this tab.
		let lastActive = Date.now();
		const activeNow = () => (lastActive = Date.now());
		const evs = ['keydown', 'pointerdown', 'pointermove', 'wheel'] as const;
		for (const ev of evs) window.addEventListener(ev, activeNow, { passive: true });
		const beat = setInterval(() => {
			const active = document.visibilityState === 'visible' && (Date.now() - lastActive < 60_000 || playing);
			if (editable && active) fetch(`/api/review/jobs/${job.id}/heartbeat`, { method: 'POST' }).catch(() => {});
		}, 30_000);
		if (editable) fetch(`/api/review/jobs/${job.id}/heartbeat`, { method: 'POST' }).catch(() => {});
		if (job.peaks_key) {
			fetch(media('peaks'))
				.then((r) => (r.ok ? r.arrayBuffer() : null))
				.then((b) => b && (peaks = parsePeaks(b)))
				.catch(() => toast('Could not load the waveform.', 'error'));
		}
		return () => {
			window.removeEventListener('beforeunload', warn);
			for (const ev of evs) window.removeEventListener(ev, activeNow);
			clearInterval(beat);
		};
	});
</script>

<svelte:window onkeydown={onKey} />

<div class="editor">
	<header class="bar">
		<a href={backHref} class="btn btn-ghost btn-icon" aria-label="Back" title="Back"><ArrowLeft size={18} /></a>
		<strong class="title">{job.title}</strong>
		<span class="chip lang-chip"><i></i>Hindi</span>
		<span class="chip">Round {job.round}</span>
		<button class="chip checkchip" class:complete={counts.checked === lines.length} title="Go to the next line to check (N)" onclick={jumpToUnchecked} style="--p: {pct}%">
			<span class="bar-fill" aria-hidden="true"></span>
			<span class="label">{counts.checked}/{lines.length} checked</span>
		</button>
		<div class="spacer"></div>
		{#if editable}
			<span class="save {saveState}" aria-live="polite">
				{#if saveState === 'saving'}<LoaderCircle size={14} class="spin" /> Saving…
				{:else if saveState === 'dirty'}<Cloud size={14} /> Unsaved
				{:else if saveState === 'error'}<CloudOff size={14} /> Not saved
				{:else}<Check size={14} /> {savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'All saved'}{/if}
			</span>
		{/if}
		<button class="ghost icon-only" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onclick={() => (keysOpen = true)}><Keyboard size={17} /></button>
		{#if mode === 'check'}
			{#if data.studio}<a class="btn btn-ghost" href={data.studio} target="_blank" rel="noopener noreferrer" title="Fix voice or timing in Sarvam Studio"><ExternalLink size={15} /> Sarvam Studio</a>{/if}
			<button class="ghost" onclick={() => send(stopForm)}>Stop checking</button>
			<button class="danger" onclick={() => (backOpen = true)}><Undo2 size={16} /> Send back</button>
			<button class="primary" onclick={() => (approveOpen = true)}><CircleCheck size={15} /> Approve</button>
		{:else if editable}
			<button class="ghost" onclick={() => (releaseOpen = true)}><Undo2 size={16} /> Give back</button>
			<button class="primary" onclick={() => (submitOpen = true)}><Send size={15} /> Send for check</button>
		{:else}
			<Badge label="Read only" tone="neutral" />
		{/if}
	</header>

	{#if mode === 'check'}
		<div class="banner check">
			<CircleCheck size={17} />
			<div><strong>You are checking {job.reviewer_name ?? 'the reviewer'}'s work.</strong> Fix anything they missed (here, or voice and timing in Sarvam Studio), then approve it — or send it back if there are many mistakes.</div>
		</div>
	{:else if data.busyBy}
		<div class="banner">
			<TriangleAlert size={17} />
			<div><strong>{data.busyBy} is checking this video.</strong> You can look, but not change it.</div>
		</div>
	{/if}
	{#if job.admin_note && mode === 'review'}
		<div class="banner">
			<TriangleAlert size={17} />
			<div><strong>Sent back to you to fix.</strong> {job.admin_note}</div>
		</div>
	{/if}

	<div class="work">
		<section class="card video">
			<button class="corner ghost icon-only" title="Full screen" aria-label="Full screen" onclick={() => player?.fullScreen()}><Maximize size={16} /></button>
			<VideoPlayer
				bind:this={player}
				bind:time
				bind:playing
				bind:rate
				{length}
				{src}
				{audioSrc}
				audioOnly={soundOnly}
				watermark={data.user ? `${data.user.email} · DubDesk` : ''}
				fill
				controls={false}
				emptyText={track === 'dubbed' ? 'The Hindi video arrives from Sarvam after dubbing.' : 'No English video file yet.'}
			/>
		</section>

		<section class="card output">
			<div class="out-head">
				<h2>Dubbed output</h2>
				<div class="filters" role="group" aria-label="Filter lines">
					<button class:on={filter === 'all'} onclick={() => (filter = 'all')}>All <em>{lines.length}</em></button>
					<button class:on={filter === 'todo'} onclick={() => (filter = 'todo')}>To check <em>{lines.length - counts.checked}</em></button>
					<button class:on={filter === 'edited'} onclick={() => (filter = 'edited')}>Edited <em>{counts.edited}</em></button>
					<button class:on={filter === 'flagged'} onclick={() => (filter = 'flagged')}>Flagged <em>{counts.flagged}</em></button>
				</div>
				<span class="spacer"></span>
				{#if editable}<button class="sm find" onclick={() => (findOpen = true)}><Search size={14} /> Find & Replace</button>{/if}
			</div>

			<div class="scroll" bind:this={list}>
				{#each shown as l (l.id)}
					{@const n = lines.indexOf(l) + 1}
					{@const changedText = l.hi.trim() !== l.original}
					<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
					<article id="line-{l.id}" class="row" class:active={active === l.id} onclick={() => select(l.id)} onfocusin={() => select(l.id)}>
						<div class="col">
							<div class="pills">
								<span class="n" class:edited={isEdited(l)} class:flagged={!!l.flag} class:checked={l.reviewed && !isEdited(l) && !l.flag}>{n}</span>
								<button class="pill time" title="Play this line (P)" onclick={(e) => (e.stopPropagation(), playLine(l))}>{short(l.start)} – {short(l.end)}</button>
								{#if l.speaker}<span class="pill spk">{l.speaker.replace(/^Speaker (\d+)$/, (_, d) => `Speaker ${Number(d) + 1}`)}</span>{/if}
								{#if l.origin !== 'source'}<span class="pill note">{l.origin === 'inserted' ? 'New line' : l.origin === 'split' ? 'Split' : 'Joined'}</span>{/if}
								{#if timingChanged(l)}<span class="pill warnp">Timing moved</span>{/if}
							</div>
							<p class="en">{l.en || '—'}</p>
						</div>

						<div class="col">
							<div class="pills">
								<span class="pill time plain">{short(l.start)} – {short(l.end)}</span>
								{#if l.flag}<span class="pill bad">{FLAG_LABEL[l.flag]}</span>{/if}
								{#if changedText}<span class="pill warnp">Edited</span>{/if}
								{#if speechRate(l) > MAX_CPS}<span class="pill bad" title="{speechRate(l).toFixed(0)} letters a second; under {MAX_CPS} fits the timing. Shorten the Hindi or give the line more time.">Too long to speak</span>{/if}
								<span class="spacer"></span>
								{#if editable}
									<button class="tick" class:on={l.reviewed} title={l.reviewed ? 'Checked: click to undo' : 'Mark as checked and go to the next line (C)'} aria-pressed={l.reviewed} onclick={(e) => (e.stopPropagation(), l.reviewed ? toggleChecked(l) : checkAndNext(l))}>
										<CircleCheck size={14} />{l.reviewed ? 'Checked' : 'Check'}
									</button>
								{:else if !editable && l.reviewed}<span class="pill okp">Checked</span>{/if}
							</div>
							<textarea data-lang="hi" lang="hi" rows="1" readonly={!editable} bind:value={l.hi} oninput={() => mark(l, { hi_text: l.hi })} aria-label="Hindi text, line {n}"></textarea>

							{#if active === l.id && editable}
								<div class="tools">
									<div class="flags">
										{#each Object.entries(FLAG_LABEL) as [k, label] (k)}
											<button class="flag" class:on={l.flag === k} onclick={() => setFlag(l, k)}>{label}</button>
										{/each}
									</div>
									<input class="comment" placeholder={mode === 'check' ? 'Comment for the reviewer' : 'Comment for the checker'} bind:value={l.comment} oninput={() => mark(l, { comment: l.comment })} />
									{#if l.original && changedText}
										<div class="orig">
											<span class="faint">Original</span>
											<span lang="hi">{l.original}</span>
											<button class="ghost sm" onclick={() => resetLine(l)}><RotateCcw size={13} /> Undo</button>
										</div>
									{/if}
								</div>
							{:else if l.comment}
								<p class="cmt"><MessageSquare size={13} /> {l.comment}</p>
							{/if}
						</div>
					</article>
				{:else}
					<p class="none muted">No lines in this view.</p>
				{/each}
			</div>
		</section>
	</div>

	<section class="card dock">
		<div class="dock-bar">
			<div class="toggle" role="group" aria-label="Track">
				<button class:on={track === 'original'} onclick={() => (track = 'original')}>Original</button>
				<button class:on={track === 'dubbed'} onclick={() => (track = 'dubbed')}>Dubbed</button>
			</div>

			<div class="transport">
				<button class="ghost icon-only" title="Back 5 s (Shift+←)" aria-label="Back 5 seconds" onclick={() => seekTo(Math.max(0, time - 5))}><RotateCcw size={15} /></button>
				<button class="ghost icon-only" title="Play from just before the line (B)" aria-label="Play before" disabled={!current} onclick={() => current && playLine(current, 1)}><SkipBack size={15} /></button>
				<button class="play" onclick={() => player?.toggle()}>
					{#if playing}<Pause size={15} /> Pause{:else}<Play size={15} /> Play{/if}
				</button>
				<button class="ghost icon-only" title="Forward 5 s (Shift+→)" aria-label="Forward 5 seconds" onclick={() => seekTo(time + 5)}><RotateCw size={15} /></button>
				<span class="clock mono">{clock(time)}</span>
				<select bind:value={rate} aria-label="Speed" class="speed">
					<option value={0.75}>0.75×</option>
					<option value={1}>1×</option>
					<option value={1.25}>1.25×</option>
					<option value={1.5}>1.5×</option>
				</select>
			</div>

			<div class="right">
				<button
					class="sm sound"
					class:primary={soundOnly}
					disabled={!audioSrc}
					title={audioSrc ? 'Listen without the picture: about a tenth of the data' : 'Sound-only copy is still being prepared'}
					onclick={() => setSoundOnly(!soundOnly)}
				><Headphones size={14} /> Sound only</button>
				<label class="follow"><input type="checkbox" bind:checked={follow} /> Follow</label>
				<div class="zoom">
					<button class="ghost icon-only" title="Zoom out (−)" aria-label="Zoom out" onclick={() => wave?.zoomBy(0.8)}><ZoomOut size={15} /></button>
					<button class="ghost icon-only" title="Zoom in (+)" aria-label="Zoom in" onclick={() => wave?.zoomBy(1.25)}><ZoomIn size={15} /></button>
					<button class="ghost icon-only" title="Show whole video" aria-label="Fit" onclick={() => wave?.fit()}><Maximize2 size={14} /></button>
				</div>
				{#if editable}
					<button class="sm" class:primary={editTiming} onclick={() => (editTiming = !editTiming)}><Clock3 size={14} /> {editTiming ? 'Done' : 'Edit timing'}</button>
				{/if}
			</div>
		</div>

		{#if editTiming && editable}
			<div class="timing">
				{#if current}
					<span class="faint small">Line {lines.indexOf(current) + 1}</span>
					<input class="tc" value={clock(current.start)} aria-label="Start" onchange={(e) => typedTime(current!, 'start', e)} />
					<span class="faint">–</span>
					<input class="tc" value={clock(current.end)} aria-label="End" onchange={(e) => typedTime(current!, 'end', e)} />
					<span class="dur mono">{(current.end - current.start).toFixed(2)}s · {cps(current)} c/s</span>
				{/if}
				<span class="sep"></span>
				<button class="ghost sm" title="Set start to play head (F11)" disabled={!current} onclick={setStartHere}><ArrowLeftToLine size={14} /> Start here</button>
				<button class="ghost sm" title="Set end to play head (F12)" disabled={!current} onclick={setEndHere}><ArrowRightToLine size={14} /> End here</button>
				<button class="ghost icon-only" title="Start 0.1 s earlier ([)" aria-label="Start earlier" disabled={!current} onclick={() => nudge('start', -0.1)}><ChevronsLeft size={15} /></button>
				<button class="ghost icon-only" title="End 0.1 s later (])" aria-label="End later" disabled={!current} onclick={() => nudge('end', 0.1)}><ChevronsRight size={15} /></button>
				<span class="sep"></span>
				<button class="ghost sm" title="Split at play head (S)" disabled={!current || busyOp} onclick={split}><Scissors size={14} /> Split</button>
				<button class="ghost sm" title="Join with next line (M)" disabled={!current || busyOp} onclick={merge}><Merge size={14} /> Join next</button>
				<button class="ghost sm" title="Add a line at the play head or dragged range (I)" disabled={busyOp} onclick={insert}><Plus size={14} /> Add line</button>
				<button class="ghost sm danger-text" title="Remove line (Delete)" disabled={!current || busyOp} onclick={() => (delOpen = true)}><Trash2 size={14} /> Remove</button>
				<span class="hint faint small">Drag a line's edge or middle on the wave</span>
			</div>
		{/if}

		<WaveEditor
			bind:this={wave}
			bind:zoom
			bind:range
			{peaks}
			{length}
			lines={waveLines}
			{time}
			{playing}
			editable={editable && editTiming}
			selected={active}
			onseek={seekTo}
			onselect={(id) => select(id, true)}
			onpreview={previewTiming}
			oncommit={commitTiming}
		/>
	</section>
</div>

<Modal bind:open={findOpen} title="Find & replace in Hindi">
	<div class="stack">
		<label class="field">Find<input bind:value={find} lang="hi" placeholder="Word or phrase" /></label>
		<label class="field">Replace with<input bind:value={replaceWith} lang="hi" placeholder="New text (blank removes it)" /></label>
		<p class="muted small">{find ? `Found in ${plural(matches, 'line')}.` : 'Type something to find.'}</p>
	</div>
	{#snippet footer()}
		<button class="ghost" onclick={() => (findOpen = false)}>Cancel</button>
		<button class="primary" disabled={!matches || replacing} onclick={replaceAll}>{#if replacing}<LoaderCircle size={15} class="spin" />{/if} Replace all</button>
	{/snippet}
</Modal>

<Modal bind:open={delOpen} title="Remove line {current ? lines.indexOf(current) + 1 : ''}?" width={420}>
	<p class="muted">The line disappears from the dub. The checker still sees that it was removed.</p>
	{#if current?.hi}<p class="quote" lang="hi">{current.hi}</p>{/if}
	{#snippet footer()}
		<button class="ghost" onclick={() => (delOpen = false)}>Cancel</button>
		<button class="danger" disabled={busyOp} onclick={del}><Trash2 size={15} /> Remove</button>
	{/snippet}
</Modal>

<Modal bind:open={submitOpen} title="Send for check?">
	<div class="summary">
		<div><strong>{counts.checked}/{lines.length}</strong><span>checked</span></div>
		<div><strong>{counts.edited}</strong><span>edited</span></div>
		<div><strong>{counts.flagged}</strong><span>flagged</span></div>
	</div>
	{#if counts.checked < lines.length}
		<p class="warn"><TriangleAlert size={15} /> {plural(lines.length - counts.checked, 'line')} not marked as checked yet.</p>
	{/if}
	<form bind:this={submitForm} method="POST" action="?/submit">
		<label class="field">Note for the checker (optional)<textarea name="note" rows="3" placeholder="Anything they should know"></textarea></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (submitOpen = false)}>Keep working</button>
		<button class="primary" disabled={sending} onclick={() => send(submitForm)}>{#if sending}<LoaderCircle size={15} class="spin" />{:else}<Send size={15} />{/if} Send</button>
	{/snippet}
</Modal>

<Modal bind:open={releaseOpen} title="Give this job back?">
	<p class="muted">Your edits stay saved. The job goes back to the queue for someone else to pick up.</p>
	<form bind:this={releaseForm} method="POST" action="?/release" class="reason-form">
		<label class="field">Why are you giving it back? <span class="faint">(helps the team)</span>
			<select name="reason">
				<option value="">— choose —</option>
				<option>Audio is unclear or noisy</option>
				<option>English transcript is wrong or missing</option>
				<option>Hindi dub is too poor to fix line by line</option>
				<option>Topic needs a specialist</option>
				<option>Video file does not play</option>
				<option>No time right now</option>
			</select>
		</label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (releaseOpen = false)}>Cancel</button>
		<button class="danger" disabled={sending} onclick={() => send(releaseForm)}><Undo2 size={15} /> Give back</button>
	{/snippet}
</Modal>

{#if mode === 'check'}
<form bind:this={stopForm} method="POST" action="?/stopCheck" hidden></form>

<Modal bind:open={approveOpen} title="Approve this video?">
	<div class="summary">
		<div><strong>{counts.checked}/{lines.length}</strong><span>checked</span></div>
		<div><strong>{counts.edited}</strong><span>edited</span></div>
		<div><strong>{counts.flagged}</strong><span>flagged</span></div>
	</div>
	<p class="muted">It is finished: {job.reviewer_name ?? 'the reviewer'} is credited with this video, and it is ready to download.</p>
	<form bind:this={approveForm} method="POST" action="?/approve">
		<label class="field">Note (optional)<textarea name="note" rows="2" placeholder="Anything to record"></textarea></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (approveOpen = false)}>Keep checking</button>
		<button class="primary" disabled={sending} onclick={() => send(approveForm)}><CircleCheck size={15} /> Approve</button>
	{/snippet}
</Modal>

<Modal bind:open={backOpen} title="Send back to {job.reviewer_name ?? 'the reviewer'}?">
	<p class="muted">Your own fixes stay saved. They get the video back with your note and must send it again.</p>
	<form bind:this={backForm} method="POST" action="?/sendBack">
		<label class="field">What should they fix? <span class="faint">(required)</span><textarea name="note" rows="3" required placeholder="e.g. Lines 12–30: meaning is wrong, please re-check against the English"></textarea></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (backOpen = false)}>Cancel</button>
		<button class="danger" disabled={sending} onclick={() => backForm?.reportValidity() && send(backForm)}><Undo2 size={15} /> Send back</button>
	{/snippet}
</Modal>
{/if}

<Modal bind:open={keysOpen} title="Keyboard shortcuts" width={560}>
	<div class="keycols">
		<dl class="keys">
			<dt><span class="kbd">Space</span></dt><dd>Play / pause</dd>
			<dt><span class="kbd">←</span> <span class="kbd">→</span></dt><dd>Back / forward 0.5 s (Shift: 5 s)</dd>
			<dt><span class="kbd">J</span> <span class="kbd">K</span></dt><dd>Next / previous line</dd>
			<dt><span class="kbd">P</span></dt><dd>Play the selected line</dd>
			<dt><span class="kbd">B</span></dt><dd>Play from just before it</dd>
			<dt><span class="kbd">+</span> <span class="kbd">−</span></dt><dd>Zoom waveform</dd>
			<dt><span class="kbd">E</span></dt><dd>Edit the Hindi text</dd>
			<dt><span class="kbd">Esc</span></dt><dd>Stop editing</dd>
		</dl>
		<dl class="keys">
			<dt><span class="kbd">F11</span> <span class="kbd">F12</span></dt><dd>Set start / end to play head</dd>
			<dt><span class="kbd">[</span> <span class="kbd">]</span></dt><dd>Start earlier / end later (Shift: other way)</dd>
			<dt><span class="kbd">S</span></dt><dd>Split at play head</dd>
			<dt><span class="kbd">M</span></dt><dd>Join with next line</dd>
			<dt><span class="kbd">I</span></dt><dd>Add a line</dd>
			<dt><span class="kbd">Del</span></dt><dd>Remove line</dd>
			<dt><span class="kbd">C</span></dt><dd>Mark as checked, go to the next line</dd>
			<dt><span class="kbd">Ctrl</span> <span class="kbd">Enter</span></dt><dd>While typing: checked, next line</dd>
			<dt><span class="kbd">N</span></dt><dd>Jump to the next line to check</dd>
			<dt><span class="kbd">Ctrl</span> <span class="kbd">S</span> / <span class="kbd">F</span></dt><dd>Save / find & replace</dd>
		</dl>
	</div>
	<p class="muted small" style="margin-top:14px">On the waveform: drag a line's edge to change its start or end, drag the middle to move it, drag across empty audio to mark where a new line goes, Ctrl + scroll to zoom.</p>
</Modal>

<style>
	.banner.check {
		background: #e8f3e0;
		color: #2f4a14;
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		height: calc(100vh - 28px);
	}
	.editor > :global(*) {
		flex: none;
	}
	.editor > .work {
		flex: 1 1 auto;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		padding: 0 4px;
	}
	.title {
		font-size: 16.5px;
		font-weight: 500;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 40vw;
	}
	.bar .chip {
		background: #fff;
		box-shadow: 0 0 0 1px var(--line);
	}
	.chip.checkchip {
		position: relative;
		overflow: hidden;
		min-height: 0;
		font-size: inherit;
		font-weight: 500;
		cursor: pointer;
	}
	.chip.checkchip .bar-fill {
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--p);
		background: linear-gradient(90deg, var(--accent-soft), #dfe6fb);
		transition: width 0.4s var(--ease);
	}
	.chip.checkchip.complete .bar-fill {
		background: #e3f1d8;
	}
	.chip.checkchip .label {
		position: relative;
	}
	.lang-chip i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: linear-gradient(135deg, #ff7eb3, #e380a8);
	}
	.spacer {
		flex: 1;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--muted);
		padding: 0 6px;
	}
	.save.dirty {
		color: #a5460f;
	}
	.save.error {
		color: var(--danger);
	}
	.save.saved {
		color: var(--ok);
	}
	.banner {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		padding: 10px 16px;
		border-radius: 14px;
		background: var(--orange-soft);
		border: 1px solid #fddcce;
		color: #682906;
		font-size: 14px;
	}
	.banner :global(svg) {
		flex: none;
		margin-top: 2px;
		color: var(--orange);
	}
	.card {
		box-shadow: none;
		border: none;
		border-radius: 18px;
	}
	.work {
		display: grid;
		grid-template-columns: minmax(300px, 0.66fr) minmax(0, 1fr);
		gap: 10px;
		min-height: 0;
	}
	.video {
		position: relative;
		padding: 12px;
		min-height: 0;
		display: flex;
	}
	.video > :global(.player) {
		flex: 1;
	}
	.corner {
		position: absolute;
		top: 20px;
		right: 20px;
		z-index: 2;
		background: rgba(255, 255, 255, 0.85);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
	}
	.output {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.out-head {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
		padding: 12px 16px;
		border-bottom: 1px solid var(--line);
	}
	.out-head h2 {
		font-size: 15.5px;
		font-weight: 500;
	}
	.filters,
	.toggle {
		display: flex;
		gap: 2px;
		padding: 3px;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.filters button,
	.toggle button {
		min-height: 28px;
		padding: 3px 12px;
		font-size: 12.5px;
		font-weight: 500;
		background: transparent;
		box-shadow: none;
		color: var(--muted);
	}
	.filters button.on {
		background: #fff;
		color: var(--text);
		box-shadow: var(--shadow-1);
	}
	.toggle button.on {
		background: var(--slate);
		color: #fff;
	}
	.filters em {
		font-style: normal;
		font-size: 11px;
		color: var(--faint);
		margin-left: 2px;
	}
	.find {
		background: #fff;
		box-shadow: 0 0 0 1px var(--line-strong);
	}
	.scroll {
		position: relative;
		overflow-y: auto;
		flex: 1;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 24px;
		padding: 16px 18px 16px 15px;
		border-bottom: 1px solid var(--line);
		border-left: 3px solid transparent;
		transition: background-color 0.2s;
	}
	.row:hover {
		background: #fcfcfc;
	}
	.row.active {
		background: #fafbff;
		border-left-color: #a7c0f1;
	}
	.col {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.pills {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		min-height: 26px;
	}
	.n {
		display: inline-grid;
		place-items: center;
		min-width: 22px;
		height: 22px;
		padding: 0 5px;
		border-radius: 7px;
		border: 1px solid var(--line-strong);
		font-size: 11.5px;
		font-weight: 600;
		color: var(--muted);
	}
	.n.checked {
		background: #e3f1d8;
		border-color: #c8e4b0;
		color: #385418;
	}
	.n.edited {
		background: var(--orange);
		border-color: var(--orange);
		color: #fff;
	}
	.n.flagged {
		background: #c43d2b;
		border-color: #c43d2b;
		color: #fff;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		min-height: 0;
		padding: 3px 11px;
		border-radius: 999px;
		font-size: 12.5px;
		font-weight: 400;
		background: var(--surface-2);
		color: var(--text-2);
		box-shadow: none;
		white-space: nowrap;
	}
	button.pill.time:hover {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill.time {
		font-variant-numeric: tabular-nums;
	}
	.pill.spk {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.pill.note {
		background: #eef2fd;
		color: var(--accent-2);
	}
	.pill.warnp {
		background: #fff3e0;
		color: #a5460f;
	}
	.pill.bad {
		background: #fde7e2;
		color: #a21913;
	}
	.pill.okp {
		background: #e3f1d8;
		color: #385418;
	}
	.en {
		font-size: 15px;
		line-height: 1.65;
		color: var(--text);
	}
	textarea {
		width: 100%;
		margin: -6px 0 0 -9px;
		padding: 6px 9px;
		font-family: 'Noto Sans Devanagari Variable', var(--font);
		font-size: 16px;
		line-height: 1.7;
		resize: none;
		field-sizing: content;
		min-height: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 10px;
		color: var(--text);
	}
	textarea:hover {
		background: #fff;
		border-color: var(--line);
	}
	textarea:focus {
		background: #fff;
	}
	textarea[readonly]:hover {
		background: transparent;
		border-color: transparent;
	}
	.tick {
		min-height: 0;
		padding: 3px 10px;
		gap: 5px;
		font-size: 12px;
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--line-strong);
		color: var(--muted);
	}
	.tick.on {
		background: #e3f1d8;
		color: #385418;
		box-shadow: none;
	}
	.tools {
		display: grid;
		gap: 8px;
		animation: fade-up 0.25s var(--ease);
	}
	.flags {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.flag {
		min-height: 0;
		padding: 3px 11px;
		font-size: 12px;
		font-weight: 400;
		background: #fff;
		box-shadow: inset 0 0 0 1px var(--line-strong);
		color: var(--text-2);
	}
	.flag.on {
		background: #fde7e2;
		color: #a21913;
		box-shadow: inset 0 0 0 1px #f8d1c6;
	}
	.comment {
		font-size: 13px;
		padding: 6px 12px;
		background: #fff;
		border: 1px solid var(--line);
	}
	.orig {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 13px;
		color: var(--text-2);
	}
	.orig [lang='hi'] {
		font-family: 'Noto Sans Devanagari Variable', var(--font);
		text-decoration: line-through;
		text-decoration-color: rgba(0, 0, 0, 0.25);
	}
	.cmt {
		display: flex;
		gap: 6px;
		align-items: flex-start;
		font-size: 13px;
		color: var(--muted);
	}
	.cmt :global(svg) {
		margin-top: 3px;
		flex: none;
	}
	.none {
		padding: 32px;
		text-align: center;
	}
	.dock {
		padding: 10px 16px 12px;
		display: grid;
		gap: 8px;
	}
	.dock-bar {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 10px;
	}
	.dock-bar > .toggle {
		justify-self: start;
	}
	.transport {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		border-radius: 999px;
		background: #fff;
		box-shadow: 0 0 0 1px var(--line-strong);
	}
	.transport .icon-only {
		min-height: 30px;
		width: 30px;
	}
	.play {
		min-height: 32px;
		padding: 4px 16px;
		font-size: 13.5px;
		background: var(--surface-2);
		box-shadow: none;
	}
	.clock {
		font-size: 12.5px;
		color: var(--text-2);
		padding: 0 8px;
		border-left: 1px solid var(--line);
		margin-left: 4px;
		font-variant-numeric: tabular-nums;
	}
	.speed {
		padding: 3px 22px 3px 8px;
		font-size: 12px;
		border-radius: 999px;
		background-position: right 6px center;
	}
	.right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
	}
	.zoom {
		display: flex;
	}
	.zoom .icon-only {
		min-height: 30px;
		width: 30px;
	}
	.right button.sm {
		min-height: 32px;
		padding: 4px 14px;
		font-size: 13px;
	}
	.follow {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12.5px;
		color: var(--muted);
		cursor: pointer;
	}
	.timing {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		padding: 6px 10px;
		border-radius: 12px;
		background: var(--surface-2);
		animation: fade-up 0.25s var(--ease);
	}
	.timing button.sm {
		min-height: 28px;
		padding: 3px 10px;
		font-size: 12.5px;
		gap: 6px;
	}
	.timing .icon-only {
		min-height: 28px;
		width: 28px;
	}
	.tc {
		width: 88px;
		padding: 3px 8px;
		font-family: var(--mono);
		font-size: 11.5px;
		border-radius: 8px;
		background: #fff;
	}
	.dur {
		font-size: 11px;
		color: var(--muted);
	}
	.sep {
		width: 1px;
		height: 18px;
		background: var(--line-strong);
		margin: 0 4px;
	}
	.hint {
		margin-left: auto;
	}
	.small {
		font-size: 12px;
	}
	.danger-text {
		color: #a21913;
	}
	.stack {
		display: grid;
		gap: 12px;
	}
	.quote {
		margin-top: 12px;
		padding: 10px 14px;
		border-radius: 12px;
		background: var(--surface-2);
		font-family: 'Noto Sans Devanagari Variable', var(--font);
	}
	.summary {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		margin-bottom: 14px;
	}
	.summary div {
		display: grid;
		padding: 12px;
		border-radius: 12px;
		background: var(--surface-2);
		text-align: center;
	}
	.summary strong {
		font-size: 22px;
		font-weight: 400;
	}
	.summary span {
		font-size: 12px;
		color: var(--muted);
	}
	.warn {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 14px;
		color: #a5460f;
		font-size: 13.5px;
	}
	.keycols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
	}
	.keys {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 9px 12px;
		margin: 0;
		align-items: center;
		font-size: 13.5px;
	}
	.keys dd {
		margin: 0;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (max-width: 1100px) {
		.editor {
			height: auto;
		}
		.work {
			grid-template-columns: 1fr;
		}
		.video {
			height: 300px;
		}
		.output {
			max-height: 70vh;
		}
		.row,
		.keycols {
			grid-template-columns: 1fr;
		}
		.dock-bar {
			grid-template-columns: 1fr;
			justify-items: start;
		}
	}
</style>

/** 75.5 -> "01:15.50" (line times). */
export function clock(sec: number | string): string {
	const n = Math.max(0, Number(sec) || 0);
	const m = Math.floor(n / 60);
	return `${String(m).padStart(2, '0')}:${(n % 60).toFixed(2).padStart(5, '0')}`;
}

/** 75 -> "1:15" (player and lengths). */
export function duration(sec: number | string | null | undefined): string {
	if (sec === null || sec === undefined || sec === '') return '—';
	const n = Math.round(Number(sec));
	const h = Math.floor(n / 3600);
	const m = Math.floor((n % 3600) / 60);
	const s = String(n % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 min ago", "in 2 hours". */
export function ago(date: Date | string | null | undefined): string {
	if (!date) return '—';
	const diff = (new Date(date).getTime() - Date.now()) / 1000;
	const abs = Math.abs(diff);
	if (abs < 45) return 'just now';
	if (abs < 3600) return RTF.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return RTF.format(Math.round(diff / 3600), 'hour');
	return RTF.format(Math.round(diff / 86400), 'day');
}

/** "27 Oct, 15:42" in the viewer's own time zone. */
export function when(date: Date | string | null | undefined): string {
	if (!date) return '—';
	return new Date(date).toLocaleString('en-IN', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
}

export function plural(n: number, word: string): string {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

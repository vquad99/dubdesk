/** Minutes of video as "2 h 05 min" / "45 min" / "30 s". */
export function hm(minutes: number): string {
	if (!minutes || minutes < 0) return '0 min';
	if (minutes < 1) return `${Math.round(minutes * 60)} s`;
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes - h * 60);
	if (h === 0) return `${m} min`;
	return m === 60 ? `${h + 1} h` : `${h} h ${String(m).padStart(2, '0')} min`;
}

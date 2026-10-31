/**
 * CSV for spreadsheets. A cell that starts with = + - @ (or a tab / CR) is prefixed with ' so Excel
 * shows it as text instead of running it as a formula (CSV injection). Numbers stay numbers.
 */
export function csvCell(v: unknown): string {
	if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
	let s = String(v ?? '');
	if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	return `"${s.replace(/"/g, '""')}"`;
}

export function csvResponse(name: string, head: string[], rows: unknown[][]): Response {
	const body = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
	return new Response(body, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${name.replace(/[^A-Za-z0-9_.-]/g, '_')}"`,
			'Cache-Control': 'no-store'
		}
	});
}

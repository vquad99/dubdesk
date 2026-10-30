import { listActivity } from '#lib/server/activity.ts';
import { describe } from '#lib/activity.ts';
import type { RequestHandler } from './$types';

const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const isDate = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);

/** The activity log as CSV, same filters as the page, up to 5,000 newest rows. */
export const GET: RequestHandler = async ({ url }) => {
	const { rows } = await listActivity({
		userId: Number(url.searchParams.get('user')) || undefined,
		action: (url.searchParams.get('action') ?? '').replace(/[^a-z._]/g, '') || undefined,
		from: isDate(url.searchParams.get('from')),
		to: isDate(url.searchParams.get('to')),
		limit: 5000
	});
	const head = ['When (UTC)', 'Person', 'Action', 'What', 'Video', 'Details', 'IP'];
	const body = rows.map((r) => [
		new Date(r.created_at).toISOString(),
		r.user_name ?? '',
		r.action,
		describe(r.action).label,
		r.video_title ?? '',
		r.details ?? '',
		r.ip ?? ''
	]);
	const csv = '﻿' + [head, ...body].map((r) => r.map(cell).join(',')).join('\r\n');
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="dubdesk_activity_${new Date().toISOString().slice(0, 10)}.csv"`
		}
	});
};

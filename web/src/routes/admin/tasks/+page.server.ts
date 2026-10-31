import { listTasks } from '#lib/server/jobs.ts';
import { sarvamEnabled } from '#lib/server/sarvam.ts';
import type { PageServerLoad } from './$types';

const ALLOWED = new Set(['queued', 'assigned', 'submitted', 'approved', 'done', 'failed', 'uploaded', 'dubbing', 'processing', 'on_hold', 'trouble']);
const PER_PAGE = 50;

export const load: PageServerLoad = async ({ url }) => {
	const status = url.searchParams.get('status') ?? '';
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const tasks = await listTasks({
		status: ALLOWED.has(status) ? status : undefined,
		q: q || undefined,
		limit: PER_PAGE,
		offset: (page - 1) * PER_PAGE
	});
	return { status, q, page, perPage: PER_PAGE, total: tasks.total, tasks: [...tasks], sarvam: sarvamEnabled() };
};

import { checkQueue, listTasks } from '#lib/server/jobs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
	const [tasks, queue] = await Promise.all([listTasks({ limit: 100, offset: (page - 1) * 100 }), checkQueue()]);
	return { page, total: tasks.total, tasks: [...tasks], queue };
};

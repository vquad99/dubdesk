import { query } from '#lib/server/db.ts';
import { listTasks, overviewStats } from '#lib/server/jobs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [stats, needsYou, activity] = await Promise.all([
		overviewStats(),
		listTasks({ status: 'submitted' }),
		query<{ video_id: number; title: string; action: string; note: string | null; user_name: string | null; created_at: Date }>(
			`SELECT v.id AS video_id, v.title, e.action, e.note, u.name AS user_name, e.created_at
			   FROM job_events e JOIN jobs j ON j.id = e.job_id JOIN videos v ON v.id = j.video_id
			   LEFT JOIN users u ON u.id = e.user_id
			  ORDER BY e.created_at DESC, e.id DESC LIMIT 8`
		)
	]);
	return { ...stats, needsYou, activity };
};

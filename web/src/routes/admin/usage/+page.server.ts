import { fail } from '@sveltejs/kit';
import { activeMonths, loadSettings, periodOf, saveSettings, usageByPerson, usageByVideo } from '#lib/server/usage.ts';
import { sarvamEnabled } from '#lib/server/sarvam.ts';
import { track } from '#lib/server/activity.ts';
import { query } from '#lib/server/db.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const period = periodOf(url.searchParams.get('month'));
	const thisMonth = periodOf(null);
	const [settings, people, videos, months, [month], [total]] = await Promise.all([
		loadSettings(),
		usageByPerson(period.from, period.to),
		usageByVideo(period.from, period.to),
		activeMonths(),
		query<{ minutes: number; videos: number }>(
			`SELECT COALESCE(SUM(minutes), 0)::float AS minutes, COUNT(*)::int AS videos FROM credits_log WHERE created_at >= $1 AND created_at < $2`,
			[thisMonth.from, thisMonth.to]
		),
		query<{ minutes: number; videos: number }>(
			`SELECT COALESCE(SUM(minutes), 0)::float AS minutes, COUNT(*)::int AS videos FROM credits_log WHERE created_at >= $1 AND created_at < $2`,
			[period.from, period.to]
		)
	]);
	return { period: period.key, months, settings, people, videos, month, total, connected: sarvamEnabled() };
};

export const actions: Actions = {
	settings: async (event) => {
		const f = await event.request.formData();
		const ratePerMin = Number(f.get('rate'));
		const monthlyMinutes = Number(f.get('limit'));
		const currency = String(f.get('currency') ?? '₹').trim().slice(0, 5) || '₹';
		if (!Number.isFinite(ratePerMin) || ratePerMin < 0 || ratePerMin > 100000) return fail(400, { error: 'Price per minute must be a number.' });
		if (!Number.isFinite(monthlyMinutes) || monthlyMinutes < 0 || monthlyMinutes > 10_000_000) return fail(400, { error: 'Monthly minutes must be a number.' });
		await saveSettings({ ratePerMin, currency, monthlyMinutes }, event.locals.user!.id);
		await track(event, 'settings.sarvam', { details: `${currency}${ratePerMin}/min, plan ${monthlyMinutes} min/month` });
		return { message: 'Saved.' };
	}
};

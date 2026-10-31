import { fail } from '@sveltejs/kit';
import { buckets, live, loadPayRates, people, rangeOf, savePayRates, trend, type Gran } from '#lib/server/analytics.ts';
import { track } from '#lib/server/activity.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const r = rangeOf(url.searchParams);
	const g = url.searchParams.get('gran');
	const gran: Gran = g === 'week' || g === 'month' ? g : 'day';
	const userId = Number(url.searchParams.get('user')) || null;
	const rates = await loadPayRates();
	const [rows, everyone, now] = await Promise.all([trend(gran, r, userId), people(r, rates), live()]);
	return { range: r, gran, userId, rates, labels: buckets(gran, r), rows, people: everyone, live: now };
};

const num = (f: FormData, k: string) => {
	const v = Number(String(f.get(k) ?? '0').trim() || 0);
	return Number.isFinite(v) && v >= 0 && v <= 1_000_000 ? v : NaN;
};

export const actions: Actions = {
	rates: async (event) => {
		const f = await event.request.formData();
		const perMin = num(f, 'perMin');
		const perHour = num(f, 'perHour');
		const perLine = num(f, 'perLine');
		if ([perMin, perHour, perLine].some(Number.isNaN)) return fail(400, { error: 'Rates must be numbers of 0 or more.' });
		const currency = String(f.get('currency') ?? '₹').trim().slice(0, 5) || '₹';
		await savePayRates({ perMin, perHour, perLine, currency }, event.locals.user!.id);
		await track(event, 'settings.pay', { details: `${currency}${perMin}/approved min, ${currency}${perHour}/hour, ${currency}${perLine}/line` });
		return { message: 'Pay rates saved.' };
	}
};

import { json } from '@sveltejs/kit';
import { live } from '#lib/server/analytics.ts';
import type { RequestHandler } from './$types';

/** Live monitor data, polled by the analytics page every 20 s. Admins only (hooks gate /api/admin). */
export const GET: RequestHandler = async () => json(await live(), { headers: { 'cache-control': 'no-store' } });

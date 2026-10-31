import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getSession, homeFor, SESSION_COOKIE, type Role } from '#lib/server/session.ts';
import { startWorker } from '#lib/server/worker.ts';
import { allow } from '#lib/server/throttle.ts';

export const init: ServerInit = () => {
	if (!building) startWorker();
};

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 1500);

// The ONE place access is decided. Every page and API route sits behind it.
const PUBLIC = ['/login', '/healthz', '/robots.txt'];
const AREAS: [prefix: string, roles: Role[]][] = [
	['/admin', ['admin']],
	['/review', ['reviewer', 'admin', 'operator']], // operators: only the check of a submitted job (see review/[id])
	['/operator', ['operator', 'admin']],
	['/api/admin', ['admin']],
	['/api/review', ['reviewer', 'admin', 'operator']],
	['/api/operator', ['operator', 'admin']]
	// /api/media and /profile are open to every signed-in role
];

// Requests per minute. Media is seeked in many small Range requests, so it gets more room.
// Signed-in people are limited one by one; a whole office often shares one internet address, so the
// per-address limit is a much higher flood guard (and the only limit before someone signs in).
const LIMITS = { page: 300, api: 600, media: 2400 };
const PER_ADDRESS = { page: 3000, api: 12000, media: 30000 };
const ANON = { page: 300, api: 600, media: 600 };

const prefixed = (path: string, p: string) => path === p || path.startsWith(p + '/');

function harden(res: Response, https: boolean, path: string): Response {
	const h = res.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	if (!h.has('Referrer-Policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
	h.set('Cross-Origin-Opener-Policy', 'same-origin');
	h.set('Cross-Origin-Resource-Policy', 'same-origin');
	h.set('X-Permitted-Cross-Domain-Policies', 'none');
	h.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	if (https) h.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
	// Private data must never sit in a shared or back-button cache. Media and built assets set their own.
	if (!path.startsWith('/_app/') && !path.startsWith('/api/media/') && !h.has('Cache-Control')) {
		h.set('Cache-Control', 'no-store');
	}
	return res;
}

/** gzip text answers (pages, JSON, CSV) on the fly; built assets are already pre-compressed. */
function compress(req: Request, res: Response): Response {
	const type = res.headers.get('content-type') ?? '';
	if (
		!res.body ||
		res.headers.has('content-encoding') ||
		!/text\/html|application\/json|text\/csv|text\/plain|image\/svg/.test(type) ||
		!/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '') ||
		Number(res.headers.get('content-length') ?? 2000) < 1024
	) {
		return res;
	}
	const headers = new Headers(res.headers);
	headers.set('Content-Encoding', 'gzip');
	headers.delete('Content-Length');
	headers.append('Vary', 'Accept-Encoding');
	return new Response(res.body.pipeThrough(new CompressionStream('gzip')), { status: res.status, statusText: res.statusText, headers });
}

function tooMany(retryAfter: number) {
	return new Response('Too many requests. Slow down and try again shortly.', {
		status: 429,
		headers: { 'Retry-After': String(retryAfter), 'Content-Type': 'text/plain' }
	});
}

export const handle: Handle = async (input) => {
	const t0 = performance.now();
	const res = compress(input.event.request, await gate(input));
	const ms = performance.now() - t0;
	if (ms > SLOW_MS) console.warn(`[slow] ${input.event.request.method} ${input.event.url.pathname} ${Math.round(ms)} ms ${res.status}`);
	return res;
};

const gate: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const method = event.request.method;
	const https = event.url.protocol === 'https:';
	const done = async (r: Response | Promise<Response>) => harden(await r, https, path);

	// Built assets: no session lookup, no limits (immutable).
	if (path.startsWith('/_app/')) return done(resolve(event));

	let ip = 'unknown';
	try {
		ip = event.getClientAddress();
	} catch {
		/* behind a proxy without the address header */
	}

	// Cross-site writes are refused outright, for pages (form actions) and the API alike: a same-site
	// request always carries a matching Origin (or Sec-Fetch-Site), so only a forged one lacks it.
	if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
		const origin = event.request.headers.get('origin');
		const site = event.request.headers.get('sec-fetch-site');
		if ((origin && origin !== event.url.origin) || (!origin && site && site !== 'same-origin' && site !== 'none')) {
			return done(new Response('Cross-site request refused', { status: 403, headers: { 'Content-Type': 'text/plain' } }));
		}
	}

	const kind = path.startsWith('/api/media/') ? 'media' : path.startsWith('/api/') ? 'api' : 'page';
	const byAddress = allow(`${kind}:${ip}`, PER_ADDRESS[kind], 60_000);
	if (!byAddress.ok) return done(tooMany(byAddress.retryAfter));

	const session = await getSession(event.cookies.get(SESSION_COOKIE));
	const lim = session
		? allow(`${kind}:u${session.user.id}`, LIMITS[kind], 60_000)
		: allow(`${kind}:anon:${ip}`, ANON[kind], 60_000);
	if (!lim.ok) return done(tooMany(lim.retryAfter));
	event.locals.user = session && !session.pending2fa ? session.user : null;
	event.locals.pending = session?.pending2fa ? session.user : null;
	event.locals.sessionId = session?.sessionId ?? null;

	// Password accepted but 2-step code still owed: only the code page and logout.
	if (event.locals.pending && !prefixed(path, '/login') && path !== '/logout') {
		if (path.startsWith('/api/')) return done(new Response('Two-step code required', { status: 401 }));
		redirect(303, '/login/2fa');
	}

	if (PUBLIC.some((p) => prefixed(path, p))) return done(resolve(event));

	const user = event.locals.user;
	if (!user) {
		if (path.startsWith('/api/')) return done(new Response('Not logged in', { status: 401 }));
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	const area = AREAS.find(([prefix]) => prefixed(path, prefix));
	if (area && !area[1].includes(user.role)) {
		if (path.startsWith('/api/')) return done(new Response('Forbidden', { status: 403 }));
		redirect(303, homeFor(user.role));
	}

	return done(resolve(event));
};

// Log the real error on the server; the visitor sees a plain message and a reference.
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'app' || kind === 'validation') return { message: error.message };
	if (kind === 'framework' && error.status < 500) return { message: error.message };
	const ref = crypto.randomUUID().slice(0, 8);
	console.error(`[error ${ref}] ${event.request.method} ${event.url.pathname}`, error);
	return { message: `Something went wrong (ref ${ref}).` };
};

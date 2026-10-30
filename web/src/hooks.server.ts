import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError, ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { getSessionUser, homeFor, SESSION_COOKIE, type Role } from '#lib/server/session.ts';
import { startWorker } from '#lib/server/worker.ts';

export const init: ServerInit = () => {
	if (!building) startWorker();
};

const SLOW_MS = Number(process.env.SLOW_REQUEST_MS ?? 1500);

// The ONE place access is decided. Every page and API route sits behind it.
const PUBLIC = ['/login', '/healthz'];
const AREAS: [prefix: string, roles: Role[]][] = [
	['/admin', ['admin']],
	['/review', ['reviewer', 'admin']],
	['/operator', ['operator', 'admin']],
	['/api/admin', ['admin']],
	['/api/review', ['reviewer', 'admin']],
	['/api/operator', ['operator', 'admin']]
	// /api/media is open to every logged-in role
];

function withSecurityHeaders(res: Response, https: boolean): Response {
	const h = res.headers;
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('X-Frame-Options', 'DENY');
	h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	h.set('Cross-Origin-Opener-Policy', 'same-origin');
	if (https) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	return res;
}

export const handle: Handle = async (input) => {
	const t0 = performance.now();
	const res = await gate(input);
	const ms = performance.now() - t0;
	if (ms > SLOW_MS) console.warn(`[slow] ${input.event.request.method} ${input.event.url.pathname} ${Math.round(ms)} ms ${res.status}`);
	return res;
};

const gate: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const https = event.url.protocol === 'https:';
	event.locals.user = await getSessionUser(event.cookies.get(SESSION_COOKIE));

	if (PUBLIC.some((p) => path === p || path.startsWith(p + '/'))) {
		return withSecurityHeaders(await resolve(event), https);
	}

	const user = event.locals.user;
	if (!user) {
		if (path.startsWith('/api/')) return withSecurityHeaders(new Response('Not logged in', { status: 401 }), https);
		redirect(303, `/login?next=${encodeURIComponent(path + event.url.search)}`);
	}

	const area = AREAS.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'));
	if (area && !area[1].includes(user.role)) {
		if (path.startsWith('/api/')) return withSecurityHeaders(new Response('Forbidden', { status: 403 }), https);
		redirect(303, homeFor(user.role));
	}

	return withSecurityHeaders(await resolve(event), https);
};

// Log the real error on the server; the visitor sees a plain message and a reference.
export const handleError: HandleServerError = ({ kind, error, event }) => {
	if (kind === 'app' || kind === 'validation') return { message: error.message };
	if (kind === 'framework' && error.status < 500) return { message: error.message };
	const ref = crypto.randomUUID().slice(0, 8);
	console.error(`[error ${ref}] ${event.request.method} ${event.url.pathname}`, error);
	return { message: `Something went wrong (ref ${ref}).` };
};

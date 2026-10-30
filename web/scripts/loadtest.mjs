// Load test: N simultaneous users against a running DubDesk.
// Usage: BASE=http://localhost:3399 DATABASE_URL=... node scripts/loadtest.mjs [connections] [seconds]
import autocannon from 'autocannon';
import pg from 'pg';

const BASE = process.env.BASE ?? 'http://localhost:3399';
const C = Number(process.argv[2] ?? 100);
const D = Number(process.argv[3] ?? 15);
const H = { 'x-forwarded-proto': 'http', origin: BASE };

async function login(email, password) {
	const res = await fetch(`${BASE}/login`, {
		method: 'POST',
		redirect: 'manual',
		headers: { ...H, accept: 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ email, password })
	});
	const c = res.headers.getSetCookie().find((x) => x.startsWith('dqc_session='));
	if (!c) throw new Error(`login failed for ${email}`);
	return c.split(';')[0];
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const admin = await login('admin@test.local', 'adminpass123');
const rev = await login('rev@test.local', 'revpass1234');
const [{ id: revId }] = (await db.query(`SELECT id FROM users WHERE email = 'rev@test.local'`)).rows;
const [job] = (
	await db.query(
		`UPDATE jobs SET status = 'assigned', assigned_to = $1, assigned_at = now(), locked_until = now() + interval '4 hours'
		  WHERE id = (SELECT id FROM jobs ORDER BY id DESC LIMIT 1) RETURNING id, video_id`,
		[revId]
	)
).rows;
const segs = (await db.query('SELECT id, hi_text FROM segments WHERE video_id = $1 AND deleted_at IS NULL', [job.video_id])).rows;

function run(title, opts) {
	return new Promise((ok, bad) => {
		autocannon({ url: BASE, connections: C, duration: D, headers: H, ...opts }, (err, r) => {
			if (err) return bad(err);
			const non2xx = r.non2xx + r.errors + r.timeouts;
			console.log(
				`${title.padEnd(34)} req/s ${String(Math.round(r.requests.average)).padStart(5)}  ` +
					`p50 ${r.latency.p50} ms  p99 ${r.latency.p99} ms  max ${r.latency.max} ms  failed ${non2xx}/${r.requests.total}`
			);
			ok(r);
		});
	});
}

console.log(`${C} simultaneous users, ${D} s each scenario\n`);
await run('Admin overview page', { requests: [{ method: 'GET', path: '/admin', headers: { ...H, cookie: admin } }] });
await run('Tasks list page', { requests: [{ method: 'GET', path: '/admin/tasks', headers: { ...H, cookie: admin } }] });
await run('Review screen (load job + lines)', { requests: [{ method: 'GET', path: `/review/${job.id}`, headers: { ...H, cookie: rev } }] });
await run('Waveform file', { requests: [{ method: 'GET', path: `/api/media/${job.video_id}/peaks`, headers: { ...H, cookie: rev } }] });
await run('Autosave (write, same job)', {
	requests: [
		{
			method: 'POST',
			path: `/api/review/jobs/${job.id}/segments`,
			headers: { ...H, cookie: rev, 'content-type': 'application/json' },
			setupRequest: (req) => {
				const s = segs[Math.floor(Math.random() * segs.length)];
				req.body = JSON.stringify({ changes: [{ id: s.id, comment: `load ${Math.random().toString(36).slice(2, 8)}` }] });
				return req;
			}
		}
	]
});
await db.query(`UPDATE segments SET comment = NULL WHERE video_id = $1 AND comment LIKE 'load %'`, [job.video_id]);
await db.query(`DELETE FROM segment_edits WHERE new_value LIKE 'load %' OR old_value LIKE 'load %'`);
await db.query(`DELETE FROM sessions WHERE created_at > now() - interval '10 minutes' AND user_id IN (SELECT id FROM users WHERE email IN ('admin@test.local','rev@test.local'))`);
await db.end();

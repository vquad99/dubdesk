// In-memory request limits per key (address or user). Enough for one web instance;
// with several instances each keeps its own count, which only makes the limit looser.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** True when `key` may make another request in this window. */
export function allow(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
	const now = Date.now();
	const b = buckets.get(key);
	if (!b || b.resetAt <= now) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { ok: true, retryAfter: 0 };
	}
	b.count++;
	return b.count <= limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
}

const g = globalThis as unknown as { __dqcThrottleSweep?: ReturnType<typeof setInterval> };
if (!g.__dqcThrottleSweep) {
	g.__dqcThrottleSweep = setInterval(() => {
		const now = Date.now();
		for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
	}, 60_000);
	g.__dqcThrottleSweep.unref?.();
}

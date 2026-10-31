import { describe, expect, it } from 'vitest';
import { base32, codeAt, verifyCode } from '../src/lib/server/totp.ts';
import { allow } from '../src/lib/server/throttle.ts';

// RFC 6238 appendix B test secret "12345678901234567890" (SHA-1).
const SECRET = base32(Buffer.from('12345678901234567890'));

describe('two-step codes', () => {
	it('match the RFC 6238 test vectors', () => {
		expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
		expect(codeAt(SECRET, Math.floor(59 / 30))).toBe('287082');
		expect(codeAt(SECRET, Math.floor(1111111109 / 30))).toBe('081804');
		expect(codeAt(SECRET, Math.floor(2000000000 / 30))).toBe('279037');
	});
	it('accept the current code and one step of clock drift, refuse a replay', () => {
		const now = 1111111109 * 1000;
		const step = verifyCode(SECRET, '081804', null, now);
		expect(step).toBe(Math.floor(1111111109 / 30));
		expect(verifyCode(SECRET, '081804', step, now)).toBeNull(); // same code twice
		expect(verifyCode(SECRET, '000000', null, now)).toBeNull();
		expect(verifyCode(SECRET, 'abc', null, now)).toBeNull();
	});
});

describe('request limits', () => {
	it('allow up to the limit, then refuse with a wait time', () => {
		const key = `t-${Math.random()}`;
		for (let i = 0; i < 3; i++) expect(allow(key, 3, 60_000).ok).toBe(true);
		const r = allow(key, 3, 60_000);
		expect(r.ok).toBe(false);
		expect(r.retryAfter).toBeGreaterThan(0);
	});
});

import { safeNext } from '../src/lib/server/redirect.ts';
import { csvCell } from '../src/lib/server/csv.ts';

describe('redirect after login', () => {
	it('keeps on-site paths', () => {
		expect(safeNext('/review/12?x=1')).toBe('/review/12?x=1');
	});
	it('refuses anything that could leave the site', () => {
		for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', '/\\/evil.com', '/a\nb', 'evil.com', ''])
			expect(safeNext(bad)).toBeNull();
	});
});

describe('CSV export', () => {
	it('neutralises spreadsheet formulas', () => {
		expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
		expect(csvCell('+1')).toBe(`"'+1"`);
		expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
		expect(csvCell('Asha')).toBe('"Asha"');
		expect(csvCell(12.5)).toBe('12.5');
	});
});

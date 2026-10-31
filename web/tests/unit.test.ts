import { describe, expect, it } from 'vitest';
import { clock, duration, plural } from '../src/lib/format.ts';
import { stageIndex, statusOf } from '../src/lib/status.ts';
import { hashPassword, verifyPassword } from '../src/lib/server/password.ts';

describe('format', () => {
	it('prints line times with hundredths', () => {
		expect(clock(0.92)).toBe('00:00.92');
		expect(clock(75.5)).toBe('01:15.50');
	});
	it('prints lengths', () => {
		expect(duration(300)).toBe('5:00');
		expect(duration(3725)).toBe('1:02:05');
		expect(duration(null)).toBe('—');
	});
	it('pluralises', () => {
		expect(plural(1, 'line')).toBe('1 line');
		expect(plural(3, 'line')).toBe('3 lines');
	});
});

describe('status', () => {
	it('labels every known status and falls back for unknown ones', () => {
		expect(statusOf('submitted').label).toBe('Waiting for check');
		expect(statusOf('some_new_state').label).toBe('some new state');
		expect(statusOf(null).label).toBe('—');
	});
	it('orders stages', () => {
		expect(stageIndex('uploaded')).toBeLessThan(stageIndex('in_review'));
		expect(stageIndex('in_review')).toBeLessThan(stageIndex('done'));
	});
});

describe('password', () => {
	it('verifies the right password and rejects others', () => {
		const stored = hashPassword('correct horse');
		expect(stored.startsWith('scrypt$')).toBe(true);
		expect(verifyPassword('correct horse', stored)).toBe(true);
		expect(verifyPassword('wrong', stored)).toBe(false);
		expect(verifyPassword('x', 'not-a-hash')).toBe(false);
	});
	it('salts every hash', () => {
		expect(hashPassword('same')).not.toBe(hashPassword('same'));
	});
});

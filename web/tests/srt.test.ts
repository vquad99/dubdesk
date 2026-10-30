import { describe, expect, it } from 'vitest';
import { pairCues, parseSubtitles, toSrt } from '../src/lib/srt.ts';

const EN = `1
00:00:00,920 --> 00:00:06,460
So we are here
to discuss <i>art</i>.

2
00:00:07,460 --> 00:00:08,940
So as seen,
`;

const HI_VTT = `WEBVTT

00:00.900 --> 00:06.500
तो आज हम कला पर चर्चा करेंगे।

00:07.400 --> 00:09.000 align:start
जैसा कि देखा गया है,
`;

describe('srt', () => {
	it('reads SRT, joins wrapped lines and drops tags', () => {
		const c = parseSubtitles(EN);
		expect(c).toHaveLength(2);
		expect(c[0]).toEqual({ start: 0.92, end: 6.46, text: 'So we are here to discuss art.' });
	});
	it('reads VTT with short times and cue settings', () => {
		const c = parseSubtitles(HI_VTT);
		expect(c).toHaveLength(2);
		expect(c[1].start).toBe(7.4);
		expect(c[1].end).toBe(9);
	});
	it('pairs English to the Hindi line it overlaps most, keeping Hindi timing', () => {
		const p = pairCues(parseSubtitles(EN), parseSubtitles(HI_VTT));
		expect(p).toHaveLength(2);
		expect(p[0].en).toBe('So we are here to discuss art.');
		expect(p[1].en).toBe('So as seen,');
		expect(p[1].start).toBe(7.4);
	});
	it('never drops English text even when two cues fall on one Hindi line', () => {
		const en = parseSubtitles(EN);
		const hi = [{ start: 0, end: 10, text: 'सब' }];
		expect(pairCues(en, hi)[0].en).toBe('So we are here to discuss art. So as seen,');
	});
	it('writes SRT that reads back the same', () => {
		const c = parseSubtitles(EN);
		expect(parseSubtitles(toSrt(c))).toEqual(c);
		expect(toSrt(c)).toContain('00:00:00,920 --> 00:00:06,460');
	});
});

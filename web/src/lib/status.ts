// One place for every status word and colour shown in the app.
export type Tone = 'neutral' | 'info' | 'warn' | 'accent' | 'ok' | 'danger';

const STATUS: Record<string, { label: string; tone: Tone }> = {
	// videos
	uploading: { label: 'Uploading', tone: 'neutral' },
	uploaded: { label: 'Needs lines', tone: 'warn' },
	processing: { label: 'Reading file', tone: 'info' },
	dubbing: { label: 'Dubbing', tone: 'info' },
	ready_for_review: { label: 'Ready for review', tone: 'warn' },
	in_review: { label: 'In review', tone: 'info' },
	submitted: { label: 'Waiting for check', tone: 'accent' },
	regenerating: { label: 'Regenerating', tone: 'info' },
	done: { label: 'Done', tone: 'ok' },
	failed: { label: 'Failed', tone: 'danger' },
	// jobs
	queued: { label: 'In queue', tone: 'warn' },
	assigned: { label: 'With reviewer', tone: 'info' },
	returned: { label: 'Sent back', tone: 'danger' },
	approved: { label: 'Approved', tone: 'ok' },
	on_hold: { label: 'Stopped', tone: 'danger' }
};

export function statusOf(status: string | null | undefined): { label: string; tone: Tone } {
	if (!status) return { label: '—', tone: 'neutral' };
	return STATUS[status] ?? { label: status.replaceAll('_', ' '), tone: 'neutral' };
}

export const FLAG_LABEL: Record<string, string> = {
	missing: 'Missing',
	wrong_meaning: 'Wrong meaning',
	wrong_timing: 'Wrong timing'
};

/** Order of the stages a video moves through, for progress steppers. */
export const STAGES = [
	{ key: 'uploaded', label: 'Uploaded' },
	{ key: 'dubbing', label: 'Dubbed' },
	{ key: 'review', label: 'In review' },
	{ key: 'submitted', label: 'Checked' },
	{ key: 'done', label: 'Done' }
] as const;

export function stageIndex(videoStatus: string): number {
	switch (videoStatus) {
		case 'uploading':
		case 'uploaded':
			return 0;
		case 'dubbing':
			return 1;
		case 'ready_for_review':
		case 'in_review':
			return 2;
		case 'submitted':
		case 'regenerating':
			return 3;
		case 'done':
			return 4;
		default:
			return 0;
	}
}

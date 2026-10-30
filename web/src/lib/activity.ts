// Plain words for every recorded action, shared by the profile, the activity log and the CSV export.
import type { Tone } from './status.ts';

export type ActivityKind = { label: string; tone: Tone; group: string };

export const ACTIVITY: Record<string, ActivityKind> = {
	'auth.login': { label: 'logged in', tone: 'neutral', group: 'auth' },
	'auth.logout': { label: 'logged out', tone: 'neutral', group: 'auth' },
	'auth.login_failed': { label: 'failed to log in', tone: 'danger', group: 'auth' },
	'auth.login_blocked': { label: 'was blocked after too many tries', tone: 'danger', group: 'auth' },
	'job.created': { label: 'created the review job for', tone: 'neutral', group: 'job' },
	'job.claimed': { label: 'picked up', tone: 'info', group: 'job' },
	'job.released': { label: 'gave back', tone: 'warn', group: 'job' },
	'job.expired': { label: 'lost the lock on', tone: 'warn', group: 'job' },
	'job.submitted': { label: 'sent for approval', tone: 'accent', group: 'job' },
	'job.approved': { label: 'approved', tone: 'ok', group: 'job' },
	'job.returned': { label: 'sent back', tone: 'danger', group: 'job' },
	'job.unlocked': { label: 'took back from the reviewer', tone: 'warn', group: 'job' },
	'job.regenerated': { label: 'regenerated', tone: 'info', group: 'job' },
	'line.edited': { label: 'edited lines in', tone: 'info', group: 'line' },
	'line.replaced': { label: 'used find & replace in', tone: 'info', group: 'line' },
	'line.split': { label: 'split a line in', tone: 'info', group: 'line' },
	'line.joined': { label: 'joined lines in', tone: 'info', group: 'line' },
	'line.added': { label: 'added a line to', tone: 'info', group: 'line' },
	'line.removed': { label: 'removed a line from', tone: 'warn', group: 'line' },
	'video.upload_started': { label: 'started uploading', tone: 'neutral', group: 'video' },
	'video.uploaded': { label: 'uploaded', tone: 'ok', group: 'video' },
	'video.upload_cancelled': { label: 'cancelled an upload', tone: 'warn', group: 'video' },
	'video.subtitles_loaded': { label: 'loaded subtitles for', tone: 'neutral', group: 'video' },
	'video.sent_to_sarvam': { label: 'sent to Sarvam', tone: 'info', group: 'video' },
	'video.reprocessed': { label: 'reprocessed', tone: 'neutral', group: 'video' },
	'file.downloaded': { label: 'downloaded', tone: 'neutral', group: 'file' },
	'user.created': { label: 'added a user', tone: 'accent', group: 'user' },
	'user.updated': { label: 'changed a user', tone: 'accent', group: 'user' },
	'user.password_set': { label: "set a user's password", tone: 'accent', group: 'user' }
};

export const ACTIVITY_GROUPS = [
	{ key: '', label: 'All actions' },
	{ key: 'auth.', label: 'Logins' },
	{ key: 'job.', label: 'Jobs' },
	{ key: 'line.', label: 'Line edits' },
	{ key: 'video.', label: 'Videos' },
	{ key: 'file.', label: 'Downloads' },
	{ key: 'user.', label: 'Users' }
];

export function describe(action: string): ActivityKind {
	return ACTIVITY[action] ?? { label: action.replace(/[._]/g, ' '), tone: 'neutral', group: action.split('.')[0] };
}

/** 3725 -> "1 h 2 min", 125 -> "2 min", 20 -> "< 1 min" */
export function workTime(seconds: number): string {
	if (!seconds) return '0 min';
	if (seconds < 60) return '< 1 min';
	const h = Math.floor(seconds / 3600);
	const m = Math.round((seconds % 3600) / 60);
	return h ? `${h} h ${m} min` : `${m} min`;
}

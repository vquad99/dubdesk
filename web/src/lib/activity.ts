// Plain words for every recorded action, shared by the profile, the activity log and the CSV export.
import type { Tone } from './status.ts';

export type ActivityKind = { label: string; tone: Tone; group: string };

export const ACTIVITY: Record<string, ActivityKind> = {
	'auth.login': { label: 'logged in', tone: 'neutral', group: 'auth' },
	'auth.logout': { label: 'logged out', tone: 'neutral', group: 'auth' },
	'auth.login_failed': { label: 'failed to log in', tone: 'danger', group: 'auth' },
	'auth.login_blocked': { label: 'was blocked after too many tries', tone: 'danger', group: 'auth' },
	'auth.password_ok': { label: 'entered the right password', tone: 'neutral', group: 'auth' },
	'auth.2fa_failed': { label: 'gave a wrong 2-step code', tone: 'danger', group: 'auth' },
	'auth.2fa_enabled': { label: 'turned on two-step login', tone: 'ok', group: 'auth' },
	'auth.2fa_disabled': { label: 'turned off two-step login', tone: 'warn', group: 'auth' },
	'auth.password_changed': { label: 'changed their password', tone: 'accent', group: 'auth' },
	'auth.sessions_ended': { label: 'logged out other devices', tone: 'neutral', group: 'auth' },
	'auth.reset_requested': { label: 'asked for a password reset', tone: 'warn', group: 'auth' },
	'auth.password_reset': { label: 'set a new password with a link', tone: 'accent', group: 'auth' },
	'user.2fa_reset': { label: "reset a user's two-step login", tone: 'accent', group: 'user' },
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
	'user.password_set': { label: "set a user's password", tone: 'accent', group: 'user' },
	'user.reset_link': { label: 'made a password link for a user', tone: 'accent', group: 'user' },
	'user.bulk_created': { label: 'added users in bulk', tone: 'accent', group: 'user' },
	'settings.sarvam': { label: 'changed the Sarvam price / plan', tone: 'accent', group: 'user' },
	'settings.pay': { label: 'changed the default pay rates', tone: 'accent', group: 'user' }
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

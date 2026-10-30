<script lang="ts">
	import {
		LogIn,
		LogOut,
		ShieldAlert,
		Hand,
		Undo2,
		Send,
		CircleCheck,
		Unlock,
		Pencil,
		Scissors,
		Merge,
		Plus,
		Trash2,
		Replace,
		Upload,
		FileText,
		Download,
		UserCog,
		RefreshCw,
		Activity
	} from '@lucide/svelte';
	import { describe } from '#lib/activity.ts';
	import { ago, when } from '#lib/format.ts';

	type Row = {
		id: number;
		user_id: number | null;
		user_name: string | null;
		action: string;
		video_id: number | null;
		video_title: string | null;
		details: string | null;
		ip?: string | null;
		created_at: Date | string;
	};

	let {
		rows,
		showUser = true,
		showIp = false,
		linkVideos = false
	}: { rows: Row[]; showUser?: boolean; showIp?: boolean; linkVideos?: boolean } = $props();

	const ICON: Record<string, typeof Activity> = {
		'auth.login': LogIn,
		'auth.logout': LogOut,
		'auth.login_failed': ShieldAlert,
		'auth.login_blocked': ShieldAlert,
		'job.claimed': Hand,
		'job.released': Undo2,
		'job.expired': Undo2,
		'job.submitted': Send,
		'job.approved': CircleCheck,
		'job.returned': Undo2,
		'job.unlocked': Unlock,
		'job.regenerated': RefreshCw,
		'line.edited': Pencil,
		'line.replaced': Replace,
		'line.split': Scissors,
		'line.joined': Merge,
		'line.added': Plus,
		'line.removed': Trash2,
		'video.upload_started': Upload,
		'video.uploaded': Upload,
		'video.subtitles_loaded': FileText,
		'video.sent_to_sarvam': Send,
		'video.reprocessed': RefreshCw,
		'file.downloaded': Download,
		'user.created': UserCog,
		'user.updated': UserCog,
		'user.password_set': UserCog
	};
</script>

<ol class="feed">
	{#each rows as r (r.id)}
		{@const k = describe(r.action)}
		{@const Icon = ICON[r.action] ?? Activity}
		<li>
			<span class="ico {k.tone}"><Icon size={14} /></span>
			<div class="body">
				<p>
					{#if showUser}
						{#if r.user_id}<a class="who" href="/admin/users/{r.user_id}">{r.user_name}</a>{:else}<span class="who sys">System</span>{/if}
					{/if}
					{k.label}
					{#if r.video_title}
						{#if linkVideos}<a href="/admin/tasks/{r.video_id}">{r.video_title}</a>{:else}<strong>{r.video_title}</strong>{/if}
					{/if}
				</p>
				{#if r.details}<p class="details">{r.details}</p>{/if}
				<span class="meta" title={when(r.created_at)}>{ago(r.created_at)} · {when(r.created_at)}{#if showIp && r.ip} · {r.ip}{/if}</span>
			</div>
		</li>
	{/each}
</ol>

<style>
	.feed {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
		font-size: 14px;
	}
	li:last-child {
		border-bottom: none;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		flex: none;
		border-radius: 10px;
	}
	.neutral {
		background: var(--surface-2);
		color: var(--text-2);
	}
	.info {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.warn {
		background: #fff3e0;
		color: #a5460f;
	}
	.accent {
		background: #fceaf0;
		color: #871f4b;
	}
	.ok {
		background: #e3f1d8;
		color: #385418;
	}
	.danger {
		background: #fde7e2;
		color: #a21913;
	}
	.body {
		min-width: 0;
		display: grid;
		gap: 2px;
	}
	.who {
		color: var(--text);
		font-weight: 500;
	}
	.sys {
		color: var(--muted);
	}
	.body strong {
		font-weight: 500;
	}
	.details {
		color: var(--text-2);
		font-size: 13px;
		overflow-wrap: anywhere;
	}
	.meta {
		font-size: 12px;
		color: var(--faint);
	}
</style>

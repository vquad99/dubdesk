<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { ShieldCheck, ShieldAlert, KeyRound, MonitorSmartphone, LogOut } from '@lucide/svelte';
	import Badge from './Badge.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { ago, when } from '#lib/format.ts';

	type Session = { id: string; ip: string | null; user_agent: string | null; created_at: Date; last_seen_at: Date; current: boolean };
	let {
		security,
		form
	}: {
		security: { totp: boolean; canTotp: boolean; passwordChanged: Date | null; sessions: Session[] };
		form: { setup?: { qr: string; secret: string }; error?: string; message?: string; setupFailed?: boolean } | null;
	} = $props();

	let busy = $state(false);
	let setup = $state<{ qr: string; secret: string } | null>(null);
	$effect(() => {
		if (form?.setup) setup = form.setup;
		if (form?.message) setup = null;
	});

	const after: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success' && result.data?.message) toast(String(result.data.message));
			if (result.type === 'failure') toast(String(result.data?.error ?? 'Could not do that.'), 'error', 6000);
			await update({ reset: result.type === 'success' });
		};
	};

	function device(ua: string | null): string {
		if (!ua) return 'Unknown device';
		const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Linux/.test(ua) ? 'Linux' : 'Device';
		const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
		return `${br} on ${os}`;
	}
</script>

<section class="card card-pad sec">
	<div class="head">
		<h2>Security</h2>
		{#if security.totp}<Badge label="Two-step login on" tone="ok" />{:else}<Badge label="Two-step login off" tone="warn" />{/if}
	</div>

	<div class="grid">
		<div class="block">
			<h3>{#if security.totp}<ShieldCheck size={16} />{:else}<ShieldAlert size={16} />{/if} Two-step login</h3>
			{#if security.totp}
				<p class="muted">Each login asks for a 6-digit code from your authenticator app.</p>
				<form method="POST" action="?/disable2fa" use:enhance={after} class="row">
					<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Code to turn off" required />
					<button class="danger sm" disabled={busy}>Turn off</button>
				</form>
			{:else if setup}
				<p class="muted">Scan this with Google Authenticator, Microsoft Authenticator or 1Password, then type the code it shows.</p>
				<div class="qr">{@html setup.qr}</div>
				<p class="key">Or enter this key: <span class="mono">{setup.secret}</span></p>
				<form method="POST" action="?/confirm2fa" use:enhance={after} class="row">
					<input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" required />
					<button class="primary sm" disabled={busy}>Turn on</button>
				</form>
			{:else}
				<p class="muted">Protects your account even if someone learns your password.</p>
				<form method="POST" action="?/start2fa" use:enhance={after}>
					<button class="primary sm" disabled={busy || !security.canTotp} title={security.canTotp ? '' : 'The server needs APP_SECRET first'}>Set up two-step login</button>
				</form>
				{#if !security.canTotp}<p class="small faint">Not available until the admin sets APP_SECRET on the server.</p>{/if}
			{/if}
		</div>

		<div class="block">
			<h3><KeyRound size={16} /> Password</h3>
			<p class="muted">Last changed {security.passwordChanged ? ago(security.passwordChanged) : 'never (set by an admin)'}.</p>
			<form method="POST" action="?/password" use:enhance={after} class="stack">
				<input name="current" type="password" autocomplete="current-password" placeholder="Current password" required />
				<input name="next" type="password" autocomplete="new-password" minlength="10" placeholder="New password (10+ characters)" required />
				<input name="again" type="password" autocomplete="new-password" minlength="10" placeholder="New password again" required />
				<button class="sm" disabled={busy}>Change password</button>
			</form>
		</div>
	</div>

	<div class="block devices">
		<div class="dhead">
			<h3><MonitorSmartphone size={16} /> Where you are logged in</h3>
			{#if security.sessions.length > 1}
				<form method="POST" action="?/endSessions" use:enhance={after}><button class="ghost sm" disabled={busy}><LogOut size={14} /> Log out other devices</button></form>
			{/if}
		</div>
		<ul>
			{#each security.sessions as s (s.id)}
				<li>
					<span><strong>{device(s.user_agent)}</strong>{#if s.current} <Badge label="This device" tone="info" />{/if}</span>
					<span class="faint small">{s.ip ?? 'unknown address'} · signed in {when(s.created_at)} · active {ago(s.last_seen_at)}</span>
				</li>
			{/each}
		</ul>
	</div>
</section>

<style>
	.sec {
		margin-top: 16px;
		display: grid;
		gap: 18px;
	}
	.head,
	.dhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
	}
	.block {
		display: grid;
		gap: 10px;
		align-content: start;
		padding: 18px;
		border-radius: 16px;
		background: var(--surface-2);
	}
	h3 {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.muted {
		font-size: 13.5px;
	}
	.row {
		display: flex;
		gap: 8px;
	}
	.row input {
		flex: 1;
		background: #fff;
	}
	.stack {
		display: grid;
		gap: 8px;
	}
	.stack input {
		background: #fff;
	}
	.stack button {
		justify-self: start;
	}
	.qr {
		width: 200px;
		height: 200px;
		padding: 8px;
		border-radius: 12px;
		background: #fff;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
	}
	.key {
		font-size: 13px;
	}
	.key .mono {
		user-select: all;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	li {
		display: grid;
		gap: 2px;
		font-size: 14px;
	}
	li strong {
		font-weight: 500;
	}
	.small {
		font-size: 12.5px;
	}
	@media (max-width: 900px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>

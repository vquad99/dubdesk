<script lang="ts">
	import { enhance } from '$app/forms';
	import { UserPlus, Pencil, KeyRound } from '@lucide/svelte';
	import Modal from '#lib/components/Modal.svelte';
	import Badge from '#lib/components/Badge.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { ago } from '#lib/format.ts';
	import type { SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	type U = (typeof data.users)[number];

	let addOpen = $state(false);
	let editOpen = $state(false);
	let pwOpen = $state(false);
	let picked = $state<U | null>(null);
	let busy = $state(false);

	const ROLE_TONE = { admin: 'accent', reviewer: 'info', operator: 'warn' } as const;

	const done: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				addOpen = editOpen = pwOpen = false;
				toast(String(result.data?.message ?? 'Saved.'));
				await update();
			} else if (result.type === 'failure') {
				toast(String(result.data?.error ?? 'Could not save.'), 'error');
				await update({ reset: false });
			} else await update();
		};
	};
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Users</h1>
		<p class="sub">Who can log in, and what they can do.</p>
	</div>
	<button class="primary" onclick={() => (addOpen = true)}><UserPlus size={16} /> Add user</button>
</div>

<section class="card">
	<div class="table-wrap">
		<table>
			<thead><tr><th>Person</th><th>Role</th><th>Status</th><th>2-step</th><th>Last login</th><th></th></tr></thead>
			<tbody>
				{#each data.users as u (u.id)}
					<tr class:inactive={!u.active}>
						<td>
							<span class="person">
								<span class="avatar">{u.name.slice(0, 1).toUpperCase()}</span>
								<span><a class="pname" href="/admin/users/{u.id}">{u.name}</a><span class="muted">{u.email}</span></span>
							</span>
						</td>
						<td><Badge label={u.role[0].toUpperCase() + u.role.slice(1)} tone={ROLE_TONE[u.role as keyof typeof ROLE_TONE]} /></td>
						<td><Badge label={u.active ? 'Active' : 'Turned off'} tone={u.active ? 'ok' : 'neutral'} /></td>
						<td>
							{#if u.totp_enabled}
								<form method="POST" action="?/reset2fa" use:enhance={done} class="inline">
									<input type="hidden" name="id" value={u.id} />
									<Badge label="On" tone="ok" />
									<button class="ghost sm" title="Use when they lost their phone">Reset</button>
								</form>
							{:else}<Badge label="Off" tone="neutral" />{/if}
						</td>
						<td class="faint">{u.last_login_at ? ago(u.last_login_at) : 'Never'}</td>
						<td class="right">
							<button class="ghost icon-only" title="Edit role" aria-label="Edit {u.name}" onclick={() => ((picked = u), (editOpen = true))}><Pencil size={15} /></button>
							<button class="ghost icon-only" title="Set password" aria-label="Set password for {u.name}" onclick={() => ((picked = u), (pwOpen = true))}><KeyRound size={15} /></button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

<Modal bind:open={addOpen} title="Add a user">
	<form id="add" method="POST" action="?/add" use:enhance={done} class="stack">
		<label class="field">Name<input name="name" required autocomplete="off" /></label>
		<label class="field">Email<input name="email" type="email" required autocomplete="off" /></label>
		<label class="field">
			Role
			<select name="role">
				<option value="reviewer">Reviewer — checks and fixes lines</option>
				<option value="operator">Operator — sees progress, downloads</option>
				<option value="admin">Admin — everything</option>
			</select>
		</label>
		<label class="field">Password<input name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="At least 8 characters" /></label>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (addOpen = false)}>Cancel</button>
		<button class="primary" form="add" disabled={busy}>Add user</button>
	{/snippet}
</Modal>

<Modal bind:open={editOpen} title="Edit {picked?.name ?? ''}">
	{#if picked}
		<form id="edit" method="POST" action="?/update" use:enhance={done} class="stack">
			<input type="hidden" name="id" value={picked.id} />
			<label class="field">
				Role
				<select name="role" value={picked.role}>
					<option value="reviewer">Reviewer</option>
					<option value="operator">Operator</option>
					<option value="admin">Admin</option>
				</select>
			</label>
			<label class="check"><input type="checkbox" name="active" checked={picked.active} /> Can log in</label>
		</form>
	{/if}
	{#snippet footer()}
		<button class="ghost" onclick={() => (editOpen = false)}>Cancel</button>
		<button class="primary" form="edit" disabled={busy}>Save</button>
	{/snippet}
</Modal>

<Modal bind:open={pwOpen} title="New password for {picked?.name ?? ''}">
	{#if picked}
		<form id="pw" method="POST" action="?/password" use:enhance={done} class="stack">
			<input type="hidden" name="id" value={picked.id} />
			<label class="field">New password<input name="password" type="password" minlength="8" required autocomplete="new-password" /></label>
			<p class="muted small">They will be logged out everywhere and must use the new password.</p>
		</form>
	{/if}
	{#snippet footer()}
		<button class="ghost" onclick={() => (pwOpen = false)}>Cancel</button>
		<button class="primary" form="pw" disabled={busy}>Set password</button>
	{/snippet}
</Modal>

<style>
	.person {
		display: inline-flex;
		align-items: center;
		gap: 12px;
	}
	.person > span:last-child {
		display: grid;
		line-height: 1.35;
	}
	.pname {
		font-weight: 500;
		color: var(--text);
	}
	.pname:hover {
		color: var(--accent);
	}
	.person .muted {
		font-size: 13px;
	}
	.inline {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.right {
		text-align: right;
		white-space: nowrap;
	}
	tr.inactive td {
		opacity: 0.55;
	}
	.stack {
		display: grid;
		gap: 14px;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
	}
	.small {
		font-size: 13px;
	}
</style>

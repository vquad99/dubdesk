<script lang="ts">
	import { enhance } from '$app/forms';
	import { UserPlus, Users, Pencil, KeyRound, Link2, Copy, Download, Upload, BellRing } from '@lucide/svelte';
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
	let bulkOpen = $state(false);
	let resultOpen = $state(false);
	let picked = $state<U | null>(null);
	let busy = $state(false);
	let bulkText = $state('');

	type Made = { name: string; email: string; role: string; link: string; mailed: boolean };
	let made = $state<Made[]>([]);
	let skipped = $state<{ line: string; why: string }[]>([]);
	let oneLink = $state<{ name: string; email: string; url: string; hours: number; mailed: boolean } | null>(null);

	const lasts = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : h === 1 ? '1 hour' : `${h} hours`);

	async function copy(text: string, what = 'Copied.') {
		try {
			await navigator.clipboard.writeText(text);
			toast(what);
		} catch {
			toast('Could not copy. Select the text and copy it.', 'error');
		}
	}

	function downloadCsv() {
		const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
		const rows = [['Name', 'Email', 'Role', 'Set-password link'], ...made.map((m) => [m.name, m.email, m.role, m.link])];
		const blob = new Blob(['\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n')], { type: 'text/csv' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `dubdesk-new-users-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	async function readFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 500_000) return toast('That file is too big for a user list.', 'error');
		bulkText = (await file.text()).replace(/^\ufeff/, '');
	}

	const ROLE_TONE = { admin: 'accent', reviewer: 'info', operator: 'warn' } as const;

	const done: SubmitFunction = () => {
		busy = true;
		return async ({ result, update }) => {
			busy = false;
			if (result.type === 'success') {
				addOpen = editOpen = pwOpen = bulkOpen = false;
				const d = result.data ?? {};
				if (Array.isArray(d.created) && d.created.length) {
					made = d.created as Made[];
					skipped = (d.skipped as typeof skipped) ?? [];
					oneLink = null;
					resultOpen = true;
					bulkText = '';
				} else if (Array.isArray(d.skipped) && d.skipped.length) {
					made = [];
					skipped = d.skipped as typeof skipped;
					oneLink = null;
					resultOpen = true;
				} else if (d.link) {
					oneLink = d.link as NonNullable<typeof oneLink>;
					made = [];
					skipped = [];
					resultOpen = true;
				}
				toast(String(d.message ?? 'Saved.'));
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
	<div class="actions">
		<button onclick={() => (bulkOpen = true)}><Users size={16} /> Add many</button>
		<button class="primary" onclick={() => (addOpen = true)}><UserPlus size={16} /> Add user</button>
	</div>
</div>

{#if data.requests.length}
	<section class="card requests fade-up">
		<div class="req-head"><BellRing size={16} /> <strong>{data.requests.length} password {data.requests.length === 1 ? 'request' : 'requests'}</strong><span class="muted">People who pressed “Forgot password”. Make them a link and send it.</span></div>
		{#each data.requests as r (r.id)}
			<div class="req">
				<span><strong>{r.name}</strong> <span class="muted">{r.email} · {ago(r.created_at)}</span></span>
				<span class="req-actions">
					<form method="POST" action="?/dismissRequest" use:enhance={done}><input type="hidden" name="id" value={r.id} /><button class="ghost sm">Dismiss</button></form>
					<form method="POST" action="?/resetLink" use:enhance={done}><input type="hidden" name="id" value={r.user_id} /><button class="primary sm"><Link2 size={14} /> Make reset link</button></form>
				</span>
			</div>
		{/each}
	</section>
{/if}

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
						<td>
							{#if !u.active}<Badge label="Turned off" tone="neutral" />
							{:else if u.invited}<Badge label="Invited" tone="warn" />
							{:else}<Badge label="Active" tone="ok" />{/if}
						</td>
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
							{#if u.active}
								<form method="POST" action="?/resetLink" use:enhance={done} class="inline">
									<input type="hidden" name="id" value={u.id} />
									<button class="ghost icon-only" title={u.invited ? 'New invite link' : 'Password reset link'} aria-label="Password link for {u.name}"><Link2 size={15} /></button>
								</form>
							{/if}
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
		<label class="field">Password <span class="faint">(optional)</span><input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Leave empty to send an invite link" /></label>
		<p class="muted small">Leave the password empty and they get a link to choose their own{data.mail ? ' by e-mail' : ''}.</p>
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

<Modal bind:open={bulkOpen} title="Add many users">
	<form id="bulk" method="POST" action="?/bulk" use:enhance={done} class="stack">
		<p class="muted small">One person per line: <code>name, email, role</code>. Role is reviewer, operator or admin; leave it out to use the default below. Each person gets a link to set their own password{data.mail ? ', sent by e-mail' : ''}.</p>
		<textarea name="list" rows="9" bind:value={bulkText} placeholder={'Asha Rao, asha@studio.in, reviewer\nRavi Kumar, ravi@studio.in, reviewer\nMeera Iyer, meera@studio.in, operator'} spellcheck="false"></textarea>
		<div class="bulk-row">
			<label class="file btn"><Upload size={15} /> Load CSV<input type="file" accept=".csv,.txt,text/csv,text/plain" onchange={readFile} hidden /></label>
			<label class="field inline-field">
				Default role
				<select name="role">
					<option value="reviewer">Reviewer</option>
					<option value="operator">Operator</option>
					<option value="admin">Admin</option>
				</select>
			</label>
			<span class="faint small">{bulkText.split('\n').filter((l) => l.trim()).length} lines</span>
		</div>
	</form>
	{#snippet footer()}
		<button class="ghost" onclick={() => (bulkOpen = false)}>Cancel</button>
		<button class="primary" form="bulk" disabled={busy || !bulkText.trim()}>Add users</button>
	{/snippet}
</Modal>

<Modal bind:open={resultOpen} title={oneLink ? `Password link for ${oneLink.name}` : made.length ? `${made.length} ${made.length === 1 ? 'user' : 'users'} added` : 'Nobody added'}>
	{#if oneLink}
		<div class="stack">
			<p class="muted small">{oneLink.mailed ? `E-mailed to ${oneLink.email}. You can also send it yourself:` : `Send this to ${oneLink.email} (chat or e-mail).`} It works once, for {lasts(oneLink.hours)}.</p>
			<div class="linkbox"><code>{oneLink.url}</code><button class="sm" onclick={() => copy(oneLink!.url, 'Link copied.')}><Copy size={14} /> Copy</button></div>
		</div>
	{:else}
		<div class="stack">
			{#if made.length}
				<p class="muted small">Each link sets that person's password; it works once, for 7 days. Copy them now — for safety they are not shown again (you can make a new one any time).</p>
				<div class="made">
					{#each made as m (m.email)}
						<div class="made-row">
							<span class="who"><strong>{m.name}</strong><span class="muted">{m.email} · {m.role}{m.mailed ? ' · e-mailed' : ''}</span></span>
							<button class="ghost sm" onclick={() => copy(m.link, `Link for ${m.name} copied.`)}><Copy size={14} /> Link</button>
						</div>
					{/each}
				</div>
			{/if}
			{#if skipped.length}
				<p class="small"><strong>Skipped {skipped.length}:</strong></p>
				<ul class="skipped">
					{#each skipped as s, i (i)}<li><code>{s.line}</code> — {s.why}</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}
	{#snippet footer()}
		{#if made.length}
			<button class="ghost" onclick={() => copy(made.map((m) => `${m.name} <${m.email}>: ${m.link}`).join('\n'), 'All links copied.')}><Copy size={15} /> Copy all</button>
			<button onclick={downloadCsv}><Download size={15} /> Download CSV</button>
		{/if}
		<button class="primary" onclick={() => (resultOpen = false)}>Done</button>
	{/snippet}
</Modal>

<style>
	.actions {
		display: flex;
		gap: 8px;
	}
	.requests {
		margin-bottom: 16px;
		padding: 16px 20px;
		display: grid;
		gap: 10px;
		border: 1px solid var(--orange-soft);
		background: linear-gradient(180deg, var(--orange-soft), var(--panel) 60%);
	}
	.req-head {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--orange);
	}
	.req-head .muted {
		font-size: 13px;
	}
	.req {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		padding-top: 10px;
		border-top: 1px solid var(--line);
	}
	.req .muted {
		font-size: 13px;
	}
	.req-actions {
		display: flex;
		gap: 6px;
	}
	textarea {
		font-family: var(--mono);
		font-size: 13px;
		line-height: 1.6;
		resize: vertical;
	}
	.bulk-row {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
	}
	.inline-field {
		flex: 0 0 180px;
	}
	.file {
		cursor: pointer;
	}
	.linkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
	}
	.linkbox code {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 12.5px;
	}
	.made {
		display: grid;
		max-height: 320px;
		overflow: auto;
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
	}
	.made-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 8px 12px;
	}
	.made-row + .made-row {
		border-top: 1px solid var(--line);
	}
	.who {
		display: grid;
		line-height: 1.35;
	}
	.who .muted {
		font-size: 12.5px;
	}
	.skipped {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
		display: grid;
		gap: 4px;
	}
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

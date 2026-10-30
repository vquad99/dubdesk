<script lang="ts">
	import { goto } from '$app/navigation';
	import { Download, ChevronLeft, ChevronRight, X } from '@lucide/svelte';
	import ActivityList from '#lib/components/ActivityList.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import StatTile from '#lib/components/StatTile.svelte';
	import { ACTIVITY_GROUPS } from '#lib/activity.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// svelte-ignore state_referenced_locally
	let f = $state({ ...data.filters });
	const qs = (extra: Record<string, string | number> = {}) => {
		const p = new URLSearchParams();
		for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== '' && v !== undefined && v !== 1) p.set(k, String(v));
		return p.toString();
	};
	const apply = () => goto(`/admin/activity${qs() ? '?' + qs() : ''}`, { reset: false });
	const clear = () => {
		f = { user: '', action: '', from: '', to: '' };
		apply();
	};
	const filtered = $derived(!!(data.filters.user || data.filters.action || data.filters.from || data.filters.to));
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">Admin</span>
		<h1>Activity log</h1>
		<p class="sub">Every login, job, line change, upload and download — who, what, when and from where.</p>
	</div>
	<a class="btn" href="/api/admin/activity.csv{qs() ? '?' + qs() : ''}"><Download size={15} /> Export CSV</a>
</div>

<section class="tiles">
	<StatTile label="Actions today" value={data.today.actions} />
	<StatTile label="People active today" value={data.today.people} />
	<StatTile label="Working time today" value="{data.today.minutes} min" />
	<StatTile label="Logins today" value={data.today.logins} hint={data.today.failed ? `${data.today.failed} failed` : 'no failed logins'} />
</section>

<section class="card">
	<div class="filters">
		<label class="field">
			Person
			<select bind:value={f.user} onchange={apply}>
				<option value="">Everyone</option>
				{#each data.people as u (u.id)}<option value={u.id}>{u.name} · {u.role}</option>{/each}
			</select>
		</label>
		<label class="field">
			Action
			<select bind:value={f.action} onchange={apply}>
				{#each ACTIVITY_GROUPS as g (g.key)}<option value={g.key}>{g.label}</option>{/each}
			</select>
		</label>
		<label class="field">From<input type="date" bind:value={f.from} onchange={apply} /></label>
		<label class="field">To<input type="date" bind:value={f.to} onchange={apply} /></label>
		{#if filtered}<button class="ghost sm clear" onclick={clear}><X size={14} /> Clear</button>{/if}
		<span class="count muted">{data.total.toLocaleString()} {data.total === 1 ? 'entry' : 'entries'}</span>
	</div>

	<div class="list">
		{#if data.rows.length === 0}
			<EmptyState title="Nothing recorded" text={filtered ? 'Try wider filters.' : 'Actions appear here as people use the app.'} />
		{:else}
			<ActivityList rows={data.rows} showIp linkVideos />
		{/if}
	</div>

	{#if data.total > data.perPage}
		<div class="pager">
			<span class="muted">{(data.page - 1) * data.perPage + 1}–{Math.min(data.total, data.page * data.perPage)} of {data.total}</span>
			<a class="btn btn-sm btn-ghost" aria-disabled={data.page <= 1} href="/admin/activity?{qs({ page: data.page - 1 })}"><ChevronLeft size={15} /> Newer</a>
			<a class="btn btn-sm btn-ghost" aria-disabled={data.page * data.perPage >= data.total} href="/admin/activity?{qs({ page: data.page + 1 })}">Older <ChevronRight size={15} /></a>
		</div>
	{/if}
</section>

<style>
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
		margin-bottom: 16px;
	}
	.filters {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex-wrap: wrap;
		padding: 18px 24px;
		border-bottom: 1px solid var(--line);
	}
	.filters .field {
		min-width: 160px;
	}
	.clear {
		min-height: 38px;
	}
	.count {
		margin-left: auto;
		font-size: 13px;
		align-self: center;
	}
	.list {
		padding: 4px 24px 8px;
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		padding: 12px 20px;
		border-top: 1px solid var(--line);
		font-size: 13px;
	}
</style>

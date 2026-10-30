<script lang="ts">
	import { ArrowLeft } from '@lucide/svelte';
	import ProfileView from '#lib/components/ProfileView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<a class="back" href="/admin/users"><ArrowLeft size={15} /> Users</a>

<ProfileView p={data.p} activity={data.activity} activityHref="/admin/activity?user={data.p.user.id}" />

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 18px;
		color: var(--muted);
		font-size: 14px;
	}
	.back:hover {
		color: var(--text);
	}
</style>

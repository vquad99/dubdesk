<script lang="ts">
	import ProfileView from '#lib/components/ProfileView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">My profile</span>
		<p class="sub">Your progress, your jobs and everything you have done here.</p>
	</div>
</div>

<ProfileView p={data.p} activity={data.activity} self />

<script lang="ts">
	import ProfileView from '#lib/components/ProfileView.svelte';
	import SecurityPanel from '#lib/components/SecurityPanel.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="page-head">
	<div>
		<span class="eyebrow">My profile</span>
		<p class="sub">Your progress, your jobs, your security and everything you have done here.</p>
	</div>
</div>

<ProfileView p={data.p} activity={data.activity} self>
	{#snippet security()}<SecurityPanel security={data.security} {form} />{/snippet}
</ProfileView>

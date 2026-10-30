<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Inbox } from '@lucide/svelte';

	let { title, text, children }: { title: string; text?: string; children?: Snippet } = $props();
</script>

<div class="empty">
	<div class="icon"><Inbox size={22} /></div>
	<p class="title">{title}</p>
	{#if text}<p class="text">{text}</p>{/if}
	{#if children}<div class="actions">{@render children()}</div>{/if}
</div>

<style>
	.empty {
		display: grid;
		justify-items: center;
		gap: 6px;
		padding: 48px 16px;
		text-align: center;
	}
	.icon {
		display: grid;
		place-items: center;
		width: 48px;
		height: 48px;
		border-radius: 14px;
		background: var(--surface-2);
		color: var(--muted);
		margin-bottom: 6px;
	}
	.title {
		margin: 0;
		font-weight: 500;
	}
	.text {
		margin: 0;
		color: var(--muted);
		font-size: 14px;
		max-width: 360px;
	}
	.actions {
		margin-top: 10px;
	}
</style>

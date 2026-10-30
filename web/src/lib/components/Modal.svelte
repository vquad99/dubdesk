<script lang="ts">
	import type { Snippet } from 'svelte';
	import { X } from '@lucide/svelte';

	let {
		open = $bindable(false),
		title,
		children,
		footer,
		width = 480
	}: { open?: boolean; title: string; children: Snippet; footer?: Snippet; width?: number } = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	style:width="min({width}px, calc(100vw - 32px))"
	onclose={() => (open = false)}
	onclick={(e) => e.target === dialog && (open = false)}
>
	<header>
		<h2>{title}</h2>
		<button class="x" type="button" aria-label="Close" onclick={() => (open = false)}><X size={18} /></button>
	</header>
	<div class="body">{@render children()}</div>
	{#if footer}<footer>{@render footer()}</footer>{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 18px;
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.16);
	}
	dialog::backdrop {
		background: rgba(20, 20, 20, 0.35);
		backdrop-filter: blur(2px);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 0 24px;
	}
	h2 {
		margin: 0;
		font-size: 18px;
	}
	.x {
		min-height: 0;
		padding: 6px;
		background: transparent;
		box-shadow: none;
	}
	.body {
		padding: 14px 24px 8px;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 24px 20px;
	}
</style>

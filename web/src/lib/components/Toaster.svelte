<script lang="ts">
	import { CircleCheck, CircleAlert, Info, X } from '@lucide/svelte';
	import { dismiss, toasts } from '#lib/toast.svelte.ts';
</script>

<div class="stack" role="status" aria-live="polite">
	{#each toasts as t (t.id)}
		<div class="toast {t.kind}">
			{#if t.kind === 'ok'}<CircleCheck size={18} />{:else if t.kind === 'error'}<CircleAlert size={18} />{:else}<Info
					size={18}
				/>{/if}
			<span>{t.text}</span>
			<button class="x" aria-label="Close" onclick={() => dismiss(t.id)}><X size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.stack {
		position: fixed;
		right: 20px;
		bottom: 20px;
		z-index: 100;
		display: grid;
		gap: 8px;
		width: min(380px, calc(100vw - 32px));
	}
	.toast {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 12px 12px 14px;
		border-radius: 12px;
		background: var(--slate);
		color: #fff;
		font-size: 14px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
		animation: rise 0.25s cubic-bezier(0.2, 0, 0, 1);
	}
	.toast span {
		flex: 1;
	}
	.ok :global(svg:first-child) {
		color: #90c85b;
	}
	.error :global(svg:first-child) {
		color: #f59970;
	}
	.info :global(svg:first-child) {
		color: #a7c0f1;
	}
	.x {
		min-height: 0;
		padding: 4px;
		background: transparent;
		color: #ccc;
		box-shadow: none;
	}
	.x:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>

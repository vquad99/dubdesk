<script lang="ts">
	let { label, value, hint, href }: { label: string; value: string | number; hint?: string; href?: string } = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="tile" class:link={!!href}>
	<span class="label">{label}</span>
	<span class="value">{value}</span>
	{#if hint}<span class="hint">{hint}</span>{/if}
</svelte:element>

<style>
	.tile {
		display: grid;
		gap: 4px;
		padding: 18px 20px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--panel);
		color: var(--text);
		text-decoration: none;
		transition:
			border-color 0.2s,
			box-shadow 0.2s;
	}
	.link:hover {
		border-color: #a7c0f1;
		box-shadow: 0 4px 16px rgba(51, 51, 204, 0.06);
	}
	.label {
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.value {
		font-size: 32px;
		font-weight: 300;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}
	.hint {
		font-size: 13px;
		color: var(--muted);
	}
</style>

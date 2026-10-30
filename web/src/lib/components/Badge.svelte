<script lang="ts">
	import { statusOf, type Tone } from '#lib/status.ts';

	let { status, label, tone }: { status?: string | null; label?: string; tone?: Tone } = $props();
	const s = $derived(status !== undefined ? statusOf(status) : { label: label ?? '', tone: tone ?? 'neutral' });
</script>

<span class="badge {tone ?? s.tone}"><span class="dot"></span>{label ?? s.label}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 10px 2px 8px;
		border-radius: 999px;
		font-size: 12.5px;
		font-weight: 500;
		white-space: nowrap;
		line-height: 20px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}
	.neutral {
		background: var(--surface-2);
		color: var(--text-2);
	}
	.info {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.warn {
		background: #fff3e0;
		color: #a5460f;
	}
	.accent {
		background: #fceaf0;
		color: #871f4b;
	}
	.ok {
		background: #e3f1d8;
		color: #385418;
	}
	.danger {
		background: #fde7e2;
		color: #a21913;
	}
</style>

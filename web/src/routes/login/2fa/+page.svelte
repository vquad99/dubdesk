<script lang="ts">
	import { enhance } from '$app/forms';
	import { ShieldCheck, LoaderCircle } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<div class="page">
	<div class="glow" aria-hidden="true"></div>
	<section class="card box fade-up">
		<span class="icon"><ShieldCheck size={26} /></span>
		<h1>Two-step check</h1>
		<p class="muted">Enter the 6-digit code from your authenticator app for <strong>{data.email}</strong>.</p>
		<form
			method="POST"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				name="code"
				inputmode="numeric"
				autocomplete="one-time-code"
				pattern={'[0-9 ]{6,7}'}
				maxlength="7"
				placeholder="123 456"
				required
				autofocus
				aria-label="6-digit code"
			/>
			{#if form?.error}<p class="error">{form.error}</p>{/if}
			<button class="primary" disabled={busy}>{#if busy}<LoaderCircle size={16} class="spin" />{/if} Verify</button>
		</form>
		<form method="POST" action="/logout"><button class="ghost sm">Use a different account</button></form>
	</section>
</div>

<style>
	.page {
		position: relative;
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 16px;
		overflow: hidden;
	}
	.glow {
		position: absolute;
		inset: -120px 0 auto 0;
		height: 560px;
		z-index: -1;
		background:
			radial-gradient(ellipse 26% 42% at 50% 8%, rgba(249, 115, 12, 0.8), transparent 72%),
			radial-gradient(ellipse 70% 85% at 50% 0%, rgba(190, 210, 255, 1), transparent 82%);
		filter: blur(18px);
	}
	.box {
		width: min(400px, 100%);
		padding: 32px 28px;
		display: grid;
		gap: 14px;
		justify-items: center;
		text-align: center;
		box-shadow: var(--shadow-3);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 54px;
		height: 54px;
		border-radius: 16px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	h1 {
		font-size: 28px;
	}
	form {
		display: grid;
		gap: 12px;
		width: 100%;
	}
	input {
		text-align: center;
		font-family: var(--mono);
		font-size: 26px;
		letter-spacing: 0.3em;
		padding: 12px;
	}
	.primary {
		min-height: 46px;
	}
	:global(.spin) {
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>

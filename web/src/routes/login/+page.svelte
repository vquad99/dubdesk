<script lang="ts">
	import { enhance } from '$app/forms';
	import { ArrowRight, LoaderCircle } from '@lucide/svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
	const done = $derived(page.url.searchParams.get('done'));
	let busy = $state(false);
</script>

<div class="page">
	<div class="glow" aria-hidden="true"></div>
	<div class="rings" aria-hidden="true"></div>

	<header class="top">
		<span class="brand"><span class="mark"></span>DubDesk</span>
	</header>

	<section class="hero fade-up">
		<p class="tag">English → Hindi dubbing review</p>
		<h1>Every line, checked<br />by a human.</h1>
		<p class="sub">Review the dub, fix the Hindi, send it back for a clean regenerate.</p>

		<form
			method="POST"
			class="card"
			use:enhance={() => {
				busy = true;
				return async ({ update }) => {
					await update();
					busy = false;
				};
			}}
		>
			<label class="field">
				Email
				<input name="email" type="email" autocomplete="username" required value={form?.email ?? ''} />
			</label>
			<label class="field">
				Password
				<input name="password" type="password" autocomplete="current-password" required />
			</label>
			{#if form?.error}<p class="error msg">{form.error}</p>
			{:else if done === 'reset' || done === 'welcome'}<p class="ok msg">{done === 'welcome' ? 'Your password is set. Log in to start.' : 'Password changed. Log in with the new one.'}</p>{/if}
			<button class="primary submit" disabled={busy}>
				{#if busy}<LoaderCircle size={16} class="spin" />Signing in{:else}Log in <ArrowRight size={16} />{/if}
			</button>
			<a class="forgot" href="/login/forgot">Forgot password?</a>
		</form>
	</section>
</div>

<style>
	.forgot {
		justify-self: center;
		font-size: 13px;
		color: var(--muted);
	}
	.forgot:hover {
		color: var(--accent);
	}
	.ok.msg {
		color: var(--ok);
		font-size: 14px;
	}
	.page {
		position: relative;
		min-height: 100vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.glow {
		position: absolute;
		inset: -120px 0 auto 0;
		height: 640px;
		z-index: -1;
		background:
			radial-gradient(ellipse 26% 42% at 50% 8%, rgba(249, 115, 12, 0.95) 0%, rgba(249, 115, 12, 0.45) 40%, transparent 72%),
			radial-gradient(ellipse 70% 85% at 50% 0%, rgba(190, 210, 255, 1) 0%, rgba(190, 210, 255, 0.45) 55%, transparent 82%);
		filter: blur(18px);
	}
	.rings {
		position: absolute;
		top: 260px;
		left: 50%;
		width: 1100px;
		height: 1100px;
		transform: translateX(-50%);
		z-index: -1;
		border-radius: 50%;
		background: repeating-radial-gradient(circle, transparent 0 58px, rgba(0, 0, 0, 0.025) 59px 60px);
		mask-image: radial-gradient(circle, #000 20%, transparent 70%);
	}
	.top {
		width: 100%;
		max-width: 1200px;
		padding: 22px 32px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.035em;
	}
	.mark {
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background:
			radial-gradient(circle at 30% 25%, #ffd2a8 0%, transparent 55%),
			linear-gradient(140deg, var(--orange) 0%, #e96c2f 40%, #6a88e2 100%);
	}
	.hero {
		display: grid;
		justify-items: center;
		text-align: center;
		padding: 9vh 16px 64px;
		width: 100%;
	}
	.tag {
		padding: 10px 26px;
		color: var(--accent);
		font-size: 14.5px;
		border-top: 1px solid var(--accent-line);
		border-bottom: 1px solid var(--accent-line);
		background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent);
	}
	h1 {
		margin-top: 30px;
		font-size: clamp(40px, 6vw, 66px);
		font-weight: 300;
		letter-spacing: -0.045em;
		line-height: 1.04;
	}
	.sub {
		margin: 18px 0 36px;
		font-size: 18px;
		color: var(--text-2);
	}
	form {
		display: grid;
		gap: 16px;
		width: min(400px, 100%);
		padding: 28px;
		text-align: left;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(12px);
		box-shadow: var(--shadow-3);
	}
	.msg {
		font-size: 13.5px;
	}
	.submit {
		margin-top: 4px;
		min-height: 46px;
		font-size: 15px;
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

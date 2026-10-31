<script lang="ts">
	import { enhance } from '$app/forms';
	import { KeyRound, LoaderCircle, MailCheck } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<div class="auth-page">
	<div class="auth-glow" aria-hidden="true"></div>
	<section class="card auth-box fade-up">
		{#if form?.sent}
			<span class="auth-icon"><MailCheck size={26} /></span>
			<h1>Request sent</h1>
			<p class="muted">{form.sent}</p>
			<a class="btn btn-ghost" href="/login">Back to log in</a>
		{:else}
			<span class="auth-icon"><KeyRound size={26} /></span>
			<h1>Forgot password</h1>
			<p class="muted">
				{data.mail ? 'Enter your e-mail and we will send you a reset link.' : 'Enter your e-mail. Your admin gets the request and sends you a reset link.'}
			</p>
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
				<input name="email" type="email" autocomplete="username" required autofocus placeholder="you@company.com" value={form?.email ?? ''} aria-label="E-mail" />
				{#if form?.error}<p class="error">{form.error}</p>{/if}
				<button class="primary" disabled={busy}>{#if busy}<LoaderCircle size={16} class="spin" />{/if} Send request</button>
			</form>
			<a class="small-link" href="/login">Back to log in</a>
		{/if}
	</section>
</div>

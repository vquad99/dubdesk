<script lang="ts">
	import { enhance } from '$app/forms';
	import { KeyRound, LoaderCircle, TriangleAlert } from '@lucide/svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let busy = $state(false);
</script>

<svelte:head><meta name="referrer" content="no-referrer" /></svelte:head>

<div class="auth-page">
	<div class="auth-glow" aria-hidden="true"></div>
	<section class="card auth-box fade-up">
		{#if !data.ok}
			<span class="auth-icon warn"><TriangleAlert size={26} /></span>
			<h1>Link not valid</h1>
			<p class="muted">This link has expired or was already used. Ask for a new one.</p>
			<a class="btn btn-primary" href="/login/forgot">Ask for a new link</a>
		{:else}
			<span class="auth-icon"><KeyRound size={26} /></span>
			<h1>{data.kind === 'invite' ? 'Welcome to DubDesk' : 'New password'}</h1>
			<p class="muted">Set a password for <strong>{data.email}</strong>.</p>
			<form
				method="POST"
				use:enhance={() => {
					busy = true;
					return async ({ update }) => {
						await update({ reset: false });
						busy = false;
					};
				}}
			>
				<input type="email" name="username" value={data.email} autocomplete="username" hidden readonly />
				<!-- svelte-ignore a11y_autofocus -->
				<input name="password" type="password" minlength={data.min} maxlength="200" required autofocus autocomplete="new-password" placeholder="New password (at least {data.min} characters)" aria-label="New password" />
				<input name="again" type="password" minlength={data.min} maxlength="200" required autocomplete="new-password" placeholder="Type it again" aria-label="Type the password again" />
				{#if form?.error}<p class="error">{form.error}</p>{/if}
				<button class="primary" disabled={busy}>{#if busy}<LoaderCircle size={16} class="spin" />{/if} Save password</button>
			</form>
			<p class="muted small">You will be logged out on every device, then log in with the new password.</p>
		{/if}
	</section>
</div>

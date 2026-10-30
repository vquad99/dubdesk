<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="wrap fade-up">
	<span class="code">{page.status}</span>
	<h1>{page.status === 404 ? 'Page not found' : page.status === 403 ? 'Not allowed' : 'Something went wrong'}</h1>
	<p class="muted">{page.error?.message}</p>
	<a class="btn btn-primary" href="/">Go home</a>
</div>

<style>
	.wrap {
		min-height: 60vh;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 12px;
		text-align: center;
		padding: 32px 16px;
	}
	.code {
		font-size: 13px;
		letter-spacing: 0.14em;
		color: var(--accent);
		padding: 6px 18px;
		border-top: 1px solid var(--accent-line);
		border-bottom: 1px solid var(--accent-line);
	}
	.btn {
		margin-top: 10px;
	}
</style>

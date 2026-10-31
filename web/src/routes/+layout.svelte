<script lang="ts">
	// Fonts ship with the app (no third-party requests); the browser fetches only the
	// character ranges a page uses, e.g. Devanagari only where Hindi appears.
	import '@fontsource-variable/figtree';
	import '@fontsource-variable/noto-sans-devanagari';
	import '@fontsource/jetbrains-mono/400.css';
	import '@fontsource/jetbrains-mono/500.css';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import { LayoutDashboard, ListVideo, Headphones, Activity, Users, LogOut, History, UserRound, Gauge, ChartLine } from '@lucide/svelte';
	import Toaster from '#lib/components/Toaster.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const ALL = [
		{ href: '/admin', label: 'Overview', icon: LayoutDashboard, roles: ['admin'] },
		{ href: '/admin/tasks', label: 'Tasks', icon: ListVideo, roles: ['admin'] },
		{ href: '/review', label: 'Review', icon: Headphones, roles: ['reviewer'] },
		{ href: '/operator', label: 'Progress', icon: Activity, roles: ['admin', 'operator'] },
		{ href: '/admin/users', label: 'Users', icon: Users, roles: ['admin'] },
		{ href: '/admin/analytics', label: 'Analytics', icon: ChartLine, roles: ['admin'] },
		{ href: '/admin/usage', label: 'Sarvam usage', icon: Gauge, roles: ['admin'] },
		{ href: '/admin/activity', label: 'Activity log', icon: History, roles: ['admin'] },
		{ href: '/profile', label: 'My profile', icon: UserRound, roles: ['admin', 'reviewer', 'operator'] }
	];
	const links = $derived(data.user ? ALL.filter((l) => l.roles.includes(data.user!.role)) : []);
	const path = $derived(page.url.pathname);
	const isActive = (href: string) =>
		href === '/admin' ? path === '/admin' : path === href || path.startsWith(href + '/');
	const wide = $derived(/^\/review\/\d+/.test(path));
	const initials = $derived(
		(data.user?.name ?? '')
			.split(/\s+/)
			.map((w) => w[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>DubDesk</title>
</svelte:head>

{#if data.user && wide}
	<!-- The review editor takes the whole screen, like Sarvam's studio. -->
	<main class="editor-page">{@render children()}</main>
{:else if data.user}
	<div class="shell">
		<aside>
			<a class="brand" href="/">
				<span class="mark" aria-hidden="true"></span>
				<span>DubDesk</span>
			</a>
			<nav>
				{#each links as link (link.href)}
					{@const Icon = link.icon}
					<a href={link.href} class:active={isActive(link.href)}>
						<Icon size={17} strokeWidth={1.8} />
						<span>{link.label}</span>
					</a>
				{/each}
			</nav>
			<div class="me">
				<a class="who-link" href="/profile" title="My profile">
					<span class="avatar">{initials}</span>
					<div class="who">
						<strong>{data.user.name}</strong>
						<span>{data.user.role}</span>
					</div>
				</a>
				<form method="POST" action="/logout">
					<button class="ghost icon-only" aria-label="Log out" title="Log out"><LogOut size={16} /></button>
				</form>
			</div>
		</aside>

		<div class="main" class:wide>
			<div class="glow" aria-hidden="true"></div>
			{#key path}
				<main class="fade-up">{@render children()}</main>
			{/key}
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<Toaster />

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar) minmax(0, 1fr);
		min-height: 100vh;
	}
	aside {
		position: sticky;
		top: 0;
		height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 22px 14px 16px;
		border-right: 1px solid var(--line);
		background: rgba(255, 255, 255, 0.72);
		backdrop-filter: blur(16px);
		z-index: 5;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 10px;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.035em;
		color: var(--text);
	}
	.mark {
		width: 22px;
		height: 22px;
		border-radius: 7px;
		background:
			radial-gradient(circle at 30% 25%, #ffd2a8 0%, transparent 55%),
			linear-gradient(140deg, var(--orange) 0%, #e96c2f 40%, #6a88e2 100%);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
	}
	nav {
		display: grid;
		gap: 2px;
	}
	nav a {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 9px 12px;
		border-radius: 11px;
		color: var(--text-2);
		font-size: 14.5px;
		transition:
			background-color 0.2s var(--ease),
			color 0.2s;
	}
	nav a:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	nav a.active {
		background: #fff;
		color: var(--text);
		font-weight: 500;
		box-shadow:
			0 0 0 1px var(--line),
			0 2px 6px rgba(0, 0, 0, 0.04);
	}
	nav a.active :global(svg) {
		color: var(--accent);
	}
	.me {
		margin-top: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px;
		border-radius: 14px;
		background: var(--surface-2);
	}
	.who-link {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		color: var(--text);
	}
	.who {
		display: grid;
		flex: 1;
		min-width: 0;
		line-height: 1.3;
	}
	.who strong {
		font-size: 13.5px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.who span {
		font-size: 12px;
		color: var(--muted);
		text-transform: capitalize;
	}
	.main {
		position: relative;
		min-width: 0;
		overflow-x: clip;
	}
	.glow {
		position: absolute;
		inset: 0 0 auto 0;
		height: 420px;
		pointer-events: none;
		background:
			radial-gradient(ellipse 30% 70% at 85% -10%, rgba(249, 115, 12, 0.13), transparent 70%),
			radial-gradient(ellipse 55% 80% at 70% -20%, rgba(190, 210, 255, 0.45), transparent 75%);
	}
	main {
		position: relative;
		max-width: 1200px;
		margin: 0 auto;
		padding: 44px 40px 64px;
	}
	main.editor-page {
		max-width: none;
		margin: 0;
		min-height: 100vh;
		padding: 14px 18px;
		background: #f2f2f1;
	}
	@media (max-width: 960px) {
		.shell {
			grid-template-columns: 1fr;
		}
		aside {
			position: sticky;
			height: auto;
			flex-direction: row;
			align-items: center;
			gap: 12px;
			padding: 10px 16px;
			border-right: none;
			border-bottom: 1px solid var(--line);
			overflow-x: auto;
		}
		nav {
			display: flex;
			gap: 4px;
		}
		nav a span {
			display: none;
		}
		.brand span:last-child,
		.who {
			display: none;
		}
		.me {
			margin: 0 0 0 auto;
			padding: 4px;
			background: none;
		}
		main {
			padding: 28px 16px 48px;
		}
		main.editor-page {
			padding: 10px;
		}
	}
</style>

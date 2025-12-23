<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	
	let menuOpen = true;
	
	const menuItems = [
		{ path: '/settings', label: '管理設定', icon: '⚙️' },
		{ path: '/kpi', label: 'KPI管理', icon: '📊' }
	];
	
	onMount(() => {
		// Entra ID 認証チェック (Static Web Apps)
		// 認証されていない場合は /.auth/login/aad にリダイレクト
	});
</script>

<svelte:head>
	<title>Copilot Analytics 管理ポータル</title>
</svelte:head>

<div class="layout">
	<aside class="sidebar" class:collapsed={!menuOpen}>
		<div class="sidebar-header">
			<h1>📈 Copilot Analytics</h1>
		</div>
		
		<nav>
			{#each menuItems as item}
				<a 
					href={item.path} 
					class:active={$page.url.pathname === item.path}
					aria-current={$page.url.pathname === item.path ? 'page' : undefined}
				>
					<span class="icon">{item.icon}</span>
					{#if menuOpen}
						<span>{item.label}</span>
					{/if}
				</a>
			{/each}
		</nav>
	</aside>
	
	<main class="content">
		<slot />
	</main>
</div>

<style>
	.layout {
		display: flex;
		min-height: 100vh;
	}
	
	.sidebar {
		width: 250px;
		background: #2c3e50;
		color: white;
		transition: width 0.3s;
	}
	
	.sidebar.collapsed {
		width: 60px;
	}
	
	.sidebar-header {
		padding: 1.5rem;
		border-bottom: 1px solid rgba(255,255,255,0.1);
	}
	
	.sidebar-header h1 {
		font-size: 1.25rem;
		white-space: nowrap;
	}
	
	nav {
		padding: 1rem 0;
	}
	
	nav a {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0.75rem 1.5rem;
		color: rgba(255,255,255,0.8);
		text-decoration: none;
		transition: all 0.2s;
	}
	
	nav a:hover {
		background: rgba(255,255,255,0.1);
		color: white;
	}
	
	nav a.active {
		background: rgba(255,255,255,0.15);
		color: white;
		border-left: 3px solid #0078d4;
	}
	
	.icon {
		font-size: 1.5rem;
	}
	
	.content {
		flex: 1;
		padding: 2rem;
		background: #f5f5f5;
		overflow-y: auto;
	}
</style>

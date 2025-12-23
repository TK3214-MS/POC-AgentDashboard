<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	
	onMount(() => {
		// デフォルトページにリダイレクト
		goto('/settings');
	});
</script>

<div class="welcome">
	<h1>📈 Copilot Analytics 管理ポータル</h1>
	<p>サイドバーからメニューを選択してください</p>
</div>

<style>
	.welcome {
		text-align: center;
		padding: 4rem 2rem;
	}
	
	.welcome h1 {
		font-size: 2rem;
		margin-bottom: 1rem;
		color: #2c3e50;
	}
	
	.welcome p {
		color: #666;
		font-size: 1.125rem;
	}
</style>

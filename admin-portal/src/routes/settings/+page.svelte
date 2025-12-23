<script lang="ts">
	import { onMount } from 'svelte';
	import { configApi, type SystemConfig } from '$lib/api';
	
	let configs: SystemConfig[] = [];
	let loading = true;
	let error = '';
	let editingKey = '';
	let editForm = {
		rowKey: '',
		value: '',
		description: ''
	};
	let showModal = false;
	
	// 設定項目の定義
	const configDefinitions = [
		{ key: 'ingestion_schedule_graph', label: 'Graph収集スケジュール', type: 'cron', description: 'CRON形式 (例: 0 0 18 * * *)' },
		{ key: 'ingestion_schedule_users', label: 'ユーザー同期スケジュール', type: 'cron', description: 'CRON形式 (例: 0 30 18 * * *)' },
		{ key: 'retention_days_raw', label: 'Rawデータ保持期間（日）', type: 'number', description: '1-365日' },
		{ key: 'scenario_extraction_enabled', label: 'シナリオ抽出有効化', type: 'boolean', description: 'true/false' },
		{ key: 'powerbi_refresh_schedule', label: 'Power BIリフレッシュスケジュール', type: 'cron', description: 'CRON形式 (例: 0 0 9 * * MON)' }
	];
	
	onMount(async () => {
		await loadConfigs();
	});
	
	async function loadConfigs() {
		loading = true;
		error = '';
		try {
			configs = await configApi.list();
		} catch (e) {
			error = e.message;
		} finally {
			loading = false;
		}
	}
	
	function openCreateModal() {
		editingKey = '';
		editForm = { rowKey: '', value: '', description: '' };
		showModal = true;
	}
	
	function openEditModal(config: SystemConfig) {
		editingKey = config.rowKey;
		editForm = {
			rowKey: config.rowKey,
			value: config.value,
			description: config.description || ''
		};
		showModal = true;
	}
	
	async function saveConfig() {
		error = '';
		try {
			if (editingKey) {
				await configApi.update(editingKey, editForm);
			} else {
				await configApi.create({ ...editForm, partitionKey: 'config' });
			}
			showModal = false;
			await loadConfigs();
		} catch (e) {
			error = e.message;
		}
	}
	
	async function deleteConfig(key: string) {
		if (!confirm(`設定「${key}」を削除しますか？`)) return;
		
		error = '';
		try {
			await configApi.delete(key);
			await loadConfigs();
		} catch (e) {
			error = e.message;
		}
	}
	
	function getConfigValue(key: string): string {
		const config = configs.find(c => c.rowKey === key);
		return config?.value || '-';
	}
</script>

<div class="container">
	<div class="header">
		<h1>⚙️ 管理設定</h1>
		<button on:click={openCreateModal}>＋ 新規設定追加</button>
	</div>
	
	{#if error}
		<div class="card error-card">
			<strong>エラー:</strong> {error}
		</div>
	{/if}
	
	{#if loading}
		<div class="loading">読み込み中...</div>
	{:else}
		<div class="card">
			<h2>システム設定</h2>
			<table>
				<thead>
					<tr>
						<th>設定項目</th>
						<th>現在値</th>
						<th>説明</th>
						<th>操作</th>
					</tr>
				</thead>
				<tbody>
					{#each configDefinitions as def}
						{@const currentValue = getConfigValue(def.key)}
						{@const config = configs.find(c => c.rowKey === def.key)}
						<tr>
							<td><strong>{def.label}</strong></td>
							<td><code>{currentValue}</code></td>
							<td class="description">{def.description}</td>
							<td>
								{#if config}
									<button class="secondary small" on:click={() => openEditModal(config)}>編集</button>
									<button class="danger small" on:click={() => deleteConfig(def.key)}>削除</button>
								{:else}
									<button class="small" on:click={() => {
										editForm = { rowKey: def.key, value: '', description: def.description };
										editingKey = '';
										showModal = true;
									}}>設定</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		
		<div class="card">
			<h2>その他の設定</h2>
			{#if configs.filter(c => !configDefinitions.some(d => d.key === c.rowKey)).length === 0}
				<p class="empty">その他の設定はありません</p>
			{:else}
				<table>
					<thead>
						<tr>
							<th>キー</th>
							<th>値</th>
							<th>説明</th>
							<th>更新者</th>
							<th>更新日時</th>
							<th>操作</th>
						</tr>
					</thead>
					<tbody>
						{#each configs.filter(c => !configDefinitions.some(d => d.key === c.rowKey)) as config}
							<tr>
								<td><code>{config.rowKey}</code></td>
								<td><code>{config.value}</code></td>
								<td>{config.description || '-'}</td>
								<td>{config.updatedBy || '-'}</td>
								<td>{config.updatedAt ? new Date(config.updatedAt).toLocaleString('ja-JP') : '-'}</td>
								<td>
									<button class="secondary small" on:click={() => openEditModal(config)}>編集</button>
									<button class="danger small" on:click={() => deleteConfig(config.rowKey)}>削除</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</div>

{#if showModal}
	<div class="modal-overlay" on:click={() => showModal = false}>
		<div class="modal" on:click|stopPropagation>
			<h2>{editingKey ? '設定編集' : '新規設定追加'}</h2>
			
			<div class="form-group">
				<label for="rowKey">設定キー</label>
				<input 
					id="rowKey" 
					type="text" 
					bind:value={editForm.rowKey} 
					disabled={!!editingKey}
					placeholder="例: custom_setting_key"
				/>
			</div>
			
			<div class="form-group">
				<label for="value">値</label>
				<input 
					id="value" 
					type="text" 
					bind:value={editForm.value}
					placeholder="設定値を入力"
				/>
			</div>
			
			<div class="form-group">
				<label for="description">説明（任意）</label>
				<textarea 
					id="description" 
					bind:value={editForm.description}
					rows="3"
					placeholder="設定の説明"
				/>
			</div>
			
			<div class="modal-actions">
				<button class="secondary" on:click={() => showModal = false}>キャンセル</button>
				<button on:click={saveConfig}>保存</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 2rem;
	}
	
	.header h1 {
		font-size: 1.75rem;
	}
	
	.description {
		color: #666;
		font-size: 0.875rem;
	}
	
	.empty {
		color: #666;
		text-align: center;
		padding: 2rem;
	}
	
	.error-card {
		background: #fef0f0;
		color: #d13438;
		border-left: 4px solid #d13438;
	}
	
	code {
		background: #f3f2f1;
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
		font-family: 'Consolas', 'Monaco', monospace;
	}
	
	button.small {
		padding: 0.25rem 0.75rem;
		font-size: 0.875rem;
		margin-right: 0.5rem;
	}
	
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0,0,0,0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}
	
	.modal {
		background: white;
		border-radius: 8px;
		padding: 2rem;
		max-width: 500px;
		width: 90%;
		max-height: 80vh;
		overflow-y: auto;
	}
	
	.modal h2 {
		margin-bottom: 1.5rem;
	}
	
	.modal-actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
</style>

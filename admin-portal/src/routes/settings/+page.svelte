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
		description: '',
		schedulePreset: 'daily_18',
		customDays: 1,
		customHour: 18
	};
	let showModal = false;
	
	// 設定項目の定義
	const configDefinitions = [
		{ key: 'ingestion_schedule_graph', label: 'Graph収集スケジュール', type: 'schedule', description: '実行間隔を選択' },
		{ key: 'ingestion_schedule_users', label: 'ユーザー同期スケジュール', type: 'schedule', description: '実行間隔を選択' },
		{ key: 'retention_days_raw', label: 'Rawデータ保持期間（日）', type: 'number', description: '1-365日' },
		{ key: 'scenario_extraction_enabled', label: 'シナリオ抽出有効化', type: 'boolean', description: 'true/false' },
		{ key: 'powerbi_refresh_schedule', label: 'Power BIリフレッシュスケジュール', type: 'schedule', description: '実行間隔を選択' }
	];
	
	// スケジュールプリセット
	const schedulePresets = [
		{ label: '毎日 (18:00)', value: 'daily_18' },
		{ label: '毎日 (9:00)', value: 'daily_9' },
		{ label: '週1回 (月曜 9:00)', value: 'weekly_mon_9' },
		{ label: '月1回 (1日 9:00)', value: 'monthly_1_9' },
		{ label: 'カスタム', value: 'custom' }
	];
	
	// プリセット値からCRON形式に変換
	function presetToCron(preset: string, customDays?: number, customHour?: number): string {
		switch (preset) {
			case 'daily_18': return '0 0 18 * * *';
			case 'daily_9': return '0 0 9 * * *';
			case 'weekly_mon_9': return '0 0 9 * * MON';
			case 'monthly_1_9': return '0 0 9 1 * *';
			case 'custom':
				const hour = customHour ?? 9;
				const days = customDays ?? 1;
				if (days === 1) return `0 0 ${hour} * * *`;
				if (days === 7) return `0 0 ${hour} * * MON`;
				// 複数日の場合は毎日実行として扱う
				return `0 0 ${hour} * * *`;
			default: return '0 0 9 * * *';
		}
	}
	
	// CRON形式からプリセット値に変換
	function cronToPreset(cron: string): { preset: string; customDays: number; customHour: number } {
		if (!cron) return { preset: 'daily_18', customDays: 1, customHour: 18 };
		
		if (cron === '0 0 18 * * *') return { preset: 'daily_18', customDays: 1, customHour: 18 };
		if (cron === '0 0 9 * * *') return { preset: 'daily_9', customDays: 1, customHour: 9 };
		if (cron === '0 0 9 * * MON') return { preset: 'weekly_mon_9', customDays: 7, customHour: 9 };
		if (cron === '0 0 9 1 * *') return { preset: 'monthly_1_9', customDays: 30, customHour: 9 };
		
		// カスタムの場合、時間部分を抽出
		const match = cron.match(/^0 0 (\d+) \* \* \*$/);
		if (match) {
			const hour = parseInt(match[1]);
			return { preset: 'custom', customDays: 1, customHour: hour };
		}
		
		return { preset: 'custom', customDays: 1, customHour: 9 };
	}
	
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
	
	function openEditModal(config: SystemConfig) {
		editingKey = config.rowKey;
		const def = configDefinitions.find(d => d.key === config.rowKey);
		
		if (def?.type === 'schedule') {
			const { preset, customDays, customHour } = cronToPreset(config.value);
			editForm = {
				rowKey: config.rowKey,
				value: config.value,
				description: config.description || '',
				schedulePreset: preset,
				customDays,
				customHour
			};
		} else {
			editForm = {
				rowKey: config.rowKey,
				value: config.value,
				description: config.description || '',
				schedulePreset: 'daily_18',
				customDays: 1,
				customHour: 18
			};
		}
		showModal = true;
	}
	
	async function saveConfig() {
		error = '';
		try {
			// スケジュール設定の場合、CRON形式に変換
			const def = configDefinitions.find(d => d.key === editForm.rowKey);
			let valueToSave = editForm.value;
			
			if (def?.type === 'schedule') {
				valueToSave = presetToCron(editForm.schedulePreset, editForm.customDays, editForm.customHour);
			}
			
			if (editingKey) {
				await configApi.update(editingKey, { ...editForm, value: valueToSave });
			} else {
				await configApi.create({ ...editForm, value: valueToSave, partitionKey: 'config' });
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
		if (!config) return '-';
		
		const def = configDefinitions.find(d => d.key === key);
		if (def?.type === 'schedule') {
			const { preset } = cronToPreset(config.value);
			const presetLabel = schedulePresets.find(p => p.value === preset)?.label;
			return presetLabel || config.value;
		}
		
		return config.value;
	}
	
	function getConfigDefinition(key: string) {
		return configDefinitions.find(d => d.key === key);
	}
</script>

<div class="container">
	<div class="header">
		<h1>⚙️ 管理設定</h1>
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
										const { preset, customDays, customHour } = cronToPreset('0 0 18 * * *');
										editForm = { 
											rowKey: def.key, 
											value: '', 
											description: def.description,
											schedulePreset: preset,
											customDays,
											customHour
										};
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
	{/if}
</div>

{#if showModal}
	<div class="modal-overlay" on:click={() => showModal = false}>
		<div class="modal" on:click|stopPropagation>
			<h2>設定編集</h2>
			
			<div class="form-group">
				<label>設定項目</label>
				<p class="readonly-value"><strong>{configDefinitions.find(d => d.key === editForm.rowKey)?.label || editForm.rowKey}</strong></p>
			</div>
			
			<div class="form-group">
				<label for="value">値</label>
				{#if getConfigDefinition(editForm.rowKey)?.type === 'schedule'}
					{@const def = getConfigDefinition(editForm.rowKey)}
					<select id="schedulePreset" bind:value={editForm.schedulePreset}>
						{#each schedulePresets as preset}
							<option value={preset.value}>{preset.label}</option>
						{/each}
					</select>
					
					{#if editForm.schedulePreset === 'custom'}
						<div class="custom-schedule">
							<div class="schedule-row">
								<label for="customHour">実行時刻（時）</label>
								<input 
									id="customHour" 
									type="number" 
									bind:value={editForm.customHour}
									min="0"
									max="23"
									placeholder="9"
								/>
							</div>
							<p class="hint">毎日指定時刻に実行されます</p>
						</div>
					{/if}
				{:else if getConfigDefinition(editForm.rowKey)?.type === 'boolean'}
					<select id="value" bind:value={editForm.value}>
						<option value="true">有効 (true)</option>
						<option value="false">無効 (false)</option>
					</select>
				{:else if getConfigDefinition(editForm.rowKey)?.type === 'number'}
					<input 
						id="value" 
						type="number" 
						bind:value={editForm.value}
						min="1"
						max="365"
						placeholder="設定値を入力"
					/>
				{:else}
					<input 
						id="value" 
						type="text" 
						bind:value={editForm.value}
						placeholder="設定値を入力"
					/>
				{/if}
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
	
	.empty-value {
		color: #999;
		font-style: italic;
	}
	
	.readonly-value {
		margin: 0.5rem 0;
		padding: 0.5rem;
		background: #f9f9f9;
		border-radius: 4px;
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
	
	.custom-schedule {
		margin-top: 1rem;
		padding: 1rem;
		background: #f9f9f9;
		border-radius: 4px;
	}
	
	.schedule-row {
		margin-bottom: 0.75rem;
	}
	
	.schedule-row label {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.875rem;
	}
	
	.schedule-row input {
		width: 100px;
	}
	
	.hint {
		color: #666;
		font-size: 0.875rem;
		margin: 0.5rem 0 0 0;
	}
	
	select {
		width: 100%;
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		font-size: 1rem;
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

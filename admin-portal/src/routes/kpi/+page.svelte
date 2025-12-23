<script lang="ts">
	import { onMount } from 'svelte';
	import { kpiApi, businessProcessApi, agentsApi, type KpiDefinition, type BusinessProcess } from '$lib/api';
	
	let kpis: KpiDefinition[] = [];
	let processes: BusinessProcess[] = [];
	let agents: string[] = [];
	let loading = true;
	let error = '';
	
	let showKpiModal = false;
	let showProcessModal = false;
	let editingKpi: KpiDefinition | null = null;
	let editingProcess: BusinessProcess | null = null;
	
	let kpiForm = {
		name: '',
		description: '',
		timePerExecution: 0,
		costPerHour: 0,
		category: '',
		isActive: true
	};
	
	let processForm = {
		kpiId: '',
		agentName: '',
		usageCount: 0,
		totalAssistedHours: 0
	};
	
	const categories = [
		{ value: 'customer_support', label: '顧客サポート' },
		{ value: 'data_analysis', label: 'データ分析' },
		{ value: 'content_creation', label: 'コンテンツ作成' },
		{ value: 'code_development', label: 'コード開発' },
		{ value: 'meeting_preparation', label: '会議準備' },
		{ value: 'document_review', label: '文書レビュー' },
		{ value: 'other', label: 'その他' }
	];
	
	onMount(async () => {
		await Promise.all([loadKpis(), loadProcesses(), loadAgents()]);
		loading = false;
	});
	
	async function loadKpis() {
		try {
			kpis = await kpiApi.list();
		} catch (e) {
			error = e.message;
		}
	}
	
	async function loadProcesses() {
		try {
			processes = await businessProcessApi.list();
		} catch (e) {
			error = e.message;
		}
	}
	
	async function loadAgents() {
		try {
			agents = await agentsApi.list();
		} catch (e) {
			console.warn('Failed to load agents:', e);
			agents = [];
		}
	}
	
	function openKpiCreateModal() {
		editingKpi = null;
		kpiForm = {
			name: '',
			description: '',
			timePerExecution: 0,
			costPerHour: 0,
			category: '',
			isActive: true
		};
		showKpiModal = true;
	}
	
	function openKpiEditModal(kpi: KpiDefinition) {
		editingKpi = kpi;
		kpiForm = {
			name: kpi.name,
			description: kpi.description || '',
			timePerExecution: kpi.timePerExecution,
			costPerHour: kpi.costPerHour,
			category: kpi.category || '',
			isActive: kpi.isActive
		};
		showKpiModal = true;
	}
	
	async function saveKpi() {
		error = '';
		try {
			if (editingKpi) {
				await kpiApi.update(editingKpi.rowKey, kpiForm);
			} else {
				await kpiApi.create(kpiForm);
			}
			showKpiModal = false;
			await loadKpis();
		} catch (e) {
			error = e.message;
		}
	}
	
	async function deleteKpi(id: string) {
		if (!confirm('このKPI定義を削除しますか？関連する業務プロセスも削除されます。')) return;
		
		error = '';
		try {
			await kpiApi.delete(id);
			await Promise.all([loadKpis(), loadProcesses()]);
		} catch (e) {
			error = e.message;
		}
	}
	
	function openProcessCreateModal(kpiId: string) {
		editingProcess = null;
		processForm = {
			kpiId,
			agentName: '',
			usageCount: 0,
			totalAssistedHours: 0
		};
		showProcessModal = true;
	}
	
	function openProcessEditModal(process: BusinessProcess) {
		editingProcess = process;
		processForm = {
			kpiId: process.partitionKey,
			agentName: process.agentName,
			usageCount: process.usageCount || 0,
			totalAssistedHours: process.totalAssistedHours || 0
		};
		showProcessModal = true;
	}
	
	async function saveProcess() {
		error = '';
		try {
			if (editingProcess) {
				await businessProcessApi.update(
					editingProcess.partitionKey,
					editingProcess.rowKey,
					processForm
				);
			} else {
				await businessProcessApi.create({
					partitionKey: processForm.kpiId,
					agentName: processForm.agentName,
					usageCount: processForm.usageCount,
					totalAssistedHours: processForm.totalAssistedHours
				});
			}
			showProcessModal = false;
			await loadProcesses();
		} catch (e) {
			error = e.message;
		}
	}
	
	async function deleteProcess(process: BusinessProcess) {
		if (!confirm('この業務プロセスを削除しますか？')) return;
		
		error = '';
		try {
			await businessProcessApi.delete(process.partitionKey, process.rowKey);
			await loadProcesses();
		} catch (e) {
			error = e.message;
		}
	}
	
	function getProcessesByKpi(kpiId: string): BusinessProcess[] {
		return processes.filter(p => p.partitionKey === kpiId);
	}
	
	function calculateROI(kpi: KpiDefinition, process: BusinessProcess): number {
		const costSavings = (process.totalAssistedHours || 0) * kpi.costPerHour;
		// 簡易ROI計算（実運用では投資コストも考慮）
		return costSavings;
	}
	
	function formatCurrency(amount: number): string {
		return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(amount);
	}
	
	function getCategoryLabel(value: string): string {
		return categories.find(c => c.value === value)?.label || value;
	}
</script>

<div class="container">
	<div class="header">
		<h1>📊 KPI管理</h1>
		<button on:click={openKpiCreateModal}>＋ 新規業務フロー追加</button>
	</div>
	
	{#if error}
		<div class="card error-card">
			<strong>エラー:</strong> {error}
		</div>
	{/if}
	
	{#if loading}
		<div class="loading">読み込み中...</div>
	{:else}
		{#if kpis.length === 0}
			<div class="card empty-state">
				<p>業務フローが登録されていません</p>
				<button on:click={openKpiCreateModal}>最初の業務フローを追加</button>
			</div>
		{:else}
			{#each kpis as kpi}
				{@const kpiProcesses = getProcessesByKpi(kpi.rowKey)}
				{@const totalROI = kpiProcesses.reduce((sum, p) => sum + calculateROI(kpi, p), 0)}
				{@const totalHours = kpiProcesses.reduce((sum, p) => sum + (p.totalAssistedHours || 0), 0)}
				
				<div class="card kpi-card">
					<div class="kpi-header">
						<div class="kpi-info">
							<h2>
								{kpi.name}
								{#if !kpi.isActive}
									<span class="badge inactive">無効</span>
								{/if}
							</h2>
							{#if kpi.description}
								<p class="description">{kpi.description}</p>
							{/if}
							<div class="kpi-meta">
								<span class="meta-item">
									⏱️ {kpi.timePerExecution}分/回
								</span>
								<span class="meta-item">
									💰 {formatCurrency(kpi.costPerHour)}/時
								</span>
								{#if kpi.category}
									<span class="meta-item badge-category">
										{getCategoryLabel(kpi.category)}
									</span>
								{/if}
							</div>
						</div>
						<div class="kpi-actions">
							<button class="secondary" on:click={() => openKpiEditModal(kpi)}>編集</button>
							<button class="danger" on:click={() => deleteKpi(kpi.rowKey)}>削除</button>
						</div>
					</div>
					
					<div class="kpi-summary">
						<div class="summary-card">
							<div class="summary-label">合計支援時間</div>
							<div class="summary-value">{totalHours.toFixed(1)} 時間</div>
						</div>
						<div class="summary-card">
							<div class="summary-label">コスト削減効果</div>
							<div class="summary-value highlight">{formatCurrency(totalROI)}</div>
						</div>
						<div class="summary-card">
							<div class="summary-label">関連エージェント</div>
							<div class="summary-value">{kpiProcesses.length} 件</div>
						</div>
					</div>
					
					<div class="process-section">
						<div class="process-header">
							<h3>関連エージェント</h3>
							<button class="small" on:click={() => openProcessCreateModal(kpi.rowKey)}>
								＋ エージェント追加
							</button>
						</div>
						
						{#if kpiProcesses.length === 0}
							<p class="empty">エージェントが関連付けられていません</p>
						{:else}
							<table class="process-table">
								<thead>
									<tr>
										<th>エージェント名</th>
										<th>利用回数</th>
										<th>支援時間</th>
										<th>コスト削減</th>
										<th>開始日</th>
										<th>操作</th>
									</tr>
								</thead>
								<tbody>
									{#each kpiProcesses as process}
										{@const roi = calculateROI(kpi, process)}
										<tr>
											<td><strong>{process.agentName}</strong></td>
											<td>{process.usageCount || 0} 回</td>
											<td>{(process.totalAssistedHours || 0).toFixed(1)} h</td>
											<td class="highlight">{formatCurrency(roi)}</td>
											<td>{process.startDate ? new Date(process.startDate).toLocaleDateString('ja-JP') : '-'}</td>
											<td>
												<button class="secondary small" on:click={() => openProcessEditModal(process)}>編集</button>
												<button class="danger small" on:click={() => deleteProcess(process)}>削除</button>
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	{/if}
</div>

<!-- KPI Modal -->
{#if showKpiModal}
	<div class="modal-overlay" on:click={() => showKpiModal = false}>
		<div class="modal" on:click|stopPropagation>
			<h2>{editingKpi ? '業務フロー編集' : '新規業務フロー追加'}</h2>
			
			<div class="form-group">
				<label for="kpi-name">業務フロー名 *</label>
				<input 
					id="kpi-name" 
					type="text" 
					bind:value={kpiForm.name}
					placeholder="例: カスタマーサポート対応"
				/>
			</div>
			
			<div class="form-group">
				<label for="kpi-description">説明</label>
				<textarea 
					id="kpi-description" 
					bind:value={kpiForm.description}
					rows="2"
					placeholder="業務フローの詳細説明"
				/>
			</div>
			
			<div class="form-row">
				<div class="form-group">
					<label for="kpi-time">1回あたりの所要時間（分） *</label>
					<input 
						id="kpi-time" 
						type="number" 
						bind:value={kpiForm.timePerExecution}
						min="0"
						step="1"
					/>
				</div>
				
				<div class="form-group">
					<label for="kpi-cost">時間コスト（円/時） *</label>
					<input 
						id="kpi-cost" 
						type="number" 
						bind:value={kpiForm.costPerHour}
						min="0"
						step="100"
					/>
				</div>
			</div>
			
			<div class="form-group">
				<label for="kpi-category">カテゴリ</label>
				<select id="kpi-category" bind:value={kpiForm.category}>
					<option value="">未分類</option>
					{#each categories as cat}
						<option value={cat.value}>{cat.label}</option>
					{/each}
				</select>
			</div>
			
			<div class="form-group">
				<label>
					<input type="checkbox" bind:checked={kpiForm.isActive} />
					有効化
				</label>
			</div>
			
			<div class="modal-actions">
				<button class="secondary" on:click={() => showKpiModal = false}>キャンセル</button>
				<button on:click={saveKpi}>保存</button>
			</div>
		</div>
	</div>
{/if}

<!-- Process Modal -->
{#if showProcessModal}
	<div class="modal-overlay" on:click={() => showProcessModal = false}>
		<div class="modal" on:click|stopPropagation>
			<h2>{editingProcess ? 'エージェント編集' : 'エージェント追加'}</h2>
			
			<div class="form-group">
				<label for="process-agent">エージェント名 *</label>
				{#if agents.length > 0}
					<select id="process-agent" bind:value={processForm.agentName}>
						<option value="">選択してください</option>
						{#each agents as agent}
							<option value={agent}>{agent}</option>
						{/each}
					</select>
				{:else}
					<input 
						id="process-agent" 
						type="text" 
						bind:value={processForm.agentName}
						placeholder="エージェント名を入力"
					/>
					<p class="hint">※ データから抽出されたエージェント名は後で自動表示されます</p>
				{/if}
			</div>
			
			<div class="form-row">
				<div class="form-group">
					<label for="process-usage">利用回数</label>
					<input 
						id="process-usage" 
						type="number" 
						bind:value={processForm.usageCount}
						min="0"
					/>
				</div>
				
				<div class="form-group">
					<label for="process-hours">合計支援時間（時間）</label>
					<input 
						id="process-hours" 
						type="number" 
						bind:value={processForm.totalAssistedHours}
						min="0"
						step="0.1"
					/>
				</div>
			</div>
			
			<div class="modal-actions">
				<button class="secondary" on:click={() => showProcessModal = false}>キャンセル</button>
				<button on:click={saveProcess}>保存</button>
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
	
	.empty-state {
		text-align: center;
		padding: 3rem;
	}
	
	.empty-state p {
		color: #666;
		margin-bottom: 1.5rem;
		font-size: 1.125rem;
	}
	
	.kpi-card {
		margin-bottom: 2rem;
	}
	
	.kpi-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 1.5rem;
		padding-bottom: 1rem;
		border-bottom: 2px solid #f3f2f1;
	}
	
	.kpi-info h2 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	
	.description {
		color: #666;
		margin-bottom: 0.75rem;
	}
	
	.kpi-meta {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}
	
	.meta-item {
		color: #666;
		font-size: 0.875rem;
	}
	
	.badge {
		font-size: 0.75rem;
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
		font-weight: 500;
	}
	
	.badge.inactive {
		background: #fef0f0;
		color: #d13438;
	}
	
	.badge-category {
		background: #e3f2fd;
		color: #1976d2;
		padding: 0.25rem 0.75rem;
		border-radius: 12px;
	}
	
	.kpi-actions {
		display: flex;
		gap: 0.5rem;
	}
	
	.kpi-summary {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1rem;
		margin-bottom: 1.5rem;
	}
	
	.summary-card {
		background: #f9f9f9;
		padding: 1rem;
		border-radius: 6px;
		text-align: center;
	}
	
	.summary-label {
		font-size: 0.875rem;
		color: #666;
		margin-bottom: 0.5rem;
	}
	
	.summary-value {
		font-size: 1.5rem;
		font-weight: 600;
		color: #2c3e50;
	}
	
	.summary-value.highlight {
		color: #0078d4;
	}
	
	.process-section {
		margin-top: 1.5rem;
		padding-top: 1.5rem;
		border-top: 1px solid #eee;
	}
	
	.process-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	
	.process-header h3 {
		font-size: 1.125rem;
	}
	
	.process-table {
		margin-top: 1rem;
	}
	
	.process-table td.highlight {
		color: #0078d4;
		font-weight: 600;
	}
	
	.empty {
		color: #999;
		text-align: center;
		padding: 1.5rem;
		font-style: italic;
	}
	
	.error-card {
		background: #fef0f0;
		color: #d13438;
		border-left: 4px solid #d13438;
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
		max-width: 600px;
		width: 90%;
		max-height: 80vh;
		overflow-y: auto;
	}
	
	.modal h2 {
		margin-bottom: 1.5rem;
	}
	
	.form-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	
	.hint {
		font-size: 0.75rem;
		color: #666;
		margin-top: 0.25rem;
	}
	
	.modal-actions {
		display: flex;
		gap: 1rem;
		justify-content: flex-end;
		margin-top: 1.5rem;
	}
</style>

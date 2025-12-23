const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function fetchApi(endpoint: string, options?: RequestInit) {
	const response = await fetch(`${API_BASE}${endpoint}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers
		},
		credentials: 'include'
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Request failed' }));
		throw new Error(error.error || `HTTP ${response.status}`);
	}

	if (response.status === 204) {
		return null;
	}

	return response.json();
}

export interface SystemConfig {
	partitionKey: string;
	rowKey: string;
	value: string;
	description?: string;
	updatedBy?: string;
	updatedAt?: Date;
}

export interface KpiDefinition {
	partitionKey: string;
	rowKey: string;
	name: string;
	description?: string;
	timePerExecution: number;
	costPerHour: number;
	category?: string;
	isActive: boolean;
	createdBy?: string;
	createdAt?: Date;
	updatedBy?: string;
	updatedAt?: Date;
}

export interface BusinessProcess {
	partitionKey: string;
	rowKey: string;
	agentName: string;
	usageCount?: number;
	totalAssistedHours?: number;
	totalCostSavings?: number;
	roi?: number;
	startDate?: Date;
	endDate?: Date;
	createdBy?: string;
	createdAt?: Date;
	updatedBy?: string;
	updatedAt?: Date;
}

// System Config API
export const configApi = {
	list: () => fetchApi('/config'),
	get: (key: string) => fetchApi(`/config/${key}`),
	create: (data: Partial<SystemConfig>) => fetchApi('/config', {
		method: 'POST',
		body: JSON.stringify(data)
	}),
	update: (key: string, data: Partial<SystemConfig>) => fetchApi(`/config/${key}`, {
		method: 'PUT',
		body: JSON.stringify(data)
	}),
	delete: (key: string) => fetchApi(`/config/${key}`, { method: 'DELETE' })
};

// KPI API
export const kpiApi = {
	list: (): Promise<KpiDefinition[]> => fetchApi('/kpi'),
	get: (id: string): Promise<KpiDefinition> => fetchApi(`/kpi/${id}`),
	create: (data: Partial<KpiDefinition>): Promise<KpiDefinition> => fetchApi('/kpi', {
		method: 'POST',
		body: JSON.stringify(data)
	}),
	update: (id: string, data: Partial<KpiDefinition>): Promise<KpiDefinition> => fetchApi(`/kpi/${id}`, {
		method: 'PUT',
		body: JSON.stringify(data)
	}),
	delete: (id: string) => fetchApi(`/kpi/${id}`, { method: 'DELETE' })
};

// Business Process API
export const businessProcessApi = {
	list: (): Promise<BusinessProcess[]> => fetchApi('/business-process'),
	listByKpi: (kpiId: string): Promise<BusinessProcess[]> => fetchApi(`/business-process/kpi/${kpiId}`),
	create: (data: Partial<BusinessProcess>): Promise<BusinessProcess> => fetchApi('/business-process', {
		method: 'POST',
		body: JSON.stringify(data)
	}),
	update: (kpiId: string, processId: string, data: Partial<BusinessProcess>): Promise<BusinessProcess> => 
		fetchApi(`/business-process/${kpiId}/${processId}`, {
			method: 'PUT',
			body: JSON.stringify(data)
		}),
	delete: (kpiId: string, processId: string) => 
		fetchApi(`/business-process/${kpiId}/${processId}`, { method: 'DELETE' })
};

// Agents API
export const agentsApi = {
	list: (): Promise<string[]> => fetchApi('/agents')
};

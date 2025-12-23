import { TableClient, TableEntity, AzureNamedKeyCredential } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Table Storage クライアント管理
 */
export class TableStorageService {
  private accountName: string;
  private credential: DefaultAzureCredential | AzureNamedKeyCredential;

  constructor() {
    this.accountName = process.env.STORAGE_ACCOUNT_NAME!;
    // Managed Identity 使用
    this.credential = new DefaultAzureCredential();
  }

  getClient(tableName: string): TableClient {
    const url = `https://${this.accountName}.table.core.windows.net`;
    return new TableClient(url, tableName, this.credential);
  }
}

/**
 * SystemConfig エンティティ
 * スケジュール設定や管理設定を格納
 */
export interface SystemConfigEntity extends TableEntity {
  partitionKey: string; // 'config'
  rowKey: string; // 設定キー (例: 'ingestion_schedule', 'retention_days')
  value: string; // 設定値 (JSON文字列)
  description?: string; // 説明
  updatedBy?: string; // 更新者UPN
  updatedAt?: Date; // 更新日時
}

/**
 * KpiDefinition エンティティ
 * 業務フロー定義、時間コスト設定
 */
export interface KpiDefinitionEntity extends TableEntity {
  partitionKey: string; // 'kpi'
  rowKey: string; // UUID
  name: string; // 業務フロー名
  description?: string; // 説明
  timePerExecution: number; // 1回あたりの所要時間（分）
  costPerHour: number; // 時間コスト（円/時）
  category?: string; // カテゴリ (例: 'customer_support', 'data_analysis')
  isActive: boolean; // 有効/無効
  createdBy?: string; // 作成者UPN
  createdAt?: Date; // 作成日時
  updatedBy?: string; // 更新者UPN
  updatedAt?: Date; // 更新日時
}

/**
 * BusinessProcess エンティティ
 * 業務プロセスとエージェントの関連付け、ROI算出
 */
export interface BusinessProcessEntity extends TableEntity {
  partitionKey: string; // 業務フローID (KpiDefinition.rowKey)
  rowKey: string; // UUID
  agentName: string; // エージェント名 (Graph/Copilot Studio から抽出)
  usageCount?: number; // 利用回数
  totalAssistedHours?: number; // 合計支援時間
  totalCostSavings?: number; // 合計コスト削減額（円）
  roi?: number; // ROI (%)
  startDate?: Date; // トラッキング開始日
  endDate?: Date; // トラッキング終了日 (null = 継続中)
  createdBy?: string; // 作成者UPN
  createdAt?: Date; // 作成日時
  updatedBy?: string; // 更新者UPN
  updatedAt?: Date; // 更新日時
}

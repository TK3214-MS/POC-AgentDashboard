# テスト戦略と運用 Runbook

**日本語** | [English](testing-and-runbook.en.md)

## 1. テスト戦略

### 1.1 ユニットテスト

#### Azure Functions
**対象**: `src/shared/utils.ts`, `src/collectors/*.ts`

**ツール**: Jest or Mocha

**テストケース例**:
```typescript
// hashActor のテスト
test('hashActor should return consistent SHA-256 hash', async () => {
  process.env.HASH_SALT = 'test-salt';
  const hash1 = await hashActor('user@contoso.com');
  const hash2 = await hashActor('USER@contoso.com');
  expect(hash1).toBe(hash2); // 大文字小文字を正規化
  expect(hash1).toHaveLength(64); // SHA-256 = 64文字
});

// retryWithBackoff のテスト
test('retryWithBackoff should retry on failure', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts < 3) throw new Error('Retry');
    return 'success';
  };
  const result = await retryWithBackoff(fn, 3, 10);
  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

#### Fabric Notebooks (PySpark)
**対象**: スキーマ変換ロジック

**ツール**: pytest + PySpark test fixtures

**テストケース例**:
```python
def test_bronze_to_silver_schema():
    # モック DataFrame を作成
    data = [{"id": "1", "prompt": "test" * 200, "actorId": "hash123"}]
    df = spark.createDataFrame(data)
    
    # 512文字トリムのテスト
    result = df.withColumn("prompt_redacted", F.substring("prompt", 1, 512))
    assert len(result.first().prompt_redacted) == 512
```

### 1.2 統合テスト

#### Functions → Storage 書き込み
**シナリオ**: Graph API モックデータを Storage に書き込み、Shortcut 経由で Fabric から読み取り。

**手順**:
1. Graph API を Wiremock でモック (ページング含む)
2. Functions をローカル実行
3. Storage Explorer で `raw/graph_interactions/` にファイル存在確認
4. Fabric Notebook で Shortcut 読み取りテスト

#### Bronze → Silver → Gold パイプライン
**シナリオ**: 1週間分のモックデータで全パイプラインを実行。

**手順**:
1. Storage に過去7日分のモックJSON配置
2. Fabric Pipeline を手動実行
3. Silver/Gold テーブルの件数・スキーマ確認
4. Power BI で可視化テスト

### 1.3 負荷テスト

#### Graph API ページング
**目標**: 10,000件のイベントを1日で収集 (100件/page × 100 page)

**ツール**: Azure Load Testing or K6

**シナリオ**:
- Graph API に 100 page の連続リクエスト
- レート制限 (429) 発生時の指数バックオフ確認
- 最終的に全ページ取得完了

#### Fabric Notebook 処理時間
**目標**: 10,000件のイベントを 5分以内で Silver に変換

**手順**:
1. 10,000件のモックデータを Storage に配置
2. `bronze_to_silver` Notebook を実行
3. Spark UI で処理時間・パーティション分散を確認

---

## 2. 運用 Runbook

### 2.1 日次運用

#### タスク
1. **03:00 JST**: Functions で Graph Interactions 収集
2. **03:30 JST**: Functions で Licensed Users 収集
3. **04:00 JST**: Fabric Pipeline で Bronze → Silver 変換
4. **05:00 JST**: Fabric Pipeline で TTL クリーンアップ

#### 確認項目
- Application Insights で Functions 実行成功を確認
- Storage `raw/graph_interactions/date=YYYY-MM-DD/` にファイル存在
- Fabric Pipeline 実行ログで成功確認
- Silver テーブルの件数が増加

#### 失敗時の対応
**Functions 失敗 (API エラー)**:
1. Application Insights でエラーログ確認
2. Graph API のレート制限 (429) 確認 → 30分後に手動再実行
3. 認証エラー (401) → Managed Identity の権限確認

**Fabric Pipeline 失敗**:
1. Pipeline 実行ログでエラー確認
2. Shortcut 接続エラー → Storage RBAC 権限確認
3. スキーマエラー → raw データのサンプル確認、Notebook 修正

### 2.2 週次運用

#### タスク
1. **月曜 07:00 JST**: Fabric Pipeline でシナリオ抽出 (Azure OpenAI)
2. **月曜 08:00 JST**: Fabric Pipeline で週次 Gold 集計
3. **月曜 09:00 JST**: Power BI データセットリフレッシュ

#### 確認項目
- Azure OpenAI の API 呼び出し成功
- Gold テーブルの `scenario_label` に新規シナリオ追加
- Power BI レポートで最新データ表示

#### 失敗時の対応
**Azure OpenAI エラー (429, クォータ超過)**:
1. Azure Portal で OpenAI のクォータ確認
2. バッチサイズを縮小 (1000件 → 500件)
3. Premium Tier にアップグレード検討

**Power BI リフレッシュ失敗**:
1. Power BI Service で Dataset Settings → Refresh history 確認
2. Fabric Lakehouse 接続エラー → Workspace Region 確認
3. RLS エラー → Entra SG メンバーシップ確認

### 2.3 再実行手順

#### Functions 再実行 (特定日付)
```bash
# Azure Portal → Function App → Functions → ingestGraphInteractions → Code + Test
# JSON Body で日付指定
{
  "start": "2025-01-15T00:00:00Z",
  "end": "2025-01-16T00:00:00Z"
}
```

または PowerShell:
```powershell
$body = @{
  start = "2025-01-15T00:00:00Z"
  end = "2025-01-16T00:00:00Z"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "https://<func-app>.azurewebsites.net/api/ingestGraphInteractions" -Body $body -ContentType "application/json"
```

#### Fabric Notebook 再実行
1. Fabric Workspace → Lakehouse → Notebooks
2. `bronze_to_silver` を開く → Run all
3. Pipeline で自動再実行: Pipeline → Run with parameters → date range 指定

### 2.4 データ品質モニタリング

#### メトリクス
- **日次**:
  - Graph Interactions 件数 (前日比±20%以内)
  - Licensed Users 件数 (前日比±5%以内)
  - Silver テーブルの `org_unit = "unknown"` 比率 (<10%)
  - Silver テーブルの `outcome = "error"` 比率 (<5%)

- **週次**:
  - Gold テーブルの `scenario_label = "その他"` 比率 (<20%)
  - Assisted hours の急増/急減 (前週比±30%以内)

#### アラート設定
Application Insights で以下のアラートを設定:
```kusto
// Functions 失敗率が 10% 超過
requests
| where success == false
| summarize FailureRate = count() * 100.0 / toscalar(requests | count())
| where FailureRate > 10
```

```kusto
// Graph API レート制限 (429) 頻発
dependencies
| where resultCode == 429
| summarize Count = count() by bin(timestamp, 1h)
| where Count > 5
```

### 2.5 監査ケース運用

#### ケーススニペット登録
**トリガー**: サポート問い合わせ、コンプライアンス監査

**手順**:
1. Fabric Workspace → Secure Notebook (管理者専用)
2. `case_snippet` に手動INSERT:
   ```python
   from pyspark.sql import Row
   
   snippet = Row(
       case_id="CASE-2025-001",
       actor_id="<hashed-id>",
       turn_index=0,
       snippet="要約: ユーザーが契約書レビューを依頼...",
       event_id="evt-123",
       created_at="2025-01-15T10:00:00Z",
       created_by="admin@contoso.com"
   )
   
   df = spark.createDataFrame([snippet])
   df.write.mode("append").format("delta").saveAsTable("secure.case_snippet")
   ```

3. 最大5ターン/512文字を強制:
   ```python
   # バリデーション
   if len(snippet.snippet) > 512:
       raise ValueError("Snippet exceeds 512 chars")
   if snippet.turn_index > 4:
       raise ValueError("Max 5 turns per case")
   ```

#### アクセス制御
- `secure.case_snippet` は Power BI Admin モデルでのみ参照可
- Entra SG `PBI-Copilot-Admin` メンバーのみ閲覧

---

## 3. トラブルシューティング

### 3.1 よくある問題

| 問題 | 原因 | 対応 |
|------|------|------|
| Functions が起動しない | MI の Graph 権限未付与 | `infra/README.md` の手順で権限付与 |
| Shortcut が空 | Storage Lifecycle で削除済み | TTL 14日以内のデータ確認 |
| Azure OpenAI タイムアウト | API 呼び出し過多 | バッチサイズ縮小、リトライ間隔調整 |
| Power BI に org_unit が表示されない | extensionAttribute10 未設定 | Entra でユーザー属性確認 |
| RLS が効かない | Entra SG メンバーシップ未反映 | Power BI Service でロール再割り当て |

### 3.2 エスカレーションフロー
1. **L1**: Application Insights ログ確認 → 既知の問題は Runbook で対応
2. **L2**: Azure Portal でリソース状態確認 → 設定ミスは修正
3. **L3**: Microsoft サポートにエスカレーション (Graph API, Fabric, Power BI)

---

## 4. 変更管理

### 4.1 Taxonomy 追加
1. `fabric/notebooks/scenario_extract.py` の `TAXONOMY` リストに追加
2. `fabric/notebooks/seed_dim_scenario_weight.py` に新規重みを追加
3. Notebook 再実行 → 週次パイプラインで反映

### 4.2 Assisted Hours 重み変更
1. Power BI Desktop で `Dim_Scenario` テーブルの `assisted_hours_weight` を編集
2. または Fabric Notebook で直接UPDATE:
   ```python
   spark.sql("""
   UPDATE gold.dim_scenario_weight
   SET assisted_hours_weight = 0.50
   WHERE scenario_label = 'メール要約'
   """)
   ```
3. 週次集計で自動反映

### 4.3 スキーマ変更
1. `docs/lakehouse-design.md` のDDL更新
2. Fabric Notebook で `ALTER TABLE` or `CREATE TABLE` (新規カラム追加)
3. Power BI モデルをリフレッシュ

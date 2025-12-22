# Fabric Notebooks

M365 Copilot データの変換・集計・クリーンアップ。

## ノートブック一覧

### 1. bronze_to_silver.py
**目的**: raw (Shortcut) → silver.ai_interaction_event, secure.dim_user_private

**実行頻度**: 日次 (Functions 収集後)

**処理**:
- Graph Interactions を読み込み、本文を 512文字に制限
- actor_id ハッシュ化済みデータを Silver に MERGE
- Users を読み込み、secure.dim_user_private に UPSERT

### 2. seed_dim_scenario_weight.py
**目的**: gold.dim_scenario_weight にPoC初期値を投入

**実行頻度**: 初回のみ (手動)

**処理**:
- 30カテゴリの Assisted hours 係数を設定
- 後から Power BI/DAX で参照して再計算可能

### 3. scenario_extract.py
**目的**: silver → gold.ai_scenario_fact (Azure OpenAI で taxonomy 分類)

**実行頻度**: 週次 (月曜 07:00 JST 推奨)

**処理**:
- Silver から prompt_redacted + response_redacted を取得
- Azure OpenAI で taxonomy 分類 (LLM推論)
- Gold に scenario_label, intent_label, confidence を書き込み

**注意**: Azure OpenAI の endpoint/key を環境変数で設定。

### 4. weekly_gold_aggregate.py
**目的**: gold.ai_scenario_fact + gold.dim_scenario_weight → assisted_hours 算出

**実行頻度**: 週次 (シナリオ抽出後)

**処理**:
- Gold Fact と Weight を JOIN
- `assisted_hours = sessions × weight × quality_factor` を計算
- Gold テーブルを更新 (Power BI リフレッシュ前)

### 5. cleanup_raw.py
**目的**: TTL クリーンアップ (14日以前の raw パーティション削除)

**実行頻度**: 日次 (Storage Lifecycle のバックアップ)

**処理**:
- `raw/*/date=YYYY-MM-DD/` で 14日以前のフォルダを削除
- Storage Lifecycle が有効な場合は不要

## セットアップ

### 1. Lakehouse 作成
1. Fabric Workspace → Lakehouse `copilot_analytics_lh` 作成
2. Files → New shortcut → Azure Data Lake Storage Gen2
3. 接続先: `https://<storage-account>.dfs.core.windows.net/raw`
4. Shortcut 名: `raw`

### 2. ノートブックインポート
1. Fabric Workspace → New → Import notebook
2. `fabric/notebooks/*.py` をインポート
3. Default Lakehouse: `copilot_analytics_lh` を設定

### 3. 環境変数設定 (シナリオ抽出用)
Notebook 内で `os.environ` または Fabric Workspace Settings で設定:
- `AZURE_OPENAI_ENDPOINT`: `https://<your-openai>.openai.azure.com/`
- `AZURE_OPENAI_KEY`: `<your-api-key>`
- `AZURE_OPENAI_DEPLOYMENT`: `gpt-4o-mini` (デフォルト)

### 4. Pipeline 設定
1. Fabric Workspace → New → Data pipeline
2. **日次パイプライン**:
   - Trigger: 毎日 04:00 JST
   - Activity: Run notebook `bronze_to_silver`
   - Activity: Run notebook `cleanup_raw`
3. **週次パイプライン**:
   - Trigger: 毎週月曜 07:00 JST
   - Activity: Run notebook `scenario_extract`
   - Activity: Run notebook `weekly_gold_aggregate`
   - Activity: Refresh Power BI dataset

## トラブルシューティング

### Shortcut が表示されない
- Lakehouse → Files → Shortcuts → Refresh
- Storage アカウントの RBAC 権限確認 (Fabric の MI に Reader 権限)

### Azure OpenAI エラー
- endpoint/key の環境変数設定確認
- API クォータ確認 (Japan East リージョン)

### TTL 削除が動かない
- Storage Lifecycle Management の設定確認
- Notebook `cleanup_raw` を手動実行

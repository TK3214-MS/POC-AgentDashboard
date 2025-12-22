# Lakehouse 設計

## 1. フォルダ構造 (Storage Account: Japan East)

### 1.1 Azure Storage `raw` コンテナ
```
raw/
├─ graph_interactions/
│  ├─ date=2025-01-15/
│  │  ├─ page_000.json
│  │  ├─ page_001.json
│  │  └─ ...
│  └─ date=2025-01-16/
│     └─ ...
├─ users/
│  ├─ date=2025-01-15/
│  │  └─ licensed_users.json
│  └─ ...
├─ copilot_studio_transcript/
│  ├─ date=2025-01-15/
│  │  ├─ session_001.csv
│  │  └─ ...
│  └─ ...
└─ o365_audit/
   ├─ date=2025-01-15/
   │  ├─ content_001.json
   │  └─ ...
   └─ ...
```

**TTL**: Storage Lifecycle Management で 14日後自動削除 (date パーティション単位)。

### 1.2 Fabric Lakehouse `copilot_analytics_lh`
```
copilot_analytics_lh/
├─ Files/
│  └─ shortcuts/
│     └─ raw/ → [Azure Storage raw コンテナへの Shortcut]
├─ Tables/
│  ├─ bronze/
│  │  ├─ graph_ai_interaction_raw
│  │  ├─ cs_transcript_raw
│  │  ├─ cs_session_raw
│  │  └─ o365_audit_raw
│  ├─ silver/
│  │  ├─ ai_interaction_event
│  │  ├─ cs_session_event
│  │  └─ audit_event
│  ├─ gold/
│  │  ├─ ai_scenario_fact
│  │  └─ dim_scenario_weight
│  └─ secure/
│     ├─ dim_user_private
│     └─ case_snippet
```

## 2. Shortcut 設計

### 2.1 Shortcut 作成手順
1. Fabric Workspace → Lakehouse `copilot_analytics_lh` 作成
2. Files → New shortcut → Azure Data Lake Storage Gen2
3. 接続情報:
   - URL: `https://<storage-account>.dfs.core.windows.net/<container>`
   - 認証: Organizational account (Entra ID) or Service Principal
4. Shortcut 名: `raw`
5. パス: `/` (コンテナルート)

### 2.2 Shortcut のメリット
- **コスト削減**: データをコピーしないため、ストレージ使用量を最小化。
- **データレジデンシ**: Storage は Japan East 固定、Fabric Workspace も同一リージョンで作成。
- **TTL 一元管理**: Storage Lifecycle で 14日削除を設定すれば、Fabric 側で追加処理不要 (Notebook での削除も可)。

## 3. Canonical スキーマ (DDL)

### 3.1 silver.ai_interaction_event
正規化イベント。Graph と Copilot Studio を統一スキーマに変換。本文なし or 512文字redacted。

```sql
CREATE TABLE silver.ai_interaction_event (
  event_id STRING NOT NULL COMMENT 'イベント一意識別子',
  source STRING NOT NULL COMMENT 'データソース: graph|copilot_studio|audit',
  actor_id STRING NOT NULL COMMENT 'ハッシュ化されたユーザー識別子 (SHA-256)',
  org_unit STRING COMMENT '部署/チーム (extensionAttribute10)',
  timestamp TIMESTAMP NOT NULL COMMENT 'イベント発生日時 (UTC)',
  workload STRING COMMENT 'M365 アプリ/Copilot機能 (Teams, Word, Excel等)',
  session_id STRING COMMENT 'セッション識別子',
  prompt_redacted STRING COMMENT 'プロンプト (最大512文字、それ以外はNULL)',
  response_redacted STRING COMMENT 'レスポンス (最大512文字、それ以外はNULL)',
  duration_ms BIGINT COMMENT '処理時間 (ミリ秒)',
  tokens_prompt INT COMMENT 'プロンプトトークン数',
  tokens_completion INT COMMENT '応答トークン数',
  outcome STRING COMMENT '結果: success|fallback|aborted|error',
  quality_factor DOUBLE COMMENT '品質スコア (0.0-1.0)',
  license_sku STRING COMMENT 'Copilot SKU ID',
  scenario_hint STRING COMMENT 'シナリオヒント (LLM分類前の仮ラベル)',
  raw_ref STRING COMMENT 'raw データへの参照パス (14日間のみ有効)',
  event_date DATE NOT NULL COMMENT 'パーティションキー (日付)'
)
USING DELTA
PARTITIONED BY (event_date)
COMMENT 'M365 Copilot と Copilot Studio の正規化イベント';
```

### 3.2 gold.ai_scenario_fact
LLM でシナリオ分類した集計ファクト。Assisted hours 計算用。

```sql
CREATE TABLE gold.ai_scenario_fact (
  scenario_date DATE NOT NULL COMMENT '集計日付',
  actor_id STRING NOT NULL COMMENT 'ハッシュ化ユーザー識別子',
  org_unit STRING COMMENT '部署/チーム',
  scenario_label STRING NOT NULL COMMENT 'シナリオラベル (taxonomy分類結果)',
  intent_label STRING COMMENT '意図ラベル (LLM推論)',
  confidence DOUBLE COMMENT 'LLM分類信頼度 (0.0-1.0)',
  evidence_event_ids ARRAY<STRING> COMMENT '根拠イベントID (最大5件)',
  outcome STRING COMMENT 'シナリオ結果 (success|fallback|aborted)',
  quality_factor DOUBLE COMMENT 'シナリオ品質スコア平均',
  assisted_hours DOUBLE COMMENT '支援時間 (sessions × weight × quality_factor)',
  sessions INT COMMENT 'セッション数',
  tokens_prompt INT COMMENT 'プロンプトトークン合計',
  tokens_completion INT COMMENT '応答トークン合計'
)
USING DELTA
PARTITIONED BY (scenario_date)
COMMENT 'シナリオ別集計ファクト (Assisted hours算出)';
```

### 3.3 gold.dim_scenario_weight
Assisted hours 係数マスタ。Power BI/DAX で参照し、後から変更可能。

```sql
CREATE TABLE gold.dim_scenario_weight (
  scenario_label STRING NOT NULL COMMENT 'シナリオラベル (主キー)',
  assisted_hours_weight DOUBLE NOT NULL COMMENT '支援時間係数 (時間単位)',
  effective_from DATE NOT NULL COMMENT '有効開始日',
  effective_to DATE COMMENT '有効終了日 (NULL=現在有効)',
  description STRING COMMENT 'シナリオ説明'
)
USING DELTA
COMMENT 'シナリオ別 Assisted hours 係数 (PoC初期値、後から変更可)';
```

**初期データ例**:
```sql
INSERT INTO gold.dim_scenario_weight VALUES
  ('メール要約', 0.25, '2025-01-01', NULL, 'メール本文を要約し返信案を生成'),
  ('会議メモ生成', 0.35, '2025-01-01', NULL, 'Teams会議の議事録を自動生成'),
  ('プレゼン作成', 0.60, '2025-01-01', NULL, 'PowerPointスライドのアウトライン作成'),
  ('コードレビュー', 0.80, '2025-01-01', NULL, 'GitHub Copilotでコード補完・レビュー'),
  ('データ抽出', 0.40, '2025-01-01', NULL, 'Excel/PDFからデータ抽出とテーブル生成');
```

### 3.4 secure.dim_user_private
actor_id ↔ UPN 対応表。管理者専用。

```sql
CREATE TABLE secure.dim_user_private (
  actor_id STRING NOT NULL COMMENT 'ハッシュ化ユーザー識別子 (主キー)',
  upn STRING NOT NULL COMMENT 'UserPrincipalName (メールアドレス)',
  display_name STRING COMMENT '表示名',
  org_unit STRING COMMENT '部署/チーム (extensionAttribute10)',
  license_sku STRING COMMENT 'Copilot SKU ID',
  last_seen TIMESTAMP NOT NULL COMMENT '最終更新日時'
)
USING DELTA
COMMENT 'ユーザー個人情報 (管理者専用、Power BI Admin モデルのみ参照)';
```

### 3.5 secure.case_snippet
例外抜粋。監査・品質改善・サポート目的のケース ID 紐付け。

```sql
CREATE TABLE secure.case_snippet (
  case_id STRING NOT NULL COMMENT 'ケース管理ID',
  actor_id STRING NOT NULL COMMENT 'ハッシュ化ユーザー識別子',
  turn_index INT NOT NULL COMMENT 'ターン番号 (0-4、最大5ターン)',
  snippet STRING NOT NULL COMMENT '抜粋テキスト (最大512文字)',
  event_id STRING COMMENT '元イベントID',
  created_at TIMESTAMP NOT NULL COMMENT '登録日時',
  created_by STRING COMMENT '登録者UPN (管理者)',
  CONSTRAINT pk_case_snippet PRIMARY KEY (case_id, turn_index)
)
USING DELTA
COMMENT '例外抜粋 (監査・サポート用、最大5ターン/512文字)';
```

## 4. TTL 設計

### 4.1 Storage Lifecycle Management (推奨)
```json
{
  "rules": [
    {
      "name": "delete-raw-after-14days",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["raw/"]
        },
        "actions": {
          "baseBlob": {
            "delete": {
              "daysAfterModificationGreaterThan": 14
            }
          }
        }
      }
    }
  ]
}
```

### 4.2 Fabric Notebook 削除 (バックアップ)
Lifecycle 未設定時のバックアップとして、日次 Notebook で古いパーティションを削除。

```python
from notebookutils import mssparkutils
from datetime import datetime, timedelta

TTL_DAYS = 14
RAW_BASE = "/lakehouse/default/Files/shortcuts/raw"
cutoff = datetime.utcnow().date() - timedelta(days=TTL_DAYS)

for source in ["graph_interactions", "users", "copilot_studio_transcript", "o365_audit"]:
  path = f"{RAW_BASE}/{source}"
  try:
    folders = mssparkutils.fs.ls(path)
    for f in folders:
      if f.name.startswith("date="):
        date_str = f.name.split("=")[1].strip("/")
        if datetime.strptime(date_str, "%Y-%m-%d").date() < cutoff:
          mssparkutils.fs.rm(f.path, True)
          print(f"Deleted: {f.path}")
  except Exception as e:
    print(f"Error: {source} - {e}")
```

## 5. データフロー

### 5.1 日次 (Functions → Storage → Bronze → Silver)
1. **03:00 JST**: Functions Timer で Graph Interaction Export を収集し `raw/graph_interactions/date=YYYY-MM-DD/` に保存。
2. **03:30 JST**: Functions で Entra ユーザー (Copilot ライセンス保有者) を収集し `raw/users/date=YYYY-MM-DD/` に保存。
3. **04:00 JST**: Fabric Pipeline で Bronze → Silver 変換 Notebook を実行。
   - `raw` を Shortcut 経由で読み込み。
   - actor_id ハッシュ化、本文を 512文字にトリム (redacted)。
   - `silver.ai_interaction_event` に MERGE (event_id で冪等性)。
   - `secure.dim_user_private` に UPSERT。

### 5.2 週次 (Silver → Gold → Power BI)
1. **月曜 07:00 JST**: Fabric Pipeline でシナリオ抽出 Notebook を実行。
   - `silver.ai_interaction_event` を読み込み。
   - Azure OpenAI で taxonomy 分類 (LLM推論)。
   - `gold.ai_scenario_fact` に書き込み。
2. **月曜 08:00 JST**: Fabric Pipeline で週次集計 Notebook を実行。
   - `gold.ai_scenario_fact` と `gold.dim_scenario_weight` を JOIN。
   - `assisted_hours = sessions × weight × quality_factor` を計算。
3. **月曜 09:00 JST**: Power BI データセットリフレッシュ (Public / Admin モデル)。

---

**次のステップ**: IaC (Bicep) で Storage/Key Vault/Functions を自動デプロイし、Functions のコード実装に進む。

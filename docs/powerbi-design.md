# Power BI セマンティックモデル設計

## 概要

2つのセマンティックモデルで労務/個人情報要件を満たす:
- **Public モデル**: 部署/チーム粒度のみ (個人特定不可)
- **Admin モデル**: UPN 表示可 (Entra SG で RLS 制御)

## 1. Public モデル (一般ユーザー向け)

### データソース
- `gold.ai_scenario_fact` (actor_id は集計済みで含まない)
- `gold.dim_scenario_weight` (重み参照用)

### テーブル構成

#### Fact_Scenario (ファクト)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.ai_scenario_fact")
// actor_id を削除、org_unit でグループ化
Transformed = Table.Group(Source, {"scenario_date", "org_unit", "scenario_label"}, {
  {"sessions", each List.Sum([sessions]), Int64.Type},
  {"assisted_hours", each List.Sum([assisted_hours]), type number},
  {"tokens_prompt", each List.Sum([tokens_prompt]), Int64.Type},
  {"tokens_completion", each List.Sum([tokens_completion]), Int64.Type}
})
```

#### Dim_OrgUnit (部署ディメンション)
```dax
Distinct_OrgUnit = DISTINCT(Fact_Scenario[org_unit])
```

#### Dim_Scenario (シナリオディメンション)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.dim_scenario_weight")
```

#### Dim_Date (日付ディメンション)
```dax
Dim_Date = CALENDAR(DATE(2025,1,1), DATE(2026,12,31))
```

### メジャー

```dax
// Total Assisted Hours
Total_Assisted_Hours = SUM(Fact_Scenario[assisted_hours])

// Total Sessions
Total_Sessions = SUM(Fact_Scenario[sessions])

// Average Assisted Hours per Session
Avg_Hours_Per_Session = DIVIDE([Total_Assisted_Hours], [Total_Sessions], 0)

// YoY Assisted Hours
YoY_Assisted_Hours = 
VAR CurrentPeriod = [Total_Assisted_Hours]
VAR PreviousPeriod = CALCULATE([Total_Assisted_Hours], DATEADD(Dim_Date[Date], -1, YEAR))
RETURN DIVIDE(CurrentPeriod - PreviousPeriod, PreviousPeriod, 0)
```

### レポートページ例

1. **サマリー**
   - KPI カード: Total Assisted Hours, Total Sessions, Avg Hours/Session
   - 折れ線グラフ: 週次 Assisted Hours トレンド
   - 円グラフ: org_unit 別セッション数

2. **シナリオ分析**
   - テーブル: scenario_label × org_unit × assisted_hours
   - 棒グラフ: Top 10 scenarios by assisted_hours
   - ツリーマップ: org_unit × scenario_label

3. **トレンド分析**
   - 折れ線グラフ: 週次 assisted_hours (scenario別)
   - エリアチャート: org_unit 別積み上げ

### RLS 設定
**不要** (全ユーザー閲覧可)

---

## 2. Admin モデル (管理者向け)

### データソース
- `gold.ai_scenario_fact` (actor_id 含む)
- `gold.dim_scenario_weight`
- `secure.dim_user_private` (UPN 対応表)

### テーブル構成

#### Fact_Scenario_Admin (ファクト)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.ai_scenario_fact")
// actor_id を保持
```

#### Dim_User_Private (ユーザーディメンション)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "secure.dim_user_private")
```

#### Dim_Scenario, Dim_Date
Public モデルと同一。

### リレーションシップ

```
Fact_Scenario_Admin[actor_id] → Dim_User_Private[actor_id] (多対1)
Fact_Scenario_Admin[scenario_label] → Dim_Scenario[scenario_label] (多対1)
Fact_Scenario_Admin[scenario_date] → Dim_Date[Date] (多対1)
```

### メジャー

Public モデルと同一 + 以下を追加:

```dax
// Unique Users
Unique_Users = DISTINCTCOUNT(Fact_Scenario_Admin[actor_id])

// Sessions per User
Sessions_Per_User = DIVIDE([Total_Sessions], [Unique_Users], 0)
```

### レポートページ例

1. **サマリー** (Public と同一)
2. **ユーザー詳細**
   - テーブル: upn × org_unit × scenario_label × assisted_hours × sessions
   - 散布図: sessions (X軸) × assisted_hours (Y軸)、upn でラベル
3. **ドリルダウン**
   - actor_id 選択 → 個別セッション詳細 (evidence_event_ids 表示)

### RLS 設定 (重要)

**ロール名**: `CopilotAdminRole`

**DAX フィルター** (Dim_User_Private):
```dax
[upn] IN { 
  // Entra SG のメンバー UPN を動的取得 (Power BI Premium 必要)
  // 簡易版: 静的リストで代用
  "admin1@contoso.com", 
  "admin2@contoso.com" 
}
```

**本番推奨**: Entra セキュリティグループ連携
1. Power BI Service → Workspace Settings → Security
2. Admin ロールに Entra SG `PBI-Copilot-Admin` を割り当て
3. RLS フィルター: `USERPRINCIPALNAME()` を使用

```dax
[upn] = USERPRINCIPALNAME()
```

---

## 3. デプロイ手順

### 3.1 Power BI Desktop で作成
1. **Public モデル**:
   - Fabric Lakehouse 接続 (Direct Lake 推奨)
   - テーブル/メジャー作成
   - レポート作成
   - .pbix 保存: `CopilotAnalytics_Public.pbix`

2. **Admin モデル**:
   - 同様に作成
   - RLS 設定 (ロール: CopilotAdminRole)
   - .pbix 保存: `CopilotAnalytics_Admin.pbix`

### 3.2 Power BI Service に発行
1. Power BI Desktop → Publish → Fabric Workspace 選択
2. Public モデル → 全員閲覧可
3. Admin モデル → RLS でアクセス制限

### 3.3 週次リフレッシュ設定
1. Power BI Service → Dataset Settings
2. Scheduled refresh: 毎週月曜 09:00 JST
3. Fabric Pipeline の最後に `Refresh Power BI Dataset` Activity 追加 (推奨)

---

## 4. ベストプラクティス

### 4.1 Direct Lake vs Import
- **Direct Lake**: Fabric Lakehouse 直接参照、リアルタイム性高い (Premium 必要)
- **Import**: データコピー、パフォーマンス高い、週次リフレッシュ向き

### 4.2 Assisted Hours 再計算
Power BI で weight を変更した場合、DAX メジャーで再計算:

```dax
Assisted_Hours_Recalc = 
SUMX(
  Fact_Scenario_Admin,
  Fact_Scenario_Admin[sessions] * 
  RELATED(Dim_Scenario[assisted_hours_weight]) * 
  Fact_Scenario_Admin[quality_factor]
)
```

### 4.3 パフォーマンス最適化
- Fact テーブルにインデックス (scenario_date, scenario_label)
- 集計テーブル (Aggregation) を作成 (月次集計等)
- Direct Lake で列削減 (不要列を除外)

---

## 5. トラブルシューティング

### RLS が効かない
- Power BI Service → Dataset Settings → Security → Role assignment 確認
- `USERPRINCIPALNAME()` が正しく解決されているか確認 (テスト: View as role)

### Fabric Lakehouse 接続エラー
- Workspace の Region 確認 (Japan East 推奨)
- Lakehouse の RBAC 権限確認 (Power BI Service の MI に Reader 権限)

### データが表示されない
- Fabric Pipeline の実行ログ確認
- Gold テーブルにデータがあるか確認 (`SELECT COUNT(*) FROM gold.ai_scenario_fact`)

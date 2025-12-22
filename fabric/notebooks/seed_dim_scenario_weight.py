# Fabric Notebook: シナリオ重み初期データ投入
# gold.dim_scenario_weight にPoC用の仮置き係数を設定

from pyspark.sql import Row
from pyspark.sql import functions as F

WEIGHT_TABLE = "gold.dim_scenario_weight"

# PoC 初期データ (Assisted hours 係数)
weights_data = [
    ("メール要約", 0.25, "2025-01-01", None, "メール本文を要約し返信案を生成"),
    ("会議メモ生成", 0.35, "2025-01-01", None, "Teams会議の議事録を自動生成"),
    ("プレゼン作成", 0.60, "2025-01-01", None, "PowerPointスライドのアウトライン作成"),
    ("コードレビュー", 0.80, "2025-01-01", None, "GitHub Copilotでコード補完・レビュー"),
    ("データ抽出", 0.40, "2025-01-01", None, "Excel/PDFからデータ抽出とテーブル生成"),
    ("テキスト翻訳", 0.15, "2025-01-01", None, "多言語テキストの翻訳"),
    ("契約書ドラフト", 0.90, "2025-01-01", None, "契約書の初期ドラフト作成"),
    ("ヘルプデスク応答", 0.50, "2025-01-01", None, "社内ヘルプデスク問い合わせ対応"),
    ("リサーチ要約", 0.70, "2025-01-01", None, "調査結果の要約とレポート作成"),
    ("数式生成", 0.20, "2025-01-01", None, "Excel数式やPython計算式の生成"),
    ("グラフ作成", 0.30, "2025-01-01", None, "データ可視化グラフの作成"),
    ("スケジュール調整", 0.10, "2025-01-01", None, "会議日程の調整"),
    ("ToDo生成", 0.05, "2025-01-01", None, "タスクリストの自動生成"),
    ("報告書作成", 0.80, "2025-01-01", None, "定期報告書のドラフト作成"),
    ("FAQ検索", 0.10, "2025-01-01", None, "社内FAQからの回答検索"),
    ("ドキュメント比較", 0.40, "2025-01-01", None, "複数ドキュメントの差分比較"),
    ("コンプライアンスチェック", 0.60, "2025-01-01", None, "文書のコンプライアンス確認"),
    ("予算計画", 0.75, "2025-01-01", None, "予算計画書の作成支援"),
    ("顧客対応", 0.50, "2025-01-01", None, "顧客問い合わせへの回答案作成"),
    ("リスク分析", 0.65, "2025-01-01", None, "プロジェクトリスクの分析"),
    ("トレーニング資料作成", 0.85, "2025-01-01", None, "研修資料のドラフト作成"),
    ("プロジェクト計画", 0.70, "2025-01-01", None, "プロジェクト計画書の作成"),
    ("デバッグ支援", 0.60, "2025-01-01", None, "コードのデバッグとエラー修正"),
    ("API設計", 0.90, "2025-01-01", None, "REST API仕様の設計"),
    ("SQL生成", 0.30, "2025-01-01", None, "データベースクエリの生成"),
    ("画像説明", 0.20, "2025-01-01", None, "画像内容の説明文生成"),
    ("音声文字起こし", 0.40, "2025-01-01", None, "音声の文字起こし"),
    ("感情分析", 0.25, "2025-01-01", None, "テキストの感情分析"),
    ("トレンド分析", 0.55, "2025-01-01", None, "データトレンドの分析"),
    ("その他", 0.20, "2025-01-01", None, "未分類のシナリオ")
]

# DataFrame 作成
df = spark.createDataFrame(
    [Row(scenario_label=r[0], assisted_hours_weight=r[1], effective_from=r[2], effective_to=r[3], description=r[4]) for r in weights_data]
)

df = df.withColumn("effective_from", F.to_date("effective_from"))

# テーブルに書き込み (初回: overwrite、以降: append or merge)
df.write.mode("overwrite").format("delta").saveAsTable(WEIGHT_TABLE)

print(f"Scenario weights initialized: {df.count()} rows")
df.show(30, truncate=False)

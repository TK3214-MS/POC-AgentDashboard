# Fabric Notebook: シナリオ抽出 (Azure OpenAI)
# silver.ai_interaction_event → gold.ai_scenario_fact

import os
import json
import requests
from pyspark.sql import functions as F
from pyspark.sql import types as T

# Azure OpenAI 設定
AZURE_OPENAI_ENDPOINT = os.environ.get("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_KEY = os.environ.get("AZURE_OPENAI_KEY")
DEPLOYMENT = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
API_VERSION = "2024-08-01-preview"

SILVER_TABLE = "silver.ai_interaction_event"
GOLD_FACT = "gold.ai_scenario_fact"

# Taxonomy (初期 30カテゴリ例)
TAXONOMY = [
    "メール要約", "会議メモ生成", "プレゼン作成", "コードレビュー", "データ抽出",
    "テキスト翻訳", "契約書ドラフト", "ヘルプデスク応答", "リサーチ要約", "数式生成",
    "グラフ作成", "スケジュール調整", "ToDo生成", "報告書作成", "FAQ検索",
    "ドキュメント比較", "コンプライアンスチェック", "予算計画", "顧客対応", "リスク分析",
    "トレーニング資料作成", "プロジェクト計画", "デバッグ支援", "API設計", "SQL生成",
    "画像説明", "音声文字起こし", "感情分析", "トレンド分析", "その他"
]

if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_KEY:
    raise ValueError("Azure OpenAI endpoint/key not configured")

# === Silver データ読み込み ===
print("Loading Silver interactions...")
silver = spark.table(SILVER_TABLE).limit(1000)  # PoC: 1000件のみ

# prompt_redacted + response_redacted を結合
rows = silver.select(
    "event_id", "actor_id", "org_unit", "timestamp", "prompt_redacted", "response_redacted"
).collect()

# === LLM 推論 (バッチ処理) ===
def classify_scenario(text: str) -> dict:
    """Azure OpenAI で taxonomy 分類"""
    prompt = f"""あなたは企業内Copilot利用のシナリオ分類器です。以下の発話を、Taxonomyに分類してください。
Taxonomy: {", ".join(TAXONOMY)}

出力形式 (JSON):
{{
  "scenario_label": "メール要約",
  "intent_label": "メール本文を要約して返信案を生成",
  "confidence": 0.95
}}

入力:
{text[:512]}
"""

    body = {
        "messages": [
            {"role": "system", "content": "企業内Copilot利用の分類を行う専門家"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 300
    }

    url = f"{AZURE_OPENAI_ENDPOINT}/openai/deployments/{DEPLOYMENT}/chat/completions?api-version={API_VERSION}"
    headers = {"api-key": AZURE_OPENAI_KEY, "Content-Type": "application/json"}

    resp = requests.post(url, headers=headers, json=body, timeout=30)
    resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]

    try:
        return json.loads(content)
    except:
        return {"scenario_label": "その他", "intent_label": "不明", "confidence": 0.0}

# LLM 推論 (簡易版: 全件処理)
print(f"Classifying {len(rows)} interactions...")
classified = []
for idx, row in enumerate(rows):
    text = (row.prompt_redacted or "") + "\n" + (row.response_redacted or "")
    result = classify_scenario(text)

    classified.append({
        "scenario_date": row.timestamp.date(),
        "actor_id": row.actor_id,
        "org_unit": row.org_unit,
        "scenario_label": result.get("scenario_label", "その他"),
        "intent_label": result.get("intent_label", "不明"),
        "confidence": float(result.get("confidence", 0.0)),
        "evidence_event_ids": [row.event_id],
        "outcome": "success",
        "quality_factor": 1.0,
        "assisted_hours": 0.0,  # 後で weight と JOIN して算出
        "sessions": 1,
        "tokens_prompt": 0,
        "tokens_completion": 0
    })

    if (idx + 1) % 100 == 0:
        print(f"Processed {idx + 1}/{len(rows)}")

# Spark DataFrame に変換
schema = T.StructType([
    T.StructField("scenario_date", T.DateType(), False),
    T.StructField("actor_id", T.StringType(), False),
    T.StructField("org_unit", T.StringType(), True),
    T.StructField("scenario_label", T.StringType(), False),
    T.StructField("intent_label", T.StringType(), True),
    T.StructField("confidence", T.DoubleType(), True),
    T.StructField("evidence_event_ids", T.ArrayType(T.StringType()), True),
    T.StructField("outcome", T.StringType(), True),
    T.StructField("quality_factor", T.DoubleType(), True),
    T.StructField("assisted_hours", T.DoubleType(), True),
    T.StructField("sessions", T.IntegerType(), True),
    T.StructField("tokens_prompt", T.IntegerType(), True),
    T.StructField("tokens_completion", T.IntegerType(), True)
])

gold_df = spark.createDataFrame(classified, schema=schema)

# Gold テーブルに書き込み
gold_df.write.mode("overwrite").format("delta").saveAsTable(GOLD_FACT)
print(f"Gold scenario fact written: {gold_df.count()} rows")

# Fabric Notebook: 週次 Gold 集計
# gold.ai_scenario_fact + gold.dim_scenario_weight → assisted_hours 算出

from pyspark.sql import functions as F

GOLD_FACT = "gold.ai_scenario_fact"
WEIGHT_TABLE = "gold.dim_scenario_weight"

# === Gold Fact 読み込み ===
print("Loading Gold scenario fact...")
gold = spark.table(GOLD_FACT)

# === Weight テーブル読み込み ===
print("Loading scenario weight...")
weights = spark.table(WEIGHT_TABLE)

# === Assisted hours 算出 ===
# assisted_hours = sessions × weight × quality_factor
gold_with_hours = (
    gold
    .join(weights, "scenario_label", "left")
    .withColumn(
        "assisted_hours",
        F.col("sessions") * F.coalesce(F.col("assisted_hours_weight"), F.lit(0.25)) * F.coalesce(F.col("quality_factor"), F.lit(1.0))
    )
    .select(
        "scenario_date", "actor_id", "org_unit", "scenario_label", "intent_label",
        "confidence", "evidence_event_ids", "outcome", "quality_factor",
        "assisted_hours", "sessions", "tokens_prompt", "tokens_completion"
    )
)

# 既存 Gold テーブルを上書き (週次リフレッシュ)
gold_with_hours.write.mode("overwrite").format("delta").saveAsTable(GOLD_FACT)
print(f"Gold scenario fact updated: {gold_with_hours.count()} rows")

# === サマリー表示 ===
summary = (
    gold_with_hours
    .groupBy("scenario_label")
    .agg(
        F.sum("sessions").alias("total_sessions"),
        F.sum("assisted_hours").alias("total_assisted_hours")
    )
    .orderBy(F.desc("total_assisted_hours"))
)

print("Top scenarios by assisted hours:")
summary.show(20, truncate=False)

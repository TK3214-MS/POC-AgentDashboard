# Fabric Notebook: Bronze → Silver
# raw (Shortcut) → silver.ai_interaction_event, secure.dim_user_private

from pyspark.sql import functions as F
from pyspark.sql import types as T
from datetime import datetime, timedelta

# パス
RAW_GRAPH_PATH = "/lakehouse/default/Files/shortcuts/raw/graph_interactions"
RAW_USERS_PATH = "/lakehouse/default/Files/shortcuts/raw/users"
SILVER_TABLE = "silver.ai_interaction_event"
SECURE_USER_TABLE = "secure.dim_user_private"

# === Graph Interactions: Bronze → Silver ===
print("Loading Graph Interactions from raw...")
raw_graph = (
    spark.read
    .option("multiLine", True)
    .json(RAW_GRAPH_PATH)
    .withColumn("event_date", F.to_date(F.col("lastUpdatedDateTime")))
)

# 本文を 512文字に制限、フル本文は保持しない
silver_interactions = (
    raw_graph
    .withColumn("event_id", F.col("id"))
    .withColumn("source", F.lit("graph"))
    .withColumn("actor_id", F.col("actorId"))
    .withColumn("org_unit", F.col("actor.organizationUnit"))
    .withColumn("timestamp", F.col("lastUpdatedDateTime").cast("timestamp"))
    .withColumn("workload", F.coalesce(F.col("workload"), F.col("serviceName"), F.lit("unknown")))
    .withColumn("session_id", F.col("sessionId"))
    .withColumn("prompt_redacted", F.substring(F.col("prompt"), 1, 512))
    .withColumn("response_redacted", F.substring(F.col("response"), 1, 512))
    .withColumn("duration_ms", F.col("durationMs"))
    .withColumn("tokens_prompt", F.col("tokensPrompt"))
    .withColumn("tokens_completion", F.col("tokensCompletion"))
    .withColumn("outcome", F.coalesce(F.col("outcome"), F.lit("unknown")))
    .withColumn("quality_factor", F.lit(None).cast(T.DoubleType()))
    .withColumn("license_sku", F.col("licenseId"))
    .withColumn("scenario_hint", F.lit(None).cast(T.StringType()))
    .withColumn("raw_ref", F.col("rawRef"))
    .select(
        "event_id", "source", "actor_id", "org_unit", "timestamp", "workload",
        "session_id", "prompt_redacted", "response_redacted", "duration_ms",
        "tokens_prompt", "tokens_completion", "outcome", "quality_factor",
        "license_sku", "scenario_hint", "raw_ref", "event_date"
    )
)

# Silver テーブルに MERGE (冪等性: event_id で重複排除)
silver_interactions.write.mode("overwrite").format("delta").saveAsTable(SILVER_TABLE)
print(f"Silver interactions written: {silver_interactions.count()} rows")

# === Users: Bronze → Secure ===
print("Loading Users from raw...")
raw_users = (
    spark.read
    .option("multiLine", True)
    .json(RAW_USERS_PATH)
)

secure_users = (
    raw_users
    .withColumn("actor_id", F.col("actorId"))
    .withColumn("upn", F.col("upn"))
    .withColumn("display_name", F.col("displayName"))
    .withColumn("org_unit", F.col("orgUnit"))
    .withColumn("license_sku", F.col("licenseSku"))
    .withColumn("last_seen", F.current_timestamp())
    .select("actor_id", "upn", "display_name", "org_unit", "license_sku", "last_seen")
)

# Secure テーブルに UPSERT (最新のみ保持)
secure_users.write.mode("overwrite").format("delta").saveAsTable(SECURE_USER_TABLE)
print(f"Secure users written: {secure_users.count()} rows")

print("Bronze → Silver transformation completed.")

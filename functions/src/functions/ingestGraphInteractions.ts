import { app, InvocationContext, Timer } from "@azure/functions";
import { collectGraphInteractions } from "../collectors/graphInteractions";
import { getYesterdayUtcWindow } from "../shared/utils";

/**
 * Timer トリガー: 毎日 18:00 UTC (JST 03:00) に実行
 * Graph Interaction Export API で M365 Copilot データ収集
 */
export async function ingestGraphInteractions(timer: Timer, context: InvocationContext): Promise<void> {
  const { start, end } = getYesterdayUtcWindow();
  context.log(`[ingestGraphInteractions] Collecting: ${start} -> ${end}`);

  try {
    await collectGraphInteractions(start, end);
    context.log("[ingestGraphInteractions] Success");
  } catch (error) {
    context.error("[ingestGraphInteractions] Error:", error);
    throw error; // リトライ可能にする
  }
}

app.timer("ingestGraphInteractions", {
  schedule: "0 0 18 * * *", // 毎日 18:00 UTC = 03:00 JST
  handler: ingestGraphInteractions,
});

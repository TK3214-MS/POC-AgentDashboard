import { app, InvocationContext, Timer } from "@azure/functions";
import { collectLicensedUsers } from "../collectors/users";

/**
 * Timer トリガー: 毎日 18:30 UTC (JST 03:30) に実行
 * Copilot ライセンス保有者を収集
 */
export async function syncUsers(timer: Timer, context: InvocationContext): Promise<void> {
  context.log("[syncUsers] Syncing licensed users");

  try {
    await collectLicensedUsers();
    context.log("[syncUsers] Success");
  } catch (error) {
    context.error("[syncUsers] Error:", error);
    throw error;
  }
}

app.timer("syncUsers", {
  schedule: "0 30 18 * * *", // 毎日 18:30 UTC = 03:30 JST
  handler: syncUsers,
});

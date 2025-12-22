import { createGraphClient, hashActor, retryWithBackoff, toDateString } from "../shared/utils";
import { StorageWriter } from "../shared/storage";

/**
 * Entra User Collector
 * Copilot ライセンス保有者のみ取得 (extensionAttribute10 含む)
 */
export async function collectLicensedUsers(): Promise<void> {
  const graph = createGraphClient();
  const storage = new StorageWriter();
  const today = toDateString(new Date());

  // COPILOT_SKU_IDS を取得 (Key Vault から参照)
  const skuIdsStr = process.env.COPILOT_SKU_IDS || "";
  if (!skuIdsStr) {
    console.warn("COPILOT_SKU_IDS not configured, skipping user sync");
    return;
  }
  const skuIds = skuIdsStr.split(",").map((s) => s.trim());

  let nextLink: string | undefined =
    "/v1.0/users?$select=id,userPrincipalName,displayName,onPremisesExtensionAttributes,assignedLicenses&$top=999";
  const licensedUsers: any[] = [];

  while (nextLink) {
    const response = await retryWithBackoff(async () => {
      return await graph.api(nextLink!).get();
    });

    const users = response.value || [];

    for (const user of users) {
      const licenses = user.assignedLicenses || [];
      const hasCopilot = licenses.some((lic: any) => skuIds.includes(lic.skuId));

      if (hasCopilot) {
        licensedUsers.push({
          actorId: await hashActor(user.userPrincipalName),
          upn: user.userPrincipalName,
          displayName: user.displayName,
          orgUnit: user.onPremisesExtensionAttributes?.extensionAttribute10 || "unknown",
          licenseSku: licenses.map((l: any) => l.skuId).join(","),
        });
      }
    }

    nextLink = response["@odata.nextLink"];
  }

  // Storage に保存 (日付単位で冪等)
  const blobPath = `users/date=${today}/licensed_users.json`;
  await storage.writeJson(blobPath, licensedUsers);

  console.log(`Collected ${licensedUsers.length} licensed users for ${today}`);
}

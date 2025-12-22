import { createGraphClient, hashActor, retryWithBackoff, toDateString } from "../shared/utils";
import { StorageWriter } from "../shared/storage";

/**
 * Graph Interaction Export Collector
 * M365 Copilot の会話データを収集 (prompt/response 含む)
 */
export async function collectGraphInteractions(startIso: string, endIso: string): Promise<void> {
  const graph = createGraphClient();
  const storage = new StorageWriter();
  const datePrefix = startIso.slice(0, 10); // YYYY-MM-DD

  let nextLink: string | undefined = `/beta/ai/aiInteractionHistory/getAllEnterpriseInteractions?$top=100&$filter=lastUpdatedDateTime ge ${startIso} and lastUpdatedDateTime lt ${endIso}`;
  let pageIndex = 0;

  while (nextLink) {
    const response = await retryWithBackoff(async () => {
      return await graph.api(nextLink!).get();
    });

    const interactions = response.value || [];

    // actor_id をハッシュ化
    const hashedInteractions = await Promise.all(
      interactions.map(async (item: any) => ({
        ...item,
        actorId: await hashActor(item.actor?.userPrincipalName || "unknown"),
        workload: item.serviceName || "unknown",
        rawRef: `graph_interactions/date=${datePrefix}/page_${String(pageIndex).padStart(3, "0")}.json`,
      }))
    );

    // Storage に保存 (冪等: 同一パス上書き)
    const blobPath = `graph_interactions/date=${datePrefix}/page_${String(pageIndex).padStart(3, "0")}.json`;
    await storage.writeJson(blobPath, hashedInteractions);

    nextLink = response["@odata.nextLink"];
    pageIndex++;
  }

  console.log(`Collected ${pageIndex} pages for ${datePrefix}`);
}

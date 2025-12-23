import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { validateAdminAccess } from "../shared/auth";

/**
 * GET /api/agents - エージェント名一覧取得
 * Fabric Lakehouse から抽出したエージェント名を Storage から取得
 */
async function getAgents(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const accountName = process.env.STORAGE_ACCOUNT_NAME!;
    const credential = new DefaultAzureCredential();
    const blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
    
    const containerClient = blobServiceClient.getContainerClient("raw");
    
    // users データから一意のエージェント名を抽出 (簡易実装)
    // 実運用では Fabric Lakehouse の Silver/Gold テーブルから取得が望ましい
    const agentNames = new Set<string>();
    
    // Graph Interactions から抽出（サンプル）
    const prefix = "graph_interactions/";
    const blobs = containerClient.listBlobsFlat({ prefix });
    
    let sampleCount = 0;
    for await (const blob of blobs) {
      if (sampleCount >= 10) break; // サンプル10件のみ
      
      const blobClient = containerClient.getBlobClient(blob.name);
      const downloadResponse = await blobClient.download();
      const content = await streamToText(downloadResponse.readableStreamBody!);
      
      const interactions = JSON.parse(content);
      for (const interaction of interactions) {
        if (interaction.appHost) {
          agentNames.add(interaction.appHost);
        }
      }
      
      sampleCount++;
    }
    
    return {
      status: 200,
      jsonBody: Array.from(agentNames).sort(),
    };
  } catch (error) {
    context.error("[getAgents] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

async function streamToText(readable: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Route
app.http("getAgents", {
  methods: ["GET"],
  authLevel: "function",
  route: "agents",
  handler: getAgents,
});

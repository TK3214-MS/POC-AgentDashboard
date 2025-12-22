import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";

/**
 * Storage クライアント (Managed Identity)
 */
export class StorageWriter {
  private blobServiceClient: BlobServiceClient;
  private containerName: string;

  constructor() {
    const accountName = process.env.STORAGE_ACCOUNT_NAME;
    if (!accountName) throw new Error("STORAGE_ACCOUNT_NAME not configured");

    this.containerName = process.env.RAW_CONTAINER || "raw";
    const credential = new DefaultAzureCredential();
    this.blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      credential
    );
  }

  /**
   * JSON データを Storage に書き込み (冪等性: 同一パスは上書き)
   */
  async writeJson(blobPath: string, data: any): Promise<void> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    const content = JSON.stringify(data);
    await blockBlobClient.upload(content, Buffer.byteLength(content), {
      blobHTTPHeaders: { blobContentType: "application/json" },
      overwrite: true,
    });
  }

  /**
   * CSV データを Storage に書き込み
   */
  async writeCsv(blobPath: string, csvContent: string): Promise<void> {
    const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    await blockBlobClient.upload(csvContent, Buffer.byteLength(csvContent), {
      blobHTTPHeaders: { blobContentType: "text/csv" },
      overwrite: true,
    });
  }
}

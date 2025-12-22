import { Client } from "@microsoft/microsoft-graph-client";
import { DefaultAzureCredential } from "@azure/identity";
import "cross-fetch/polyfill";

/**
 * Graph API クライアント (Managed Identity)
 */
export function createGraphClient(): Client {
  const credential = new DefaultAzureCredential();

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken("https://graph.microsoft.com/.default");
        if (!token) throw new Error("Failed to acquire Graph token");
        return token.token;
      },
    },
  });
}

/**
 * UPN をハッシュ化 (SHA-256)
 */
export async function hashActor(upn: string): Promise<string> {
  const salt = process.env.HASH_SALT;
  if (!salt) throw new Error("HASH_SALT not configured");

  const encoder = new TextEncoder();
  const data = encoder.encode(salt + upn.toLowerCase());
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * ISO 8601 日付範囲を生成 (昨日 00:00 - 23:59 UTC)
 */
export function getYesterdayUtcWindow(): { start: string; end: string } {
  const now = new Date();
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
  return {
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  };
}

/**
 * 日付を YYYY-MM-DD 形式に変換
 */
export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * リトライ処理 (指数バックオフ)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

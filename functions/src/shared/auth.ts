import { HttpRequest } from "@azure/functions";

/**
 * 管理者アクセス検証
 * Static Web Apps の Entra ID 認証情報をヘッダーから取得
 */
export async function validateAdminAccess(req: HttpRequest): Promise<{ email: string; userId: string }> {
  // Static Web Apps の認証情報は x-ms-client-principal ヘッダーに含まれる
  const clientPrincipalHeader = req.headers.get("x-ms-client-principal");
  
  if (!clientPrincipalHeader) {
    // ローカル開発時のフォールバック
    if (process.env.NODE_ENV === "development") {
      return {
        email: "dev@example.com",
        userId: "dev-user-id",
      };
    }
    throw new Error("Unauthorized");
  }
  
  // Base64 デコード
  const clientPrincipal = JSON.parse(Buffer.from(clientPrincipalHeader, "base64").toString("utf-8"));
  
  const email = clientPrincipal.userDetails;
  const userId = clientPrincipal.userId;
  
  // 管理者グループチェック（オプション）
  const allowedGroupId = process.env.ALLOWED_ADMIN_GROUP_ID;
  if (allowedGroupId && clientPrincipal.userRoles) {
    const hasAdminRole = clientPrincipal.userRoles.includes(allowedGroupId);
    if (!hasAdminRole) {
      throw new Error("Unauthorized");
    }
  }
  
  return { email, userId };
}

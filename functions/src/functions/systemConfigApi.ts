import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableStorageService, SystemConfigEntity } from "../shared/tableStorage";
import { validateAdminAccess } from "../shared/auth";

const tableService = new TableStorageService();

/**
 * GET /api/config - 全設定取得
 */
async function getConfigs(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const client = tableService.getClient("SystemConfig");
    const entities = client.listEntities<SystemConfigEntity>();
    
    const configs: SystemConfigEntity[] = [];
    for await (const entity of entities) {
      configs.push(entity);
    }
    
    return {
      status: 200,
      jsonBody: configs,
    };
  } catch (error) {
    context.error("[getConfigs] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * GET /api/config/{key} - 特定設定取得
 */
async function getConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const key = req.params.key;
    const client = tableService.getClient("SystemConfig");
    
    const entity = await client.getEntity<SystemConfigEntity>("config", key);
    
    return {
      status: 200,
      jsonBody: entity,
    };
  } catch (error) {
    context.error("[getConfig] Error:", error);
    return {
      status: error.statusCode === 404 ? 404 : error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * POST /api/config - 設定作成
 */
async function createConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const body = await req.json() as Partial<SystemConfigEntity>;
    const client = tableService.getClient("SystemConfig");
    
    const entity: SystemConfigEntity = {
      partitionKey: "config",
      rowKey: body.rowKey!,
      value: body.value!,
      description: body.description,
      updatedBy: userInfo.email,
      updatedAt: new Date(),
    };
    
    await client.createEntity(entity);
    
    return {
      status: 201,
      jsonBody: entity,
    };
  } catch (error) {
    context.error("[createConfig] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * PUT /api/config/{key} - 設定更新
 */
async function updateConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const key = req.params.key;
    const body = await req.json() as Partial<SystemConfigEntity>;
    const client = tableService.getClient("SystemConfig");
    
    const existing = await client.getEntity<SystemConfigEntity>("config", key);
    
    const updated: SystemConfigEntity = {
      ...existing,
      value: body.value ?? existing.value,
      description: body.description ?? existing.description,
      updatedBy: userInfo.email,
      updatedAt: new Date(),
    };
    
    await client.updateEntity(updated, "Merge");
    
    return {
      status: 200,
      jsonBody: updated,
    };
  } catch (error) {
    context.error("[updateConfig] Error:", error);
    return {
      status: error.statusCode === 404 ? 404 : error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * DELETE /api/config/{key} - 設定削除
 */
async function deleteConfig(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const key = req.params.key;
    const client = tableService.getClient("SystemConfig");
    
    await client.deleteEntity("config", key);
    
    return {
      status: 204,
    };
  } catch (error) {
    context.error("[deleteConfig] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

// Routes
app.http("getConfigs", {
  methods: ["GET"],
  authLevel: "function",
  route: "config",
  handler: getConfigs,
});

app.http("getConfig", {
  methods: ["GET"],
  authLevel: "function",
  route: "config/{key}",
  handler: getConfig,
});

app.http("createConfig", {
  methods: ["POST"],
  authLevel: "function",
  route: "config",
  handler: createConfig,
});

app.http("updateConfig", {
  methods: ["PUT"],
  authLevel: "function",
  route: "config/{key}",
  handler: updateConfig,
});

app.http("deleteConfig", {
  methods: ["DELETE"],
  authLevel: "function",
  route: "config/{key}",
  handler: deleteConfig,
});

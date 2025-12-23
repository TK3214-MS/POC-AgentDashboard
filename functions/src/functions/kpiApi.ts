import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableStorageService, KpiDefinitionEntity } from "../shared/tableStorage";
import { validateAdminAccess } from "../shared/auth";
import { randomUUID } from "crypto";

const tableService = new TableStorageService();

/**
 * GET /api/kpi - 全KPI定義取得
 */
async function getKpis(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const client = tableService.getClient("KpiDefinition");
    const entities = client.listEntities<KpiDefinitionEntity>();
    
    const kpis: KpiDefinitionEntity[] = [];
    for await (const entity of entities) {
      kpis.push(entity);
    }
    
    return {
      status: 200,
      jsonBody: kpis,
    };
  } catch (error) {
    context.error("[getKpis] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * GET /api/kpi/{id} - 特定KPI定義取得
 */
async function getKpi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const id = req.params.id;
    const client = tableService.getClient("KpiDefinition");
    
    const entity = await client.getEntity<KpiDefinitionEntity>("kpi", id);
    
    return {
      status: 200,
      jsonBody: entity,
    };
  } catch (error) {
    context.error("[getKpi] Error:", error);
    return {
      status: error.statusCode === 404 ? 404 : error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * POST /api/kpi - KPI定義作成
 */
async function createKpi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const body = await req.json() as Partial<KpiDefinitionEntity>;
    const client = tableService.getClient("KpiDefinition");
    
    const entity: KpiDefinitionEntity = {
      partitionKey: "kpi",
      rowKey: randomUUID(),
      name: body.name!,
      description: body.description,
      timePerExecution: body.timePerExecution!,
      costPerHour: body.costPerHour!,
      category: body.category,
      isActive: body.isActive ?? true,
      createdBy: userInfo.email,
      createdAt: new Date(),
      updatedBy: userInfo.email,
      updatedAt: new Date(),
    };
    
    await client.createEntity(entity);
    
    return {
      status: 201,
      jsonBody: entity,
    };
  } catch (error) {
    context.error("[createKpi] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * PUT /api/kpi/{id} - KPI定義更新
 */
async function updateKpi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const id = req.params.id;
    const body = await req.json() as Partial<KpiDefinitionEntity>;
    const client = tableService.getClient("KpiDefinition");
    
    const existing = await client.getEntity<KpiDefinitionEntity>("kpi", id);
    
    const updated: KpiDefinitionEntity = {
      ...existing,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      timePerExecution: body.timePerExecution ?? existing.timePerExecution,
      costPerHour: body.costPerHour ?? existing.costPerHour,
      category: body.category ?? existing.category,
      isActive: body.isActive ?? existing.isActive,
      updatedBy: userInfo.email,
      updatedAt: new Date(),
    };
    
    await client.updateEntity(updated, "Merge");
    
    return {
      status: 200,
      jsonBody: updated,
    };
  } catch (error) {
    context.error("[updateKpi] Error:", error);
    return {
      status: error.statusCode === 404 ? 404 : error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * DELETE /api/kpi/{id} - KPI定義削除
 */
async function deleteKpi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const id = req.params.id;
    const client = tableService.getClient("KpiDefinition");
    
    await client.deleteEntity("kpi", id);
    
    return {
      status: 204,
    };
  } catch (error) {
    context.error("[deleteKpi] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

// Routes
app.http("getKpis", {
  methods: ["GET"],
  authLevel: "function",
  route: "kpi",
  handler: getKpis,
});

app.http("getKpi", {
  methods: ["GET"],
  authLevel: "function",
  route: "kpi/{id}",
  handler: getKpi,
});

app.http("createKpi", {
  methods: ["POST"],
  authLevel: "function",
  route: "kpi",
  handler: createKpi,
});

app.http("updateKpi", {
  methods: ["PUT"],
  authLevel: "function",
  route: "kpi/{id}",
  handler: updateKpi,
});

app.http("deleteKpi", {
  methods: ["DELETE"],
  authLevel: "function",
  route: "kpi/{id}",
  handler: deleteKpi,
});

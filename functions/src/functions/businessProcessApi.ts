import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { TableStorageService, BusinessProcessEntity } from "../shared/tableStorage";
import { validateAdminAccess } from "../shared/auth";
import { randomUUID } from "crypto";

const tableService = new TableStorageService();

/**
 * GET /api/business-process - 全業務プロセス取得
 */
async function getBusinessProcesses(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const client = tableService.getClient("BusinessProcess");
    const entities = client.listEntities<BusinessProcessEntity>();
    
    const processes: BusinessProcessEntity[] = [];
    for await (const entity of entities) {
      processes.push(entity);
    }
    
    return {
      status: 200,
      jsonBody: processes,
    };
  } catch (error) {
    context.error("[getBusinessProcesses] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * GET /api/business-process/kpi/{kpiId} - 特定KPIの業務プロセス取得
 */
async function getBusinessProcessesByKpi(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const kpiId = req.params.kpiId;
    const client = tableService.getClient("BusinessProcess");
    
    const entities = client.listEntities<BusinessProcessEntity>({
      queryOptions: { filter: `PartitionKey eq '${kpiId}'` }
    });
    
    const processes: BusinessProcessEntity[] = [];
    for await (const entity of entities) {
      processes.push(entity);
    }
    
    return {
      status: 200,
      jsonBody: processes,
    };
  } catch (error) {
    context.error("[getBusinessProcessesByKpi] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * POST /api/business-process - 業務プロセス作成
 */
async function createBusinessProcess(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const body = await req.json() as Partial<BusinessProcessEntity>;
    const client = tableService.getClient("BusinessProcess");
    
    const entity: BusinessProcessEntity = {
      partitionKey: body.partitionKey!, // KPI ID
      rowKey: randomUUID(),
      agentName: body.agentName!,
      usageCount: body.usageCount ?? 0,
      totalAssistedHours: body.totalAssistedHours ?? 0,
      totalCostSavings: body.totalCostSavings ?? 0,
      roi: body.roi ?? 0,
      startDate: body.startDate ?? new Date(),
      endDate: body.endDate,
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
    context.error("[createBusinessProcess] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * PUT /api/business-process/{kpiId}/{processId} - 業務プロセス更新
 */
async function updateBusinessProcess(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    const userInfo = await validateAdminAccess(req);
    
    const { kpiId, processId } = req.params;
    const body = await req.json() as Partial<BusinessProcessEntity>;
    const client = tableService.getClient("BusinessProcess");
    
    const existing = await client.getEntity<BusinessProcessEntity>(kpiId, processId);
    
    const updated: BusinessProcessEntity = {
      ...existing,
      agentName: body.agentName ?? existing.agentName,
      usageCount: body.usageCount ?? existing.usageCount,
      totalAssistedHours: body.totalAssistedHours ?? existing.totalAssistedHours,
      totalCostSavings: body.totalCostSavings ?? existing.totalCostSavings,
      roi: body.roi ?? existing.roi,
      startDate: body.startDate ?? existing.startDate,
      endDate: body.endDate ?? existing.endDate,
      updatedBy: userInfo.email,
      updatedAt: new Date(),
    };
    
    await client.updateEntity(updated, "Merge");
    
    return {
      status: 200,
      jsonBody: updated,
    };
  } catch (error) {
    context.error("[updateBusinessProcess] Error:", error);
    return {
      status: error.statusCode === 404 ? 404 : error.message === "Unauthorized" ? 403 : 400,
      jsonBody: { error: error.message },
    };
  }
}

/**
 * DELETE /api/business-process/{kpiId}/{processId} - 業務プロセス削除
 */
async function deleteBusinessProcess(req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    await validateAdminAccess(req);
    
    const { kpiId, processId } = req.params;
    const client = tableService.getClient("BusinessProcess");
    
    await client.deleteEntity(kpiId, processId);
    
    return {
      status: 204,
    };
  } catch (error) {
    context.error("[deleteBusinessProcess] Error:", error);
    return {
      status: error.message === "Unauthorized" ? 403 : 500,
      jsonBody: { error: error.message },
    };
  }
}

// Routes
app.http("getBusinessProcesses", {
  methods: ["GET"],
  authLevel: "function",
  route: "business-process",
  handler: getBusinessProcesses,
});

app.http("getBusinessProcessesByKpi", {
  methods: ["GET"],
  authLevel: "function",
  route: "business-process/kpi/{kpiId}",
  handler: getBusinessProcessesByKpi,
});

app.http("createBusinessProcess", {
  methods: ["POST"],
  authLevel: "function",
  route: "business-process",
  handler: createBusinessProcess,
});

app.http("updateBusinessProcess", {
  methods: ["PUT"],
  authLevel: "function",
  route: "business-process/{kpiId}/{processId}",
  handler: updateBusinessProcess,
});

app.http("deleteBusinessProcess", {
  methods: ["DELETE"],
  authLevel: "function",
  route: "business-process/{kpiId}/{processId}",
  handler: deleteBusinessProcess,
});

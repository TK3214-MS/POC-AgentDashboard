# Testing Strategy and Operations Runbook

[日本語](testing-and-runbook.md) | **English**

## 1. Testing Strategy

### 1.1 Unit Testing

#### Azure Functions
**Target**: `src/shared/utils.ts`, `src/collectors/*.ts`

**Tools**: Jest or Mocha

**Test Case Examples**:
```typescript
// hashActor test
test('hashActor should return consistent SHA-256 hash', async () => {
  process.env.HASH_SALT = 'test-salt';
  const hash1 = await hashActor('user@contoso.com');
  const hash2 = await hashActor('USER@contoso.com');
  expect(hash1).toBe(hash2); // Normalize case
  expect(hash1).toHaveLength(64); // SHA-256 = 64 chars
});

// retryWithBackoff test
test('retryWithBackoff should retry on failure', async () => {
  let attempts = 0;
  const fn = async () => {
    attempts++;
    if (attempts < 3) throw new Error('Retry');
    return 'success';
  };
  const result = await retryWithBackoff(fn, 3, 10);
  expect(result).toBe('success');
  expect(attempts).toBe(3);
});
```

#### Fabric Notebooks (PySpark)
**Target**: Schema transformation logic

**Tools**: pytest + PySpark test fixtures

**Test Case Examples**:
```python
def test_bronze_to_silver_schema():
    # Create mock DataFrame
    data = [{"id": "1", "prompt": "test" * 200, "actorId": "hash123"}]
    df = spark.createDataFrame(data)
    
    # Test 512-char trim
    result = df.withColumn("prompt_redacted", F.substring("prompt", 1, 512))
    assert len(result.first().prompt_redacted) == 512
```

### 1.2 Integration Testing

#### Functions → Storage Write
**Scenario**: Write Graph API mock data to Storage, read from Fabric via Shortcut.

**Steps**:
1. Mock Graph API with Wiremock (including paging)
2. Run Functions locally
3. Verify file exists in `raw/graph_interactions/` via Storage Explorer
4. Test Shortcut read in Fabric Notebook

#### Bronze → Silver → Gold Pipeline
**Scenario**: Execute full pipeline with 1 week of mock data.

**Steps**:
1. Place 7 days of mock JSON in Storage
2. Manually execute Fabric Pipeline
3. Verify Silver/Gold table counts and schemas
4. Test visualization in Power BI

### 1.3 Load Testing

#### Graph API Paging
**Goal**: Collect 10,000 events in 1 day (100 items/page × 100 pages)

**Tools**: Azure Load Testing or K6

**Scenario**:
- 100 consecutive requests to Graph API
- Verify exponential backoff on rate limit (429)
- Verify all pages eventually fetched

#### Fabric Notebook Processing Time
**Goal**: Transform 10,000 events to Silver within 5 minutes

**Steps**:
1. Place 10,000 mock data items in Storage
2. Execute `bronze_to_silver` Notebook
3. Verify processing time and partition distribution in Spark UI

---

## 2. Operations Runbook

### 2.1 Daily Operations

#### Tasks
1. **03:00 JST**: Collect Graph Interactions via Functions
2. **03:30 JST**: Collect Licensed Users via Functions
3. **04:00 JST**: Bronze → Silver transformation in Fabric Pipeline
4. **05:00 JST**: TTL cleanup in Fabric Pipeline

#### Verification Items
- Verify Functions execution success in Application Insights
- Verify files exist in Storage `raw/graph_interactions/date=YYYY-MM-DD/`
- Verify success in Fabric Pipeline execution logs
- Verify Silver table row count increased

#### Failure Response
**Functions Failure (API Error)**:
1. Check error logs in Application Insights
2. Check Graph API rate limit (429) → Manual re-execution after 30 minutes
3. Authentication error (401) → Verify Managed Identity permissions

**Fabric Pipeline Failure**:
1. Check error in Pipeline execution logs
2. Shortcut connection error → Verify Storage RBAC permissions
3. Schema error → Verify raw data sample, fix Notebook

### 2.2 Weekly Operations

#### Tasks
1. **Monday 07:00 JST**: Scenario extraction in Fabric Pipeline (Azure OpenAI)
2. **Monday 08:00 JST**: Weekly Gold aggregation in Fabric Pipeline
3. **Monday 09:00 JST**: Power BI dataset refresh

#### Verification Items
- Azure OpenAI API call success
- New scenarios added to `scenario_label` in Gold table
- Latest data displayed in Power BI report

#### Failure Response
**Azure OpenAI Error (429, Quota Exceeded)**:
1. Check OpenAI quota in Azure Portal
2. Reduce batch size (1000 → 500 items)
3. Consider Premium Tier upgrade

**Power BI Refresh Failure**:
1. Power BI Service → Dataset Settings → Check Refresh history
2. Fabric Lakehouse connection error → Verify Workspace Region
3. RLS error → Verify Entra SG membership

### 2.3 Re-execution Procedures

#### Functions Re-execution (Specific Date)
```bash
# Azure Portal → Function App → Functions → ingestGraphInteractions → Code + Test
# JSON Body with date specification
{
  "start": "2025-01-15T00:00:00Z",
  "end": "2025-01-16T00:00:00Z"
}
```

Or PowerShell:
```powershell
$body = @{
  start = "2025-01-15T00:00:00Z"
  end = "2025-01-16T00:00:00Z"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "https://<func-app>.azurewebsites.net/api/ingestGraphInteractions" -Body $body -ContentType "application/json"
```

#### Fabric Notebook Re-execution
1. Fabric Workspace → Lakehouse → Notebooks
2. Open `bronze_to_silver` → Run all
3. Auto re-execution in Pipeline: Pipeline → Run with parameters → Specify date range

### 2.4 Data Quality Monitoring

#### Metrics
- **Daily**:
  - Graph Interactions count (within ±20% of previous day)
  - Licensed Users count (within ±5% of previous day)
  - Silver table `org_unit = "unknown"` ratio (<10%)
  - Silver table `outcome = "error"` ratio (<5%)

- **Weekly**:
  - Gold table `scenario_label = "Other"` ratio (<20%)
  - Assisted hours spike/drop (within ±30% of previous week)

#### Alert Configuration
Configure following alerts in Application Insights:
```kusto
// Functions failure rate exceeds 10%
requests
| where success == false
| summarize FailureRate = count() * 100.0 / toscalar(requests | count())
| where FailureRate > 10
```

```kusto
// Graph API rate limit (429) frequent
dependencies
| where resultCode == 429
| summarize Count = count() by bin(timestamp, 1h)
| where Count > 5
```

### 2.5 Audit Case Operations

#### Case Snippet Registration
**Trigger**: Support inquiry, compliance audit

**Steps**:
1. Fabric Workspace → Secure Notebook (admin only)
2. Manual INSERT into `case_snippet`:
   ```python
   from pyspark.sql import Row
   
   snippet = Row(
       case_id="CASE-2025-001",
       actor_id="<hashed-id>",
       turn_index=0,
       snippet="Summary: User requested contract review...",
       event_id="evt-123",
       created_at="2025-01-15T10:00:00Z",
       created_by="admin@contoso.com"
   )
   
   df = spark.createDataFrame([snippet])
   df.write.mode("append").format("delta").saveAsTable("secure.case_snippet")
   ```

3. Enforce max 5 turns/512 chars:
   ```python
   # Validation
   if len(snippet.snippet) > 512:
       raise ValueError("Snippet exceeds 512 chars")
   if snippet.turn_index > 4:
       raise ValueError("Max 5 turns per case")
   ```

#### Access Control
- `secure.case_snippet` referenced only in Power BI Admin model
- Viewable only by Entra SG `PBI-Copilot-Admin` members

---

## 3. Troubleshooting

### 3.1 Common Issues

| Issue | Cause | Response |
|-------|-------|----------|
| Functions won't start | MI Graph permissions not granted | Grant permissions per `infra/README.md` steps |
| Shortcut empty | Deleted by Storage Lifecycle | Verify data within TTL 14 days |
| Azure OpenAI timeout | Excessive API calls | Reduce batch size, adjust retry interval |
| org_unit not displayed in Power BI | extensionAttribute10 not set | Verify user attributes in Entra |
| RLS not working | Entra SG membership not reflected | Reassign role in Power BI Service |

### 3.2 Escalation Flow
1. **L1**: Check Application Insights logs → Handle known issues per Runbook
2. **L2**: Check resource status in Azure Portal → Fix configuration errors
3. **L3**: Escalate to Microsoft Support (Graph API, Fabric, Power BI)

---

## 4. Change Management

### 4.1 Adding Taxonomy
1. Add to `TAXONOMY` list in `fabric/notebooks/scenario_extract.py`
2. Add new weight to `fabric/notebooks/seed_dim_scenario_weight.py`
3. Re-execute Notebook → Reflect in weekly pipeline

### 4.2 Changing Assisted Hours Weight
1. Edit `assisted_hours_weight` in `Dim_Scenario` table in Power BI Desktop
2. Or direct UPDATE in Fabric Notebook:
   ```python
   spark.sql("""
   UPDATE gold.dim_scenario_weight
   SET assisted_hours_weight = 0.50
   WHERE scenario_label = 'Email Summary'
   """)
   ```
3. Auto-reflect in weekly aggregation

### 4.3 Schema Changes
1. Update DDL in `docs/lakehouse-design.md`
2. `ALTER TABLE` or `CREATE TABLE` in Fabric Notebook (add new column)
3. Refresh Power BI model

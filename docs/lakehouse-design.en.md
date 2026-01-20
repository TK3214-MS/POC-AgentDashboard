# Lakehouse Design

[日本語](lakehouse-design.md) | **English**

## 1. Folder Structure (Storage Account: Japan East)

### 1.1 Azure Storage `raw` Container
```
raw/
├─ graph_interactions/
│  ├─ date=2025-01-15/
│  │  ├─ page_000.json
│  │  ├─ page_001.json
│  │  └─ ...
│  └─ date=2025-01-16/
│     └─ ...
├─ users/
│  ├─ date=2025-01-15/
│  │  └─ licensed_users.json
│  └─ ...
├─ copilot_studio_transcript/
│  ├─ date=2025-01-15/
│  │  ├─ session_001.csv
│  │  └─ ...
│  └─ ...
└─ o365_audit/
   ├─ date=2025-01-15/
   │  ├─ content_001.json
   │  └─ ...
   └─ ...
```

**TTL**: Auto-delete after 14 days via Storage Lifecycle Management (per date partition).

### 1.2 Fabric Lakehouse `copilot_analytics_lh`
```
copilot_analytics_lh/
├─ Files/
│  └─ shortcuts/
│     └─ raw/ → [Shortcut to Azure Storage raw container]
├─ Tables/
│  ├─ bronze/
│  │  ├─ graph_ai_interaction_raw
│  │  ├─ cs_transcript_raw
│  │  ├─ cs_session_raw
│  │  └─ o365_audit_raw
│  ├─ silver/
│  │  ├─ ai_interaction_event
│  │  ├─ cs_session_event
│  │  └─ audit_event
│  ├─ gold/
│  │  ├─ ai_scenario_fact
│  │  └─ dim_scenario_weight
│  └─ secure/
│     ├─ dim_user_private
│     └─ case_snippet
```

## 2. Shortcut Design

### 2.1 Shortcut Creation Steps
1. Fabric Workspace → Create Lakehouse `copilot_analytics_lh`
2. Files → New shortcut → Azure Data Lake Storage Gen2
3. Connection info:
   - URL: `https://<storage-account>.dfs.core.windows.net/<container>`
   - Authentication: Organizational account (Entra ID) or Service Principal
4. Shortcut name: `raw`
5. Path: `/` (container root)

### 2.2 Shortcut Benefits
- **Cost reduction**: No data copying, minimized storage usage.
- **Data residency**: Storage fixed to Japan East, Fabric Workspace created in same region.
- **Centralized TTL management**: Storage Lifecycle 14-day deletion configured, no additional Fabric processing needed (Notebook deletion also possible).

## 3. Canonical Schema (DDL)

### 3.1 silver.ai_interaction_event
Normalized events. Converts Graph and Copilot Studio to unified schema. No content or 512-char redacted.

```sql
CREATE TABLE silver.ai_interaction_event (
  event_id STRING NOT NULL COMMENT 'Event unique identifier',
  source STRING NOT NULL COMMENT 'Data source: graph|copilot_studio|audit',
  actor_id STRING NOT NULL COMMENT 'Hashed user identifier (SHA-256)',
  org_unit STRING COMMENT 'Department/team (extensionAttribute10)',
  timestamp TIMESTAMP NOT NULL COMMENT 'Event occurrence timestamp (UTC)',
  workload STRING COMMENT 'M365 app/Copilot feature (Teams, Word, Excel, etc.)',
  session_id STRING COMMENT 'Session identifier',
  prompt_redacted STRING COMMENT 'Prompt (max 512 chars, NULL otherwise)',
  response_redacted STRING COMMENT 'Response (max 512 chars, NULL otherwise)',
  duration_ms BIGINT COMMENT 'Processing time (milliseconds)',
  tokens_prompt INT COMMENT 'Prompt token count',
  tokens_completion INT COMMENT 'Response token count',
  outcome STRING COMMENT 'Result: success|fallback|aborted|error',
  quality_factor DOUBLE COMMENT 'Quality score (0.0-1.0)',
  license_sku STRING COMMENT 'Copilot SKU ID',
  scenario_hint STRING COMMENT 'Scenario hint (temporary label before LLM classification)',
  raw_ref STRING COMMENT 'Reference path to raw data (valid for 14 days only)',
  event_date DATE NOT NULL COMMENT 'Partition key (date)'
)
USING DELTA
PARTITIONED BY (event_date)
COMMENT 'Normalized events from M365 Copilot and Copilot Studio';
```

### 3.2 gold.ai_scenario_fact
LLM-classified scenario aggregation fact. For Assisted hours calculation.

```sql
CREATE TABLE gold.ai_scenario_fact (
  scenario_date DATE NOT NULL COMMENT 'Aggregation date',
  actor_id STRING NOT NULL COMMENT 'Hashed user identifier',
  org_unit STRING COMMENT 'Department/team',
  scenario_label STRING NOT NULL COMMENT 'Scenario label (taxonomy classification result)',
  intent_label STRING COMMENT 'Intent label (LLM inference)',
  confidence DOUBLE COMMENT 'LLM classification confidence (0.0-1.0)',
  evidence_event_ids ARRAY<STRING> COMMENT 'Evidence event IDs (max 5)',
  outcome STRING COMMENT 'Scenario result (success|fallback|aborted)',
  quality_factor DOUBLE COMMENT 'Scenario quality score average',
  assisted_hours DOUBLE COMMENT 'Assisted time (sessions × weight × quality_factor)',
  sessions INT COMMENT 'Session count',
  tokens_prompt INT COMMENT 'Total prompt tokens',
  tokens_completion INT COMMENT 'Total response tokens'
)
USING DELTA
PARTITIONED BY (scenario_date)
COMMENT 'Scenario aggregation fact (Assisted hours calculation)';
```

### 3.3 gold.dim_scenario_weight
Assisted hours coefficient master. Referenced by Power BI/DAX, modifiable later.

```sql
CREATE TABLE gold.dim_scenario_weight (
  scenario_label STRING NOT NULL COMMENT 'Scenario label (primary key)',
  assisted_hours_weight DOUBLE NOT NULL COMMENT 'Assisted time coefficient (hours)',
  effective_from DATE NOT NULL COMMENT 'Effective start date',
  effective_to DATE COMMENT 'Effective end date (NULL=currently effective)',
  description STRING COMMENT 'Scenario description'
)
USING DELTA
COMMENT 'Scenario-specific Assisted hours coefficients (PoC initial values, modifiable later)';
```

**Initial Data Example**:
```sql
INSERT INTO gold.dim_scenario_weight VALUES
  ('Email Summary', 0.25, '2025-01-01', NULL, 'Summarize email body and generate reply draft'),
  ('Meeting Notes', 0.35, '2025-01-01', NULL, 'Auto-generate Teams meeting minutes'),
  ('Presentation Creation', 0.60, '2025-01-01', NULL, 'Create PowerPoint slide outline'),
  ('Code Review', 0.80, '2025-01-01', NULL, 'GitHub Copilot code completion and review'),
  ('Data Extraction', 0.40, '2025-01-01', NULL, 'Extract data from Excel/PDF and generate tables');
```

### 3.4 secure.dim_user_private
actor_id ↔ UPN mapping table. Admin only.

```sql
CREATE TABLE secure.dim_user_private (
  actor_id STRING NOT NULL COMMENT 'Hashed user identifier (primary key)',
  upn STRING NOT NULL COMMENT 'UserPrincipalName (email address)',
  display_name STRING COMMENT 'Display name',
  org_unit STRING COMMENT 'Department/team (extensionAttribute10)',
  license_sku STRING COMMENT 'Copilot SKU ID',
  last_seen TIMESTAMP NOT NULL COMMENT 'Last update timestamp'
)
USING DELTA
COMMENT 'User personal information (admin only, Power BI Admin model reference only)';
```

### 3.5 secure.case_snippet
Exception excerpts. Case ID linkage for audit, quality improvement, support.

```sql
CREATE TABLE secure.case_snippet (
  case_id STRING NOT NULL COMMENT 'Case management ID',
  actor_id STRING NOT NULL COMMENT 'Hashed user identifier',
  turn_index INT NOT NULL COMMENT 'Turn number (0-4, max 5 turns)',
  snippet STRING NOT NULL COMMENT 'Excerpt text (max 512 chars)',
  event_id STRING COMMENT 'Source event ID',
  created_at TIMESTAMP NOT NULL COMMENT 'Registration timestamp',
  created_by STRING COMMENT 'Registrant UPN (admin)',
  CONSTRAINT pk_case_snippet PRIMARY KEY (case_id, turn_index)
)
USING DELTA
COMMENT 'Exception excerpts (audit/support, max 5 turns/512 chars)';
```

## 4. TTL Design

### 4.1 Storage Lifecycle Management (Recommended)
```json
{
  "rules": [
    {
      "name": "delete-raw-after-14days",
      "enabled": true,
      "type": "Lifecycle",
      "definition": {
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["raw/"]
        },
        "actions": {
          "baseBlob": {
            "delete": {
              "daysAfterModificationGreaterThan": 14
            }
          }
        }
      }
    }
  ]
}
```

### 4.2 Fabric Notebook Deletion (Backup)
Daily Notebook deletes old partitions as backup when Lifecycle not configured.

```python
from notebookutils import mssparkutils
from datetime import datetime, timedelta

TTL_DAYS = 14
RAW_BASE = "/lakehouse/default/Files/shortcuts/raw"
cutoff = datetime.utcnow().date() - timedelta(days=TTL_DAYS)

for source in ["graph_interactions", "users", "copilot_studio_transcript", "o365_audit"]:
  path = f"{RAW_BASE}/{source}"
  try:
    folders = mssparkutils.fs.ls(path)
    for f in folders:
      if f.name.startswith("date="):
        date_str = f.name.split("=")[1].strip("/")
        if datetime.strptime(date_str, "%Y-%m-%d").date() < cutoff:
          mssparkutils.fs.rm(f.path, True)
          print(f"Deleted: {f.path}")
  except Exception as e:
    print(f"Error: {source} - {e}")
```

## 5. Data Flow

### 5.1 Daily (Functions → Storage → Bronze → Silver)
1. **03:00 JST**: Functions Timer collects Graph Interaction Export and saves to `raw/graph_interactions/date=YYYY-MM-DD/`.
2. **03:30 JST**: Functions collects Entra users (Copilot license holders) and saves to `raw/users/date=YYYY-MM-DD/`.
3. **04:00 JST**: Fabric Pipeline executes Bronze → Silver transformation Notebook.
   - Read `raw` via Shortcut.
   - Hash actor_id, trim content to 512 chars (redacted).
   - MERGE into `silver.ai_interaction_event` (idempotent by event_id).
   - UPSERT into `secure.dim_user_private`.

### 5.2 Weekly (Silver → Gold → Power BI)
1. **Monday 07:00 JST**: Fabric Pipeline executes scenario extraction Notebook.
   - Read `silver.ai_interaction_event`.
   - Azure OpenAI taxonomy classification (LLM inference).
   - Write to `gold.ai_scenario_fact`.
2. **Monday 08:00 JST**: Fabric Pipeline executes weekly aggregation Notebook.
   - JOIN `gold.ai_scenario_fact` and `gold.dim_scenario_weight`.
   - Calculate `assisted_hours = sessions × weight × quality_factor`.
3. **Monday 09:00 JST**: Power BI dataset refresh (Public / Admin models).

---

**Next Steps**: Auto-deploy Storage/Key Vault/Functions via IaC (Bicep), proceed to Functions code implementation.

# Architecture Design

[日本語](architecture.md) | **English**

## 1. Overview

**Microsoft Fabric-centric + Minimal Azure Configuration** Copilot Analytics Platform. Normalizes M365 Copilot and Copilot Studio usage data into a unified schema, with weekly Power BI visualization.

```
[Data Sources]
├─ M365 Copilot (Graph Interaction Export API)
├─ Copilot Studio (Dataverse → Power Automate → Storage CSV)
└─ Purview Audit Logs (Office 365 Management Activity API)
         ↓
[Collection Layer: Azure Functions (Daily Timer)]
├─ Graph Interaction Collector
├─ Entra User Collector (Copilot license holders only)
└─ O365 Audit Collector (Optional)
         ↓
[Storage Layer: Azure Storage Account (Japan East)]
├─ raw container (14-day TTL)
│   ├─ graph_interactions/date=YYYY-MM-DD/*.json
│   ├─ users/date=YYYY-MM-DD/*.json
│   ├─ copilot_studio_transcript/date=YYYY-MM-DD/*.csv
│   └─ o365_audit/date=YYYY-MM-DD/*.json
         ↓ (Shortcut reference only, no copy)
[Transformation Layer: Microsoft Fabric Lakehouse]
├─ Bronze: raw Shortcut reference (14-day TTL, includes message content)
├─ Silver: Normalized events (no content, 512-char redacted only)
├─ Gold: Scenario aggregation (Assisted hours calculation)
└─ Secure: Personal identifiable information (UPN↔actor_id mapping, exception excerpts)
         ↓
[Visualization Layer: Power BI (Weekly refresh)]
├─ Public model: Department/team granularity only (no personal identification)
└─ Admin model: UPN visible (Entra SG RLS control)
```

## 2. Design Decision Rationale

### 2.1 Fabric-Centric Architecture
- **Reason**: OneLake provides unified data lake, Lakehouse implements Bronze/Silver/Gold medallion, Notebook handles PySpark transformations, Pipeline orchestrates centrally. Azure side limited to collection and secret management only, minimizing operational complexity.
- **Benefits**: Data governance (Purview integration), cost optimization (compute separation), development speed (low-code Notebook).

### 2.2 Minimal Azure Configuration (Storage + Key Vault + Functions)
- **Storage**: Raw data landing zone. Referenced via Fabric Shortcut without copying, achieving both data residency (Japan East fixed) and cost reduction.
- **Key Vault**: Secure management of salt (SHA-256 hash), API keys, SKU IDs. Referenced from Functions and Fabric via Managed Identity.
- **Functions**: Daily collection via Timer trigger. Implements paging, retry, and idempotency for Graph/O365 APIs, eliminating Fabric-side complexity.

### 2.3 Shortcut Method (No Copy)
- **Reason**: Fabric Lakehouse references Storage's `raw` container as Shortcut without copying data.
- **Benefits**: Storage cost reduction, data residency maintenance (Japan East), centralized TTL management (Storage Lifecycle Management).

### 2.4 Bronze TTL 14 Days
- **Reason**: Message content unnecessary for long-term retention except for audit/support. Auto-delete after 14 days (Storage Lifecycle or Fabric Notebook).
- **Benefits**: Privacy protection, storage cost reduction, GDPR/labor regulation compliance.

### 2.5 No Content in Silver/Gold
- **Reason**: Silver contains normalized events (no content or 512-char redacted), Gold contains aggregated data. actor_id is hashed, UPN only in secure area.
- **Benefits**: No personal identification in general user visualization, admin-only secure access for labor regulation compliance.

### 2.6 Dual Semantic Model (Public / Admin)
- **Public**: org_unit (department/team) granularity only. actor_id aggregated and excluded.
- **Admin**: actor_id ↔ UPN mapping (secure.dim_user_private) referenced. Entra Security Group RLS control.
- **Benefits**: General users cannot identify individuals, admins can view details for governance requirements.

### 2.7 Weekly Visualization / Daily Collection
- **Reason**: Weekly visualization sufficient for trend analysis. Daily collection ensures reliability and re-executability (minimizes re-fetch range on failure).
- **Benefits**: API rate limit avoidance, reduced operational overhead, balanced data freshness and stability.

## 3. Security Design

### 3.1 Data Anonymization
- **actor_id**: `SHA-256(SALT + UPN.toLowerCase())`. SALT managed in Key Vault.
- **org_unit**: Uses Entra `onPremisesExtensionAttributes.extensionAttribute10`.
- **UPN mapping**: Stored in secure.dim_user_private, accessible to admin role only.

### 3.2 Exception Excerpts (secure.case_snippet)
- **Purpose**: Case ID linkage for audit, quality improvement, support.
- **Constraints**: Max 5 turns/512 chars, anonymized, admin role only.

### 3.3 Access Control
- **Functions MI**: Graph `AiEnterpriseInteraction.Read.All` + `User.Read.All`, Key Vault Secrets User, Storage Blob Data Contributor.
- **Fabric Workspace**: Entra SG separation for Admin/Contributor/Viewer.
- **Power BI RLS**: Admin model controlled by Entra SG, Public model accessible to all.

## 4. Scalability and Extensibility

### 4.1 PoC → Production Migration
- **PoC**: Single Lakehouse, Consumption plan Functions, weekly refresh.
- **Production**: Lakehouse separation (raw/curated), Premium Functions (Durable), Direct Lake + Incremental Refresh.

### 4.2 Adding Data Sources
- **Plugin structure**: Source Adapter interface (`IIngestJob`) unifies Graph/Copilot Studio/O365. New sources implement same pattern.

### 4.3 Scenario Classification Improvement
- **Initial**: LLM (Azure OpenAI) classifies into 30-50 taxonomy categories.
- **Extension**: Clustering (UMAP + HDBSCAN) extracts new scenario candidates, continuously improves taxonomy.

## 5. Operations Design

### 5.1 Monitoring
- **Functions**: Application Insights tracks timer execution, API errors, retries.
- **Fabric**: Pipeline execution logs, data quality metrics (count/unique actors/empty org_unit) visualization.

### 5.2 Failure Response
- **Functions failure**: Manual re-execution with date range specification (idempotency guaranteed).
- **Silver MERGE failure**: event_id duplicate check, auto-retry.
- **TTL deletion failure**: Manual Notebook execution, Storage Lifecycle backup.

### 5.3 Data Quality
- **Validation**: Daily check of count/actor count/org_unit blank rate, alert on threshold exceeded.
- **Audit**: UI-based registration flow to secure.case_snippet (Fabric Notebook + Power Apps).

## 6. Cost Optimization

- **Storage**: LRS (Japan East), 14-day TTL minimization.
- **Functions**: Consumption plan (PoC), Premium (production, long-running support).
- **Fabric**: Capacity-based, optimized Notebook execution time (partition pruning).
- **Power BI**: Pro license (PoC), Premium Per User or Capacity (production).

---

**Next Steps**: Define Lakehouse design (folder structure, table schema, Shortcut configuration), enable automatic Azure resource deployment via IaC (Bicep).

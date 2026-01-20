# Power BI Semantic Model Design

[日本語](powerbi-design.md) | **English**

## Overview

Two semantic models meet labor/personal information requirements:
- **Public Model**: Department/team granularity only (no personal identification)
- **Admin Model**: UPN visible (Entra SG RLS control)

## 1. Public Model (General Users)

### Data Sources
- `gold.ai_scenario_fact` (actor_id aggregated and excluded)
- `gold.dim_scenario_weight` (weight reference)

### Table Structure

#### Fact_Scenario (Fact)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.ai_scenario_fact")
// Remove actor_id, group by org_unit
Transformed = Table.Group(Source, {"scenario_date", "org_unit", "scenario_label"}, {
  {"sessions", each List.Sum([sessions]), Int64.Type},
  {"assisted_hours", each List.Sum([assisted_hours]), type number},
  {"tokens_prompt", each List.Sum([tokens_prompt]), Int64.Type},
  {"tokens_completion", each List.Sum([tokens_completion]), Int64.Type}
})
```

#### Dim_OrgUnit (Department Dimension)
```dax
Distinct_OrgUnit = DISTINCT(Fact_Scenario[org_unit])
```

#### Dim_Scenario (Scenario Dimension)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.dim_scenario_weight")
```

#### Dim_Date (Date Dimension)
```dax
Dim_Date = CALENDAR(DATE(2025,1,1), DATE(2026,12,31))
```

### Measures

```dax
// Total Assisted Hours
Total_Assisted_Hours = SUM(Fact_Scenario[assisted_hours])

// Total Sessions
Total_Sessions = SUM(Fact_Scenario[sessions])

// Average Assisted Hours per Session
Avg_Hours_Per_Session = DIVIDE([Total_Assisted_Hours], [Total_Sessions], 0)

// YoY Assisted Hours
YoY_Assisted_Hours = 
VAR CurrentPeriod = [Total_Assisted_Hours]
VAR PreviousPeriod = CALCULATE([Total_Assisted_Hours], DATEADD(Dim_Date[Date], -1, YEAR))
RETURN DIVIDE(CurrentPeriod - PreviousPeriod, PreviousPeriod, 0)
```

### Example Report Pages

1. **Summary**
   - KPI cards: Total Assisted Hours, Total Sessions, Avg Hours/Session
   - Line chart: Weekly Assisted Hours trend
   - Pie chart: Session count by org_unit

2. **Scenario Analysis**
   - Table: scenario_label × org_unit × assisted_hours
   - Bar chart: Top 10 scenarios by assisted_hours
   - Treemap: org_unit × scenario_label

3. **Trend Analysis**
   - Line chart: Weekly assisted_hours (by scenario)
   - Area chart: Stacked by org_unit

### RLS Configuration
**Not Required** (Accessible to all users)

---

## 2. Admin Model (Administrators)

### Data Sources
- `gold.ai_scenario_fact` (includes actor_id)
- `gold.dim_scenario_weight`
- `secure.dim_user_private` (UPN mapping table)

### Table Structure

#### Fact_Scenario_Admin (Fact)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "gold.ai_scenario_fact")
// Keep actor_id
```

#### Dim_User_Private (User Dimension)
```dax
Source = Fabric.Lakehouse("copilot_analytics_lh", "secure.dim_user_private")
```

#### Dim_Scenario, Dim_Date
Same as Public model.

### Relationships

```
Fact_Scenario_Admin[actor_id] → Dim_User_Private[actor_id] (many-to-one)
Fact_Scenario_Admin[scenario_label] → Dim_Scenario[scenario_label] (many-to-one)
Fact_Scenario_Admin[scenario_date] → Dim_Date[Date] (many-to-one)
```

### Measures

Same as Public model + additional:

```dax
// Unique Users
Unique_Users = DISTINCTCOUNT(Fact_Scenario_Admin[actor_id])

// Sessions per User
Sessions_Per_User = DIVIDE([Total_Sessions], [Unique_Users], 0)
```

### Example Report Pages

1. **Summary** (Same as Public)
2. **User Details**
   - Table: upn × org_unit × scenario_label × assisted_hours × sessions
   - Scatter chart: sessions (X-axis) × assisted_hours (Y-axis), labeled by upn
3. **Drill-down**
   - actor_id selection → individual session details (evidence_event_ids display)

### RLS Configuration (Important)

**Role Name**: `CopilotAdminRole`

**DAX Filter** (Dim_User_Private):
```dax
[upn] IN { 
  // Dynamic retrieval of Entra SG member UPNs (requires Power BI Premium)
  // Simplified: static list substitute
  "admin1@contoso.com", 
  "admin2@contoso.com" 
}
```

**Production Recommendation**: Entra Security Group Integration
1. Power BI Service → Workspace Settings → Security
2. Assign Entra SG `PBI-Copilot-Admin` to Admin role
3. RLS filter: Use `USERPRINCIPALNAME()`

```dax
[upn] = USERPRINCIPALNAME()
```

---

## 3. Deployment Steps

### 3.1 Create in Power BI Desktop
1. **Public Model**:
   - Fabric Lakehouse connection (Direct Lake recommended)
   - Create tables/measures
   - Create report
   - Save .pbix: `CopilotAnalytics_Public.pbix`

2. **Admin Model**:
   - Create similarly
   - Configure RLS (role: CopilotAdminRole)
   - Save .pbix: `CopilotAnalytics_Admin.pbix`

### 3.2 Publish to Power BI Service
1. Power BI Desktop → Publish → Select Fabric Workspace
2. Public model → Accessible to all
3. Admin model → Access restricted by RLS

### 3.3 Weekly Refresh Configuration
1. Power BI Service → Dataset Settings
2. Scheduled refresh: Every Monday 09:00 JST
3. Add `Refresh Power BI Dataset` Activity at end of Fabric Pipeline (recommended)

---

## 4. Best Practices

### 4.1 Direct Lake vs Import
- **Direct Lake**: Direct Fabric Lakehouse reference, high real-time performance (requires Premium)
- **Import**: Data copy, high performance, suitable for weekly refresh

### 4.2 Assisted Hours Recalculation
When weight changed in Power BI, recalculate with DAX measure:

```dax
Assisted_Hours_Recalc = 
SUMX(
  Fact_Scenario_Admin,
  Fact_Scenario_Admin[sessions] * 
  RELATED(Dim_Scenario[assisted_hours_weight]) * 
  Fact_Scenario_Admin[quality_factor]
)
```

### 4.3 Performance Optimization
- Index Fact table (scenario_date, scenario_label)
- Create aggregation tables (monthly aggregation, etc.)
- Reduce columns in Direct Lake (exclude unnecessary columns)

---

## 5. Troubleshooting

### RLS Not Working
- Power BI Service → Dataset Settings → Security → Verify Role assignment
- Verify `USERPRINCIPALNAME()` resolves correctly (Test: View as role)

### Fabric Lakehouse Connection Error
- Verify Workspace Region (Japan East recommended)
- Verify Lakehouse RBAC permissions (Power BI Service MI has Reader permission)

### Data Not Displaying
- Check Fabric Pipeline execution logs
- Verify Gold table has data (`SELECT COUNT(*) FROM gold.ai_scenario_fact`)

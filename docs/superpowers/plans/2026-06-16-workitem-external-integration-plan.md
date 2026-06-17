# Workitem External Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable external workitem platform integration (Meego first) with scheduled sync from external systems and asynchronous status writeback.

**Architecture:** Redesign `go-sdk` Tracker/Driver abstractions so a generic `HTTPTracker` executes platform-agnostic HTTP, while `MeegoDriver` handles request construction and response parsing. On the backend, a `SyncScheduler` pulls projects from the DB and upserts workitems; a `WritebackWorker` pushes local status changes back to the external platform. The frontend Settings page loads the platform whitelist from the backend and persists mapping JSON per workspace.

**Tech Stack:** Go 1.25, PostgreSQL (pgx), standard `net/http`, YAML config, React + TypeScript + Tailwind/shadcn.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `apps/dh-backend/config/config.go` | Add workitem global config fields and YAML loading. |
| `apps/dh-backend/config.yaml` | Add `workitem:` section. |
| `packages/go-sdk/infrastructure/workitem-tracker/tracker.go` | Redesigned `Tracker` and `Driver` interfaces plus config structs. |
| `packages/go-sdk/infrastructure/workitem-tracker/mapping.go` | Endpoint substitution, dot-path field extraction, value mapping helpers. |
| `packages/go-sdk/infrastructure/workitem-tracker/http_tracker.go` | Generic HTTP tracker: execute, retry, timeout, error wrapping. |
| `packages/go-sdk/infrastructure/workitem-tracker/meego_driver.go` | Meego request builder and response parser. |
| `infra/database/workitem/schema.sql` | Add `type`, `reporter`, and unique `(project_id, external_id)`. |
| `infra/database/workspace/schema.sql` | Add `last_sync_at`, `last_sync_status`, `last_sync_error` to `workitem_projects`. |
| `apps/dh-backend/domain/workitem/repository/repository.go` | `WorkItemRepository` interface and `Filter`. |
| `apps/dh-backend/domain/workitem/repository/db_repository.go` | PostgreSQL implementation. |
| `apps/dh-backend/domain/workitem/service/service.go` | Redefined `WorkItemService` using `repository.Filter`. |
| `apps/dh-backend/domain/workitem/service/service_mock.go` | Updated mock to use `repository.Filter`. |
| `apps/dh-backend/domain/workitem/service/db_service.go` | DB-backed service with writeback enqueue. |
| `apps/dh-backend/domain/workitem/service/writeback_worker.go` | Async writeback consumer with retry/backoff. |
| `apps/dh-backend/domain/workitem/service/sync_scheduler.go` | Periodic sync scheduler with worker pool. |
| `apps/dh-backend/domain/workitem/tracker/provider.go` | Loads workspace project config and builds a `Tracker`. |
| `apps/dh-backend/domain/workspace/service/service.go` | Add `Config any` to `WorkitemProjectRequest`. |
| `apps/dh-backend/domain/workspace/service/db_service.go` | Persist/return `config` JSONB. |
| `apps/dh-backend/domain/workspace/service/service_mock.go` | Store config in mock. |
| `apps/dh-backend/domain/workitem/handler.go` | `Init` with config, add `Platforms` handler. |
| `apps/dh-backend/gateway/server/server.go` | Wire repository, provider, worker, scheduler, routes. |
| `apps/web/src/lib/workspace-api.ts` | Add `getWorkitemPlatforms`. |
| `apps/web/src/pages/Settings.tsx` | Dynamic platform list + mapping JSON editor. |
| `packages/go-sdk/infrastructure/workitem-tracker/mapping_test.go` | Unit tests for mapping helpers. |
| `packages/go-sdk/infrastructure/workitem-tracker/http_tracker_test.go` | `HTTPTracker` + `MeegoDriver` integration tests. |

---

### Task 1: Add workitem global config structs and `config.yaml`

**Files:**
- Modify: `apps/dh-backend/config/config.go`
- Modify: `apps/dh-backend/config.yaml`

- [x] **Step 1: Add defaults and config fields to `config.go`**

Add the new constants after the existing `DEFAULT_REPOSITORY_ROOT` constant:

```go
	// Workitem external integration defaults
	DEFAULT_WORKITEM_SYNC_INTERVAL     = 5 * time.Minute
	DEFAULT_WORKITEM_SYNC_WORKERS      = 4
	DEFAULT_WORKITEM_SYNC_TIMEOUT      = 30 * time.Second
	DEFAULT_WORKITEM_WRITEBACK_ENABLED = true
	DEFAULT_WORKITEM_WRITEBACK_WORKERS = 2
	DEFAULT_WORKITEM_WRITEBACK_RETRY   = 3
```

Add the new fields to the `Config` struct after `AgentRequestTimeout`:

```go
	// Workitem external integration
	WorkitemPlatformWhitelist []string
	WorkitemSyncInterval      time.Duration
	WorkitemSyncWorkers       int
	WorkitemSyncTimeout       time.Duration
	WorkitemWritebackEnabled  bool
	WorkitemWritebackWorkers  int
	WorkitemWritebackRetry    int
```

Add the YAML struct after the `Repository` field in `yamlConfig`:

```go
	Workitem struct {
		Platforms []string `yaml:"platforms"`
		Sync      struct {
			Interval string `yaml:"interval"`
			Workers  int    `yaml:"workers"`
			Timeout  string `yaml:"timeout"`
		} `yaml:"sync"`
		Writeback struct {
			Enabled bool `yaml:"enabled"`
			Workers int  `yaml:"workers"`
			Retry   int  `yaml:"retry"`
		} `yaml:"writeback"`
	} `yaml:"workitem"`
```

Set defaults in `Load()` after `AgentRequestTimeout`:

```go
		WorkitemSyncInterval:     DEFAULT_WORKITEM_SYNC_INTERVAL,
		WorkitemSyncWorkers:      DEFAULT_WORKITEM_SYNC_WORKERS,
		WorkitemSyncTimeout:      DEFAULT_WORKITEM_SYNC_TIMEOUT,
		WorkitemWritebackEnabled: DEFAULT_WORKITEM_WRITEBACK_ENABLED,
		WorkitemWritebackWorkers: DEFAULT_WORKITEM_WRITEBACK_WORKERS,
		WorkitemWritebackRetry:   DEFAULT_WORKITEM_WRITEBACK_RETRY,
```

Add YAML loading in `loadFromYAML()` after the repository block:

```go
	if len(yc.Workitem.Platforms) > 0 {
		cfg.WorkitemPlatformWhitelist = yc.Workitem.Platforms
	}
	if yc.Workitem.Sync.Interval != "" {
		cfg.WorkitemSyncInterval = parseDurationOrDefault(yc.Workitem.Sync.Interval, cfg.WorkitemSyncInterval)
	}
	if yc.Workitem.Sync.Workers > 0 {
		cfg.WorkitemSyncWorkers = yc.Workitem.Sync.Workers
	}
	if yc.Workitem.Sync.Timeout != "" {
		cfg.WorkitemSyncTimeout = parseDurationOrDefault(yc.Workitem.Sync.Timeout, cfg.WorkitemSyncTimeout)
	}
	cfg.WorkitemWritebackEnabled = yc.Workitem.Writeback.Enabled
	if yc.Workitem.Writeback.Workers > 0 {
		cfg.WorkitemWritebackWorkers = yc.Workitem.Writeback.Workers
	}
	if yc.Workitem.Writeback.Retry > 0 {
		cfg.WorkitemWritebackRetry = yc.Workitem.Writeback.Retry
	}
```

- [x] **Step 2: Add `workitem` section to `config.yaml`**

Append at the end of `apps/dh-backend/config.yaml`:

```yaml
workitem:
  platforms:
    - meego
    - jira
  sync:
    interval: "5m"
    workers: 4
    timeout: "30s"
  writeback:
    enabled: true
    workers: 2
    retry: 3
```

- [x] **Step 3: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./config/...
```

Expected: no output (0 warnings).

- [x] **Step 4: Commit**

```bash
git add apps/dh-backend/config/config.go apps/dh-backend/config.yaml
git commit -m "feat(workitem): add external integration global config"
```

---

### Task 2: Redesign Tracker/Driver interfaces in `go-sdk`

**Files:**
- Modify: `packages/go-sdk/infrastructure/workitem-tracker/tracker.go`

- [x] **Step 1: Replace the entire file with the new design**

```go
package workitemtracker

import (
	"context"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// Tracker is the service-layer entry point for external workitem platforms.
type Tracker interface {
	List(ctx context.Context, projectKey string) ([]workitem.WorkItem, error)
	Get(ctx context.Context, externalID string) (*workitem.WorkItem, error)
	UpdateStatus(ctx context.Context, externalID string, status workitem.Status) error
}

// Driver implements platform-specific request construction and response parsing.
type Driver interface {
	Platform() string
	BuildListRequest(ctx context.Context, cfg DriverConfig, projectKey string) (*http.Request, error)
	ParseListResponse(body []byte, mapping MappingConfig) ([]workitem.WorkItem, error)
	BuildUpdateStatusRequest(ctx context.Context, cfg DriverConfig, externalID string, status workitem.Status, mapping MappingConfig) (*http.Request, error)
	ParseUpdateStatusResponse(body []byte) error
}

// AuthConfig holds platform authentication details (initially bearer token only).
type AuthConfig struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// APIConfig holds base URL and auth for a platform instance.
type APIConfig struct {
	BaseURL string     `json:"baseURL"`
	Auth    AuthConfig `json:"auth"`
}

// EndpointConfig holds endpoint templates supporting {projectKey} and {externalID}.
type EndpointConfig struct {
	List         string `json:"list"`
	Get          string `json:"get"`
	UpdateStatus string `json:"updateStatus"`
}

// DriverConfig is the resolved platform configuration passed to a Driver.
type DriverConfig struct {
	Platform   string
	ProjectKey string
	BaseURL    string
	Auth       AuthConfig
	Endpoints  EndpointConfig
}

// MappingConfig defines how external fields/values map to the domain model.
type MappingConfig struct {
	FieldMapping    map[string]string
	StatusMapping   map[string]string
	PriorityMapping map[string]string
}
```

- [x] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go vet ./infrastructure/workitem-tracker/...
```

Expected: no output.

- [x] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/tracker.go
git commit -m "feat(workitem): redesign Tracker and Driver interfaces"
```

---

### Task 3: Add mapping helpers

**Files:**
- Create: `packages/go-sdk/infrastructure/workitem-tracker/mapping.go`

- [x] **Step 1: Create mapping helpers**

```go
package workitemtracker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// substituteEndpoint replaces {key} placeholders in endpoint templates.
func substituteEndpoint(tpl string, vars map[string]string) string {
	if tpl == "" {
		return ""
	}
	for k, v := range vars {
		tpl = strings.ReplaceAll(tpl, "{"+k+"}", v)
	}
	return tpl
}

// setAuthHeader applies bearer-token auth when configured.
func setAuthHeader(req *http.Request, auth AuthConfig) {
	if auth.Type == "bearer" && auth.Token != "" {
		req.Header.Set("Authorization", "Bearer "+auth.Token)
	}
}

// getFieldString extracts a dot-path value from a JSON-decoded object.
func getFieldString(data map[string]any, path string) string {
	if path == "" {
		return ""
	}
	parts := strings.Split(path, ".")
	cur := data
	for i, p := range parts {
		v, ok := cur[p]
		if !ok {
			return ""
		}
		if i == len(parts)-1 {
			switch s := v.(type) {
			case string:
				return s
			case float64:
				return strconv.FormatFloat(s, 'f', -1, 64)
			case int:
				return strconv.Itoa(s)
			case bool:
				return strconv.FormatBool(s)
			default:
				return fmt.Sprintf("%v", v)
			}
		}
		next, ok := v.(map[string]any)
		if !ok {
			return ""
		}
		cur = next
	}
	return ""
}

// mapValue translates a value using a mapping; returns the key if absent.
func mapValue(m map[string]string, key string) string {
	if m == nil {
		return key
	}
	if v, ok := m[key]; ok {
		return v
	}
	return key
}

// reverseMap inverts a map[external->internal] to map[internal->external].
func reverseMap(m map[string]string) map[string]string {
	r := make(map[string]string, len(m))
	for k, v := range m {
		r[v] = k
	}
	return r
}

// parseTimeString parses common timestamp formats into time.Time.
func parseTimeString(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

// tryUnmarshalArray attempts to decode a JSON array, falling back to {data: [...]}.
func tryUnmarshalArray(body []byte) ([]map[string]any, error) {
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err == nil {
		return rows, nil
	}
	var wrapper struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return nil, err
	}
	return wrapper.Data, nil
}
```

- [x] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go vet ./infrastructure/workitem-tracker/...
```

Expected: no output.

- [x] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/mapping.go
git commit -m "feat(workitem): add field/value mapping helpers"
```

---

### Task 4: Implement the generic `HTTPTracker`

**Files:**
- Create: `packages/go-sdk/infrastructure/workitem-tracker/http_tracker.go`

- [x] **Step 1: Create HTTPTracker**

```go
package workitemtracker

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

const httpTrackerRetries = 3

// HTTPTracker is a platform-agnostic Tracker that delegates request/response
// details to a Driver and handles HTTP execution, timeout, retry, and logging.
type HTTPTracker struct {
	client  *http.Client
	driver  Driver
	cfg     DriverConfig
	mapping MappingConfig
	timeout time.Duration
}

// NewHTTPTracker creates a Tracker backed by HTTP.
func NewHTTPTracker(client *http.Client, driver Driver, cfg DriverConfig, mapping MappingConfig, timeout time.Duration) *HTTPTracker {
	if client == nil {
		client = http.DefaultClient
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &HTTPTracker{
		client:  client,
		driver:  driver,
		cfg:     cfg,
		mapping: mapping,
		timeout: timeout,
	}
}

// List fetches workitems for a project key.
func (t *HTTPTracker) List(ctx context.Context, projectKey string) ([]workitem.WorkItem, error) {
	req, err := t.driver.BuildListRequest(ctx, t.cfg, projectKey)
	if err != nil {
		return nil, fmt.Errorf("build list request: %w", err)
	}
	body, err := t.doWithRetry(ctx, req)
	if err != nil {
		return nil, err
	}
	items, err := t.driver.ParseListResponse(body, t.mapping)
	if err != nil {
		return nil, fmt.Errorf("parse list response: %w", err)
	}
	return items, nil
}

// Get is not implemented by the generic HTTP tracker; List should be used.
func (t *HTTPTracker) Get(ctx context.Context, externalID string) (*workitem.WorkItem, error) {
	return nil, fmt.Errorf("Get not implemented by HTTPTracker; use List")
}

// UpdateStatus pushes a status change to the external platform.
func (t *HTTPTracker) UpdateStatus(ctx context.Context, externalID string, status workitem.Status) error {
	req, err := t.driver.BuildUpdateStatusRequest(ctx, t.cfg, externalID, status, t.mapping)
	if err != nil {
		return fmt.Errorf("build update status request: %w", err)
	}
	body, err := t.doWithRetry(ctx, req)
	if err != nil {
		return err
	}
	if err := t.driver.ParseUpdateStatusResponse(body); err != nil {
		return fmt.Errorf("parse update status response: %w", err)
	}
	return nil
}

func (t *HTTPTracker) doWithRetry(ctx context.Context, req *http.Request) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt <= httpTrackerRetries; attempt++ {
		body, err := t.doOnce(ctx, req)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if extErr, ok := err.(*ExternalError); ok && (extErr.Status == http.StatusUnauthorized || extErr.Status == http.StatusForbidden) {
			return nil, err
		}
		if attempt < httpTrackerRetries {
			log.Printf("[HTTPTracker] request failed (attempt %d): %v", attempt+1, err)
			time.Sleep(time.Duration(attempt+1) * time.Second)
		}
	}
	return nil, lastErr
}

func (t *HTTPTracker) doOnce(ctx context.Context, req *http.Request) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	req = req.WithContext(ctx)
	resp, err := t.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return nil, &ExternalError{Status: resp.StatusCode, Message: string(body)}
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("external api error: status=%d body=%s", resp.StatusCode, string(body))
	}
	return body, nil
}

// ExternalError surfaces fatal HTTP status codes (401/403) to callers.
type ExternalError struct {
	Status  int
	Message string
}

func (e *ExternalError) Error() string {
	return fmt.Sprintf("external error %d: %s", e.Status, e.Message)
}
```

- [x] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go vet ./infrastructure/workitem-tracker/...
```

Expected: no output.

- [x] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/http_tracker.go
git commit -m "feat(workitem): implement generic HTTPTracker core"
```

---

### Task 5: Implement the `MeegoDriver`

**Files:**
- Create: `packages/go-sdk/infrastructure/workitem-tracker/meego_driver.go`

- [ ] **Step 1: Create MeegoDriver**

```go
package workitemtracker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// MeegoDriver implements Driver for the Meego platform.
type MeegoDriver struct{}

// Platform returns the platform identifier.
func (MeegoDriver) Platform() string {
	return string(workitem.SourceMeego)
}

// BuildListRequest builds a GET request for the project issue list.
func (MeegoDriver) BuildListRequest(ctx context.Context, cfg DriverConfig, projectKey string) (*http.Request, error) {
	path := substituteEndpoint(cfg.Endpoints.List, map[string]string{"projectKey": projectKey})
	if path == "" {
		path = substituteEndpoint("/projects/{projectKey}/issues", map[string]string{"projectKey": projectKey})
	}
	u, err := url.JoinPath(cfg.BaseURL, path)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	setAuthHeader(req, cfg.Auth)
	return req, nil
}

// ParseListResponse converts Meego issue JSON into domain WorkItems.
func (MeegoDriver) ParseListResponse(body []byte, mapping MappingConfig) ([]workitem.WorkItem, error) {
	rows, err := tryUnmarshalArray(body)
	if err != nil {
		return nil, fmt.Errorf("unmarshal meego list response: %w", err)
	}
	items := make([]workitem.WorkItem, 0, len(rows))
	for _, raw := range rows {
		items = append(items, mapMeegoRawToWorkItem(raw, mapping))
	}
	return items, nil
}

// BuildUpdateStatusRequest builds a PATCH request to update issue status.
func (MeegoDriver) BuildUpdateStatusRequest(ctx context.Context, cfg DriverConfig, externalID string, status workitem.Status, mapping MappingConfig) (*http.Request, error) {
	path := substituteEndpoint(cfg.Endpoints.UpdateStatus, map[string]string{"externalID": externalID})
	if path == "" {
		path = substituteEndpoint("/issues/{externalID}/status", map[string]string{"externalID": externalID})
	}
	u, err := url.JoinPath(cfg.BaseURL, path)
	if err != nil {
		return nil, err
	}
	externalStatus := mapValue(reverseMap(mapping.StatusMapping), string(status))
	payload := map[string]string{"status": externalStatus}
	b, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, u, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	setAuthHeader(req, cfg.Auth)
	return req, nil
}

// ParseUpdateStatusResponse checks an update response for error payloads.
func (MeegoDriver) ParseUpdateStatusResponse(body []byte) error {
	var resp struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &resp)
	if resp.Error != "" {
		return fmt.Errorf("update status failed: %s", resp.Error)
	}
	if resp.Message != "" {
		return fmt.Errorf("update status failed: %s", resp.Message)
	}
	return nil
}

func mapMeegoRawToWorkItem(raw map[string]any, mapping MappingConfig) workitem.WorkItem {
	now := time.Now().UTC()
	externalID := getFieldString(raw, mapping.FieldMapping["externalID"])
	if externalID == "" {
		externalID = getFieldString(raw, "id")
	}
	status := mapValue(mapping.StatusMapping, getFieldString(raw, mapping.FieldMapping["status"]))
	priority := mapValue(mapping.PriorityMapping, getFieldString(raw, mapping.FieldMapping["priority"]))
	createdAt := parseTimeString(getFieldString(raw, mapping.FieldMapping["createdAt"]))
	updatedAt := parseTimeString(getFieldString(raw, mapping.FieldMapping["updatedAt"]))
	if createdAt.IsZero() {
		createdAt = now
	}
	if updatedAt.IsZero() {
		updatedAt = now
	}
	typ := getFieldString(raw, mapping.FieldMapping["type"])
	if typ == "" {
		typ = string(workitem.TypeRequirement)
	}
	return workitem.WorkItem{
		ID:          externalID,
		Type:        workitem.Type(typ),
		Title:       getFieldString(raw, mapping.FieldMapping["title"]),
		Description: getFieldString(raw, mapping.FieldMapping["description"]),
		Status:      workitem.Status(status),
		Priority:    workitem.Priority(priority),
		AssigneeID:  getFieldString(raw, mapping.FieldMapping["assigneeId"]),
		Reporter:    getFieldString(raw, mapping.FieldMapping["reporter"]),
		Source:      workitem.SourceMeego,
		ExternalID:  externalID,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go vet ./infrastructure/workitem-tracker/...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/meego_driver.go
git commit -m "feat(workitem): add MeegoDriver implementation"
```

---

### Task 6: Update database schemas

**Files:**
- Modify: `infra/database/workitem/schema.sql`
- Modify: `infra/database/workspace/schema.sql`

- [ ] **Step 1: Extend `workitems` table**

Append to `infra/database/workitem/schema.sql` after the existing trigger:

```sql
-- Add columns required for external workitem integration.
ALTER TABLE workitems
    ADD COLUMN IF NOT EXISTS type VARCHAR(50) NOT NULL DEFAULT 'requirement',
    ADD COLUMN IF NOT EXISTS reporter VARCHAR(200);

-- Enforce uniqueness per external project so sync can upsert cleanly.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uniq_workitems_project_external'
    ) THEN
        ALTER TABLE workitems
            ADD CONSTRAINT uniq_workitems_project_external UNIQUE (project_id, external_id);
    END IF;
END $$;
```

- [ ] **Step 2: Extend `workitem_projects` table**

Append to `infra/database/workspace/schema.sql` after the existing trigger for `workitem_projects`:

```sql
-- Sync bookkeeping for external workitem projects.
ALTER TABLE workitem_projects
    ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_sync_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
```

- [ ] **Step 3: Commit**

```bash
git add infra/database/workitem/schema.sql infra/database/workspace/schema.sql
git commit -m "feat(workitem): extend schemas for external integration"
```


---

### Task 7: Define and implement the DB workitem repository

**Files:**
- Create: `apps/dh-backend/domain/workitem/repository/repository.go`
- Create: `apps/dh-backend/domain/workitem/repository/db_repository.go`

- [ ] **Step 1: Define the repository interface and filter**

```go
package repository

import (
	"context"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// Filter is the repository-level query filter for workitems.
type Filter struct {
	ProjectID  string
	Type       workitem.Type
	Status     workitem.Status
	AssigneeID string
}

// WorkItemRepository defines DB operations needed by the service layer.
type WorkItemRepository interface {
	List(filter Filter) ([]object.WorkItem, error)
	Get(id string) (object.WorkItem, error)
	UpsertByExternalID(ctx context.Context, item object.WorkItem) error
	UpdateStatus(id string, status workitem.Status) (object.WorkItem, error)
	TouchUpdatedAtByExternalID(ctx context.Context, externalID, projectID string, t time.Time) error
}
```

- [ ] **Step 2: Implement the PostgreSQL repository**

```go
package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

const defaultWorkitemType = string(workitem.TypeRequirement)

// DBWorkItemRepository is the PostgreSQL implementation of WorkItemRepository.
type DBWorkItemRepository struct {
	db *sql.DB
}

// NewDBWorkItemRepository creates a new DB-backed repository.
func NewDBWorkItemRepository(db *sql.DB) *DBWorkItemRepository {
	return &DBWorkItemRepository{db: db}
}

// List returns workitems matching the filter.
func (r *DBWorkItemRepository) List(filter Filter) ([]object.WorkItem, error) {
	query := `SELECT id, tenant_id, project_id, type, title, description, status, priority, assignee_id, reporter, source, external_id, created_at, updated_at FROM workitems WHERE 1=1`
	var args []any
	argIdx := 1
	if filter.ProjectID != "" {
		query += fmt.Sprintf(" AND project_id = $%d", argIdx)
		args = append(args, filter.ProjectID)
		argIdx++
	}
	if filter.Type != "" {
		query += fmt.Sprintf(" AND type = $%d", argIdx)
		args = append(args, string(filter.Type))
		argIdx++
	}
	if filter.Status != "" {
		query += fmt.Sprintf(" AND status = $%d", argIdx)
		args = append(args, string(filter.Status))
		argIdx++
	}
	if filter.AssigneeID != "" {
		query += fmt.Sprintf(" AND assignee_id = $%d", argIdx)
		args = append(args, filter.AssigneeID)
		argIdx++
	}
	query += ` ORDER BY updated_at DESC`

	rows, err := r.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("list workitems failed: %w", err)
	}
	defer rows.Close()

	result := make([]object.WorkItem, 0)
	for rows.Next() {
		var it object.WorkItem
		var assigneeID, reporter, externalID sql.NullString
		if err := rows.Scan(&it.ID, &it.TenantID, &it.ProjectID, &it.Type, &it.Title, &it.Description, &it.Status, &it.Priority, &assigneeID, &reporter, &it.Source, &externalID, &it.CreatedAt, &it.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan workitem failed: %w", err)
		}
		it.AssigneeID = assigneeID.String
		it.Reporter = reporter.String
		it.ExternalID = externalID.String
		result = append(result, it)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate workitems failed: %w", err)
	}
	return result, nil
}

// Get returns a single workitem by ID.
func (r *DBWorkItemRepository) Get(id string) (object.WorkItem, error) {
	var it object.WorkItem
	var assigneeID, reporter, externalID sql.NullString
	err := r.db.QueryRow(`
		SELECT id, tenant_id, project_id, type, title, description, status, priority, assignee_id, reporter, source, external_id, created_at, updated_at
		FROM workitems WHERE id = $1
	`, id).Scan(&it.ID, &it.TenantID, &it.ProjectID, &it.Type, &it.Title, &it.Description, &it.Status, &it.Priority, &assigneeID, &reporter, &it.Source, &externalID, &it.CreatedAt, &it.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return object.WorkItem{}, errors.New("workitem not found")
	}
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("get workitem failed: %w", err)
	}
	it.AssigneeID = assigneeID.String
	it.Reporter = reporter.String
	it.ExternalID = externalID.String
	return it, nil
}

// UpsertByExternalID inserts or updates a workitem keyed by (project_id, external_id).
func (r *DBWorkItemRepository) UpsertByExternalID(ctx context.Context, item object.WorkItem) error {
	if item.Type == "" {
		item.Type = workitem.Type(defaultWorkitemType)
	}
	if item.Source == "" {
		item.Source = workitem.SourceInternal
	}
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO workitems (id, tenant_id, project_id, type, title, description, status, priority, assignee_id, reporter, source, external_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT ON CONSTRAINT uniq_workitems_project_external DO UPDATE SET
			tenant_id = EXCLUDED.tenant_id,
			type = EXCLUDED.type,
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			status = EXCLUDED.status,
			priority = EXCLUDED.priority,
			assignee_id = EXCLUDED.assignee_id,
			reporter = EXCLUDED.reporter,
			source = EXCLUDED.source,
			created_at = EXCLUDED.created_at,
			updated_at = EXCLUDED.updated_at
	`, item.ID, item.TenantID, item.ProjectID, item.Type, item.Title, item.Description, item.Status, item.Priority,
		sql.NullString{String: item.AssigneeID, Valid: item.AssigneeID != ""},
		sql.NullString{String: item.Reporter, Valid: item.Reporter != ""},
		item.Source, item.ExternalID, item.CreatedAt, item.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upsert workitem failed: %w", err)
	}
	return nil
}

// UpdateStatus updates the status of a workitem and returns the refreshed item.
func (r *DBWorkItemRepository) UpdateStatus(id string, status workitem.Status) (object.WorkItem, error) {
	_, err := r.db.Exec(`UPDATE workitems SET status = $1, updated_at = $2 WHERE id = $3`, status, time.Now().UTC(), id)
	if err != nil {
		return object.WorkItem{}, fmt.Errorf("update workitem status failed: %w", err)
	}
	return r.Get(id)
}

// TouchUpdatedAtByExternalID updates the local updated_at timestamp after a successful writeback.
func (r *DBWorkItemRepository) TouchUpdatedAtByExternalID(ctx context.Context, externalID, projectID string, t time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE workitems SET updated_at = $1 WHERE external_id = $2 AND project_id = $3`, t, externalID, projectID)
	if err != nil {
		return fmt.Errorf("touch workitem updated_at failed: %w", err)
	}
	return nil
}
```

- [ ] **Step 3: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/repository/...
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add apps/dh-backend/domain/workitem/repository
git commit -m "feat(workitem): add DB workitem repository"
```

---

### Task 8: Move `WorkItemFilter` into the repository package

**Files:**
- Modify: `apps/dh-backend/domain/workitem/service/service.go`
- Modify: `apps/dh-backend/domain/workitem/service/service_mock.go`
- Modify: `apps/dh-backend/domain/workitem/handler.go`

- [ ] **Step 1: Update `service.go`**

Replace the file contents with:

```go
package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// WorkItemService defines workitem module service interface.
type WorkItemService interface {
	ListWorkItems(filter repository.Filter) ([]object.WorkItem, error)
	GetWorkItem(id string) (object.WorkItem, error)
	UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error)
}
```

- [ ] **Step 2: Update `service_mock.go`**

Remove the local `WorkItemFilter` struct and change the `ListWorkItems` signature to use `repository.Filter`. Add the import:

```go
import (
	"errors"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)
```

Change:

```go
func (s *MockWorkItemService) ListWorkItems(filter repository.Filter) ([]object.WorkItem, error) {
```

- [ ] **Step 3: Update `handler.go` `parseWorkItemFilter`**

Change the return type and add the repository import:

```go
import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)
```

```go
func parseWorkItemFilter(r *http.Request) repository.Filter {
	q := r.URL.Query()
	return repository.Filter{
		ProjectID:  q.Get("projectId"),
		Type:       workitem.Type(q.Get("type")),
		Status:     workitem.Status(q.Get("status")),
		AssigneeID: q.Get("assigneeId"),
	}
}
```

- [ ] **Step 4: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/...
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/domain/workitem/service/service.go apps/dh-backend/domain/workitem/service/service_mock.go apps/dh-backend/domain/workitem/handler.go
git commit -m "refactor(workitem): move WorkItemFilter to repository package"
```

---

### Task 9: Implement the DB-backed `WorkItemService`

**Files:**
- Create: `apps/dh-backend/domain/workitem/service/db_service.go`

- [ ] **Step 1: Create the service**

```go
package service

import (
	"log"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

const writebackQueueCapacity = 100

// DBWorkItemService is the PostgreSQL-backed WorkItemService.
type DBWorkItemService struct {
	repo           repository.WorkItemRepository
	cfg            config.Config
	writebackQueue chan<- WritebackTask
}

// NewDBWorkItemService creates the DB-backed service.
func NewDBWorkItemService(repo repository.WorkItemRepository, cfg config.Config, queue chan<- WritebackTask) *DBWorkItemService {
	return &DBWorkItemService{
		repo:           repo,
		cfg:            cfg,
		writebackQueue: queue,
	}
}

// ListWorkItems lists workitems from the local DB.
func (s *DBWorkItemService) ListWorkItems(filter repository.Filter) ([]object.WorkItem, error) {
	return s.repo.List(filter)
}

// GetWorkItem returns a single workitem from the local DB.
func (s *DBWorkItemService) GetWorkItem(id string) (object.WorkItem, error) {
	return s.repo.Get(id)
}

// UpdateWorkItemStatus updates local status and enqueues writeback for external items.
func (s *DBWorkItemService) UpdateWorkItemStatus(id string, status workitem.Status) (object.WorkItem, error) {
	item, err := s.repo.UpdateStatus(id, status)
	if err != nil {
		return object.WorkItem{}, err
	}
	if s.cfg.WorkitemWritebackEnabled && item.Source != workitem.SourceInternal && item.ExternalID != "" && s.writebackQueue != nil {
		task := WritebackTask{
			ProjectID:  item.ProjectID,
			ExternalID: item.ExternalID,
			Status:     status,
			Attempts:   0,
		}
		select {
		case s.writebackQueue <- task:
		default:
			log.Printf("[WorkItemService] writeback queue full, dropping task for %s", item.ExternalID)
		}
	}
	return item, nil
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/service/...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/domain/workitem/service/db_service.go
git commit -m "feat(workitem): add DB-backed WorkItemService with writeback enqueue"
```

---

### Task 10: Implement the `WritebackWorker`

**Files:**
- Create: `apps/dh-backend/domain/workitem/service/writeback_worker.go`

- [ ] **Step 1: Create the worker**

```go
package service

import (
	"context"
	"log"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/tracker"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	workitemtracker "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/workitem-tracker"
)

// WritebackTask represents an asynchronous status writeback job.
type WritebackTask struct {
	ProjectID  string
	ExternalID string
	Status     workitem.Status
	Attempts   int
}

// WritebackWorker consumes writeback tasks and calls the external platform.
type WritebackWorker struct {
	provider tracker.Provider
	repo     repository.WorkItemRepository
	cfg      config.Config
	queue    chan WritebackTask
}

// NewWritebackWorker creates a writeback worker.
func NewWritebackWorker(provider tracker.Provider, repo repository.WorkItemRepository, cfg config.Config) *WritebackWorker {
	return &WritebackWorker{
		provider: provider,
		repo:     repo,
		cfg:      cfg,
		queue:    make(chan WritebackTask, writebackQueueCapacity),
	}
}

// Queue returns the channel used to enqueue writeback tasks.
func (w *WritebackWorker) Queue() chan<- WritebackTask {
	return w.queue
}

// Start launches the configured number of worker goroutines.
func (w *WritebackWorker) Start(ctx context.Context) {
	for i := 0; i < w.cfg.WorkitemWritebackWorkers; i++ {
		go w.loop(ctx)
	}
	log.Printf("[WritebackWorker] started with %d workers", w.cfg.WorkitemWritebackWorkers)
}

func (w *WritebackWorker) loop(ctx context.Context) {
	for {
		select {
		case task, ok := <-w.queue:
			if !ok {
				return
			}
			w.handle(ctx, task)
		case <-ctx.Done():
			return
		}
	}
}

func (w *WritebackWorker) handle(ctx context.Context, task WritebackTask) {
	trk, err := w.provider.GetTracker(ctx, task.ProjectID)
	if err != nil {
		log.Printf("[WritebackWorker] get tracker failed for project %s: %v", task.ProjectID, err)
		w.requeue(task)
		return
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, w.cfg.WorkitemSyncTimeout)
	defer cancel()
	err = trk.UpdateStatus(timeoutCtx, task.ExternalID, task.Status)
	if err != nil {
		log.Printf("[WritebackWorker] update status %s/%s failed: %v", task.ProjectID, task.ExternalID, err)
		if extErr, ok := err.(*workitemtracker.ExternalError); ok && (extErr.Status == 401 || extErr.Status == 403) {
			log.Printf("[WritebackWorker] auth error, dropping task %s/%s", task.ProjectID, task.ExternalID)
			return
		}
		w.requeue(task)
		return
	}
	if err := w.repo.TouchUpdatedAtByExternalID(ctx, task.ExternalID, task.ProjectID, time.Now().UTC()); err != nil {
		log.Printf("[WritebackWorker] touch updated_at failed for %s/%s: %v", task.ProjectID, task.ExternalID, err)
	}
}

func (w *WritebackWorker) requeue(task WritebackTask) {
	if task.Attempts >= w.cfg.WorkitemWritebackRetry {
		log.Printf("[WritebackWorker] max retries reached, dropping task %s/%s", task.ProjectID, task.ExternalID)
		return
	}
	backoff := time.Duration(1<<task.Attempts) * time.Second
	if backoff > 30*time.Second {
		backoff = 30 * time.Second
	}
	time.Sleep(backoff)
	task.Attempts++
	select {
	case w.queue <- task:
	default:
		log.Printf("[WritebackWorker] queue full, dropping task %s/%s", task.ProjectID, task.ExternalID)
	}
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/service/...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/domain/workitem/service/writeback_worker.go
git commit -m "feat(workitem): add WritebackWorker with retry and backoff"
```

---

### Task 11: Implement the `SyncScheduler`

**Files:**
- Create: `apps/dh-backend/domain/workitem/service/sync_scheduler.go`

- [ ] **Step 1: Create the scheduler**

```go
package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"slices"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/tracker"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	workitemtracker "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/workitem-tracker"
)

type syncProject struct {
	WorkspaceID string
	TenantID    string
	Platform    string
	ExternalKey string
	Config      any
}

// SyncScheduler triggers periodic syncs for all configured external projects.
type SyncScheduler struct {
	db       *sql.DB
	provider tracker.Provider
	repo     repository.WorkItemRepository
	cfg      config.Config
	stop     chan struct{}
	wg       sync.WaitGroup
}

// NewSyncScheduler creates a new sync scheduler.
func NewSyncScheduler(db *sql.DB, provider tracker.Provider, repo repository.WorkItemRepository, cfg config.Config) *SyncScheduler {
	return &SyncScheduler{
		db:       db,
		provider: provider,
		repo:     repo,
		cfg:      cfg,
		stop:     make(chan struct{}),
	}
}

// Start launches the scheduler and its worker pool.
func (s *SyncScheduler) Start(ctx context.Context) {
	jobs := make(chan syncProject, s.cfg.WorkitemSyncWorkers*2)
	for i := 0; i < s.cfg.WorkitemSyncWorkers; i++ {
		s.wg.Add(1)
		go s.worker(ctx, jobs)
	}
	s.wg.Add(1)
	go s.schedulerLoop(ctx, jobs)
	log.Printf("[SyncScheduler] started with interval %s and %d workers", s.cfg.WorkitemSyncInterval, s.cfg.WorkitemSyncWorkers)
}

// Stop halts the scheduler and waits for workers to finish.
func (s *SyncScheduler) Stop() {
	close(s.stop)
	s.wg.Wait()
}

func (s *SyncScheduler) schedulerLoop(ctx context.Context, jobs chan<- syncProject) {
	defer s.wg.Done()
	ticker := time.NewTicker(s.cfg.WorkitemSyncInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.tick(ctx, jobs)
		case <-s.stop:
			close(jobs)
			return
		case <-ctx.Done():
			close(jobs)
			return
		}
	}
}

func (s *SyncScheduler) tick(ctx context.Context, jobs chan<- syncProject) {
	projects, err := s.loadProjects(ctx)
	if err != nil {
		log.Printf("[SyncScheduler] load projects failed: %v", err)
		return
	}
	for _, p := range projects {
		select {
		case jobs <- p:
		case <-ctx.Done():
			return
		}
	}
}

func (s *SyncScheduler) loadProjects(ctx context.Context) ([]syncProject, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT p.workspace_id, p.platform, p.external_key, p.config, w.tenant_id
		FROM workitem_projects p
		JOIN workspaces w ON w.id = p.workspace_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []syncProject
	for rows.Next() {
		var p syncProject
		var configBytes []byte
		if err := rows.Scan(&p.WorkspaceID, &p.Platform, &p.ExternalKey, &configBytes, &p.TenantID); err != nil {
			return nil, err
		}
		if !slices.Contains(s.cfg.WorkitemPlatformWhitelist, p.Platform) {
			continue
		}
		if len(configBytes) > 0 {
			_ = json.Unmarshal(configBytes, &p.Config)
		}
		result = append(result, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *SyncScheduler) worker(ctx context.Context, jobs <-chan syncProject) {
	defer s.wg.Done()
	for p := range jobs {
		s.syncProject(ctx, p)
	}
}

func (s *SyncScheduler) syncProject(ctx context.Context, p syncProject) {
	timeoutCtx, cancel := context.WithTimeout(ctx, s.cfg.WorkitemSyncTimeout)
	defer cancel()
	trk, err := s.provider.GetTracker(timeoutCtx, p.WorkspaceID)
	if err != nil {
		log.Printf("[SyncScheduler] get tracker for %s failed: %v", p.WorkspaceID, err)
		s.updateSyncStatus(p.WorkspaceID, "tracker_error", err.Error())
		return
	}
	items, err := trk.List(timeoutCtx, p.ExternalKey)
	if err != nil {
		log.Printf("[SyncScheduler] sync project %s failed: %v", p.WorkspaceID, err)
		status := "error"
		if extErr, ok := err.(*workitemtracker.ExternalError); ok && (extErr.Status == 401 || extErr.Status == 403) {
			status = "auth_error"
		}
		s.updateSyncStatus(p.WorkspaceID, status, err.Error())
		return
	}
	for _, it := range items {
		it.TenantID = p.TenantID
		it.ProjectID = p.WorkspaceID
		it.Source = workitem.Source(p.Platform)
		if err := s.repo.UpsertByExternalID(ctx, it); err != nil {
			log.Printf("[SyncScheduler] upsert workitem %s failed: %v", it.ExternalID, err)
		}
	}
	s.updateSyncStatus(p.WorkspaceID, "success", "")
}

func (s *SyncScheduler) updateSyncStatus(workspaceID, status, errMsg string) {
	_, dbErr := s.db.Exec(`
		UPDATE workitem_projects
		SET last_sync_at = $1, last_sync_status = $2, last_sync_error = $3
		WHERE workspace_id = $4
	`, time.Now().UTC(), status, errMsg, workspaceID)
	if dbErr != nil {
		log.Printf("[SyncScheduler] update sync status for %s failed: %v", workspaceID, dbErr)
	}
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/service/...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/domain/workitem/service/sync_scheduler.go
git commit -m "feat(workitem): add SyncScheduler with worker pool and sync status"
```


---

### Task 12: Implement the tracker `Provider`

**Files:**
- Create: `apps/dh-backend/domain/workitem/tracker/provider.go`

- [ ] **Step 1: Create the provider**

```go
package tracker

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	workitemtracker "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/workitem-tracker"
)

// Provider builds a platform-specific Tracker for a workspace.
type Provider interface {
	GetTracker(ctx context.Context, workspaceID string) (workitemtracker.Tracker, error)
}

// DBProvider loads project configuration from PostgreSQL and builds a Tracker.
type DBProvider struct {
	db        *sql.DB
	whitelist []string
	timeout   time.Duration
	registry  map[string]workitemtracker.Driver
}

// NewDBProvider creates a new DB-backed tracker provider.
func NewDBProvider(db *sql.DB, whitelist []string, timeout time.Duration) *DBProvider {
	return &DBProvider{
		db:        db,
		whitelist: whitelist,
		timeout:   timeout,
		registry: map[string]workitemtracker.Driver{
			string(workitem.SourceMeego): workitemtracker.MeegoDriver{},
		},
	}
}

type projectConfig struct {
	Platform        string                         `json:"platform"`
	ProjectKey      string                         `json:"projectKey"`
	API             workitemtracker.APIConfig      `json:"api"`
	Endpoints       workitemtracker.EndpointConfig `json:"endpoints"`
	FieldMapping    map[string]string              `json:"fieldMapping"`
	StatusMapping   map[string]string              `json:"statusMapping"`
	PriorityMapping map[string]string              `json:"priorityMapping"`
}

// GetTracker loads the workspace project config and returns an HTTPTracker.
func (p *DBProvider) GetTracker(ctx context.Context, workspaceID string) (workitemtracker.Tracker, error) {
	var platform, externalKey string
	var configBytes []byte
	err := p.db.QueryRowContext(ctx, `
		SELECT platform, external_key, config
		FROM workitem_projects
		WHERE workspace_id = $1
	`, workspaceID).Scan(&platform, &externalKey, &configBytes)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("workitem project not found for workspace %s", workspaceID)
	}
	if err != nil {
		return nil, fmt.Errorf("load workitem project failed: %w", err)
	}
	if !contains(p.whitelist, platform) {
		return nil, fmt.Errorf("platform %s is not in whitelist", platform)
	}
	driver, ok := p.registry[platform]
	if !ok {
		return nil, fmt.Errorf("driver for platform %s not found", platform)
	}
	var pc projectConfig
	if len(configBytes) > 0 {
		if err := json.Unmarshal(configBytes, &pc); err != nil {
			return nil, fmt.Errorf("unmarshal project config failed: %w", err)
		}
	}
	driverCfg := workitemtracker.DriverConfig{
		Platform:   platform,
		ProjectKey: externalKey,
		BaseURL:    pc.API.BaseURL,
		Auth:       pc.API.Auth,
		Endpoints:  pc.Endpoints,
	}
	mapping := workitemtracker.MappingConfig{
		FieldMapping:    pc.FieldMapping,
		StatusMapping:   pc.StatusMapping,
		PriorityMapping: pc.PriorityMapping,
	}
	return workitemtracker.NewHTTPTracker(nil, driver, driverCfg, mapping, p.timeout), nil
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/...
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/dh-backend/domain/workitem/tracker/provider.go
git commit -m "feat(workitem): add DB tracker provider"
```

---

### Task 13: Persist `config` in `WorkitemProject`

**Files:**
- Modify: `apps/dh-backend/domain/workspace/service/service.go`
- Modify: `apps/dh-backend/domain/workspace/service/db_service.go`
- Modify: `apps/dh-backend/domain/workspace/service/service_mock.go`

- [ ] **Step 1: Add `Config` to the request DTO**

In `apps/dh-backend/domain/workspace/service/service.go`, update `WorkitemProjectRequest`:

```go
// WorkitemProjectRequest sets the workspace workitem project.
type WorkitemProjectRequest struct {
	Platform    string `json:"platform"`
	ExternalKey string `json:"externalKey"`
	Name        string `json:"name"`
	Config      any    `json:"config"`
}
```

- [ ] **Step 2: Persist config in DB service**

In `apps/dh-backend/domain/workspace/service/db_service.go`, update `SetWorkitemProject`:

Before the transaction begins, marshal the config:

```go
	configStr, err := sqlutil.MarshalConfig(req.Config)
	if err != nil {
		return workspace.WorkitemProject{}, fmt.Errorf("marshal workitem project config failed: %w", err)
	}
```

Then include it in the `INSERT ... ON CONFLICT` columns and values:

```go
	_, err = tx.Exec(`
		INSERT INTO workitem_projects (id, workspace_id, platform, external_key, name, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (workspace_id) DO UPDATE SET
			platform = EXCLUDED.platform,
			external_key = EXCLUDED.external_key,
			name = EXCLUDED.name,
			config = EXCLUDED.config,
			updated_at = EXCLUDED.updated_at
	`, uuid.New().String(), workspaceID, req.Platform, req.ExternalKey, req.Name, configStr, now, now)
```

The `getWorkitemProjectTx` helper already reads and unmarshals `config`; no change needed there.

- [ ] **Step 3: Store config in mock service**

In `apps/dh-backend/domain/workspace/service/service_mock.go`, update `SetWorkitemProject` to set `Config: req.Config`:

```go
	wp := workspace.WorkitemProject{
		ID:          uuid.NewString(),
		WorkspaceID: workspaceID,
		Platform:    req.Platform,
		ExternalKey: req.ExternalKey,
		Name:        req.Name,
		Config:      req.Config,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
```

- [ ] **Step 4: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workspace/...
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/domain/workspace/service/service.go apps/dh-backend/domain/workspace/service/db_service.go apps/dh-backend/domain/workspace/service/service_mock.go
git commit -m "feat(workspace): persist workitem project mapping config"
```

---

### Task 14: Add platform whitelist handler and `Init` wiring

**Files:**
- Modify: `apps/dh-backend/domain/workitem/handler.go`

- [ ] **Step 1: Update imports and package state**

```go
package workitem

import (
	"encoding/json"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

var (
	defaultWorkItemService service.WorkItemService
	workitemConfig         config.Config
)

// Init injects the service implementation and config.
func Init(svc service.WorkItemService, cfg config.Config) {
	defaultWorkItemService = svc
	workitemConfig = cfg
}
```

- [ ] **Step 2: Add `Platforms` handler**

Append before `parseWorkItemFilter`:

```go
// Platforms returns the configured workitem platform whitelist.
func Platforms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, `{"code":1,"message":"method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(workitemConfig.WorkitemPlatformWhitelist)
}
```

- [ ] **Step 3: Update `parseWorkItemFilter` return type**

```go
func parseWorkItemFilter(r *http.Request) repository.Filter {
	q := r.URL.Query()
	return repository.Filter{
		ProjectID:  q.Get("projectId"),
		Type:       workitem.Type(q.Get("type")),
		Status:     workitem.Status(q.Get("status")),
		AssigneeID: q.Get("assigneeId"),
	}
}
```

- [ ] **Step 4: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./domain/workitem/...
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/domain/workitem/handler.go
git commit -m "feat(workitem): add platform whitelist endpoint and service init"
```

---

### Task 15: Wire everything together in `gateway/server/server.go`

**Files:**
- Modify: `apps/dh-backend/gateway/server/server.go`

- [ ] **Step 1: Add imports**

Add these imports to the existing block:

```go
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	workitemrepo "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/repository"
	workitemtrackerprovider "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/tracker"
```

- [ ] **Step 2: Add route and initialization call**

After the existing workitem routes, add the platforms route:

```go
	mux.HandleFunc("/api/v1/workitem/platforms", workitem.Platforms)
```

After `initWorkspaceService(db)`, add:

```go
	initWorkitemService(db, cfg)
```

- [ ] **Step 3: Add the initialization helper**

Append before `initDB`:

```go
func initWorkitemService(db *sql.DB, cfg config.Config) {
	if db == nil {
		log.Println("[WorkItem] using memory mock")
		workitem.Init(workitemservice.NewMockWorkItemService(), cfg)
		return
	}
	log.Println("[WorkItem] using postgres storage")
	repo := workitemrepo.NewDBWorkItemRepository(db)
	provider := workitemtrackerprovider.NewDBProvider(db, cfg.WorkitemPlatformWhitelist, cfg.WorkitemSyncTimeout)
	wbWorker := workitemservice.NewWritebackWorker(provider, repo, cfg)
	wbWorker.Start(context.Background())
	scheduler := workitemservice.NewSyncScheduler(db, provider, repo, cfg)
	scheduler.Start(context.Background())
	svc := workitemservice.NewDBWorkItemService(repo, cfg, wbWorker.Queue())
	workitem.Init(svc, cfg)
}
```

Make sure `context` is already imported (it is).

- [ ] **Step 4: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/dh-backend && go vet ./...
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/dh-backend/gateway/server/server.go
git commit -m "feat(workitem): wire repository, scheduler, writeback and routes"
```


---

### Task 16: Add frontend API for platform whitelist

**Files:**
- Modify: `apps/web/src/lib/workspace-api.ts`

- [ ] **Step 1: Add `getWorkitemPlatforms`**

```ts
export const workspaceApi = {
  list: (tenantId: string) => api.get<Workspace[]>(`/v1/workspaces?tenantId=${tenantId}`),
  create: (req: { tenantId: string; name: string; description?: string; ownerUserId: string }) =>
    api.post<Workspace>('/v1/workspaces', req),
  get: (id: string) => api.get<Workspace>(`/v1/workspaces/${id}`),

  members: (workspaceId: string) => api.get<WorkspaceMember[]>(`/v1/workspaces/${workspaceId}/members`),
  addMember: (workspaceId: string, req: { userId: string; role: string; subRole?: string }) =>
    api.post<void>(`/v1/workspaces/${workspaceId}/members`, req),
  removeMember: (workspaceId: string, userId: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/members/${userId}`),

  getWorkitemPlatforms: () => api.get<string[]>('/v1/workitem/platforms'),

  getWorkitemProject: (workspaceId: string) =>
    api.get<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`),
  setWorkitemProject: (workspaceId: string, req: Partial<WorkitemProject>) =>
    api.post<WorkitemProject>(`/v1/workspaces/${workspaceId}/workitem-project`, req),

  listAgents: (workspaceId: string) => api.get<WorkspaceAgent[]>(`/v1/workspaces/${workspaceId}/agents`),

  listStandards: (workspaceId: string, repositoryId?: string) =>
    api.get<WorkspaceStandard[]>(`/v1/workspaces/${workspaceId}/standards${repositoryId ? `?repositoryId=${repositoryId}` : ''}`),
  saveStandard: (workspaceId: string, req: Partial<WorkspaceStandard>) =>
    api.post<WorkspaceStandard>(`/v1/workspaces/${workspaceId}/standards`, req),
  deleteStandard: (workspaceId: string, id: string) =>
    api.delete<void>(`/v1/workspaces/${workspaceId}/standards/${id}`),

  getCICD: (workspaceId: string) => api.get<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`),
  saveCICD: (workspaceId: string, req: Partial<WorkspaceCICD>) =>
    api.post<WorkspaceCICD>(`/v1/workspaces/${workspaceId}/cicd`, req),
};
```

- [ ] **Step 2: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/web && npx tsc --noEmit -p tsconfig.check.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/workspace-api.ts
git commit -m "feat(web): add getWorkitemPlatforms API"
```

---

### Task 17: Extend Settings page with dynamic platforms and mapping JSON editor

**Files:**
- Modify: `apps/web/src/pages/Settings.tsx`

- [ ] **Step 1: Add state for platform options and mapping JSON**

Near the existing workitem state:

```tsx
  const [workitemProject, setWorkitemProject] = useState<WorkitemProject | null>(null);
  const [platformOptions, setPlatformOptions] = useState<string[]>([]);
  const [workitemConfigJson, setWorkitemConfigJson] = useState('{}');
```

- [ ] **Step 2: Load platform whitelist on mount**

Add a new `useEffect` after the existing ones:

```tsx
  useEffect(() => {
    let cancelled = false;
    workspaceApi.getWorkitemPlatforms()
      .then(list => {
        if (cancelled) return;
        setPlatformOptions(list);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load workitem platforms:', err);
        toast.error('加载平台列表失败');
      });
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 3: Populate mapping JSON when a project is loaded**

In the existing workspace load `useEffect`, update the `wp` branch:

```tsx
      if (wp) {
        setSettings(prev => ({ ...prev, meegoProject: wp.externalKey || '' }));
        setReqPlatform(wp.platform || (platformOptions[0] ?? 'meego'));
        setWorkitemConfigJson(JSON.stringify(wp.config || {}, null, 2));
      }
```

- [ ] **Step 4: Replace the platform/project-key form fields**

Replace the current "需求管理" block inside the `basic` tab with:

```tsx
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground border-b border-border/50 pb-2">需求管理</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>需求管理平台</Label>
                    <Select disabled={isReadOnly} value={reqPlatform} onValueChange={setReqPlatform}>
                      <SelectTrigger>
                        <SelectValue placeholder="选择平台" />
                      </SelectTrigger>
                      <SelectContent>
                        {platformOptions.map(p => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="external-key">外部项目 Key</Label>
                    <Input
                      disabled={isReadOnly}
                      id="external-key"
                      placeholder="输入外部项目 Key..."
                      value={settings.meegoProject}
                      onChange={e => setSettings({ ...settings, meegoProject: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="workitem-config">映射配置 (JSON)</Label>
                    <Textarea
                      id="workitem-config"
                      disabled={isReadOnly}
                      className="font-mono text-sm min-h-[200px] bg-muted/20"
                      placeholder={`{\n  "api": { "baseURL": "", "auth": { "type": "bearer", "token": "" } },\n  "endpoints": {\n    "list": "/projects/{projectKey}/issues",\n    "get": "/issues/{externalID}",\n    "updateStatus": "/issues/{externalID}/status"\n  },\n  "fieldMapping": {\n    "id": "id",\n    "title": "title",\n    "description": "description",\n    "status": "status",\n    "priority": "priority",\n    "assigneeId": "assignee.id",\n    "reporter": "reporter.name",\n    "externalID": "id",\n    "createdAt": "createdAt",\n    "updatedAt": "updatedAt"\n  },\n  "statusMapping": { "open": "backlog", "resolved": "done" },\n  "priorityMapping": { "P0": "high" }\n}`}
                      value={workitemConfigJson}
                      onChange={e => setWorkitemConfigJson(e.target.value)}
                    />
                  </div>
                </div>
              </div>
```

- [ ] **Step 5: Validate and send mapping config on save**

Update `handleSaveBasic`:

```tsx
  const handleSaveBasic = async () => {
    const workspaceId = workspace?.id || 'ws-default';
    let parsedConfig: Record<string, unknown> = {};
    if (workitemConfigJson.trim()) {
      try {
        parsedConfig = JSON.parse(workitemConfigJson);
      } catch {
        toast.error('映射配置 JSON 格式错误');
        return;
      }
    }
    try {
      await workspaceApi.setWorkitemProject(workspaceId, {
        platform: reqPlatform,
        externalKey: settings.meegoProject,
        name: workspace?.name || settings.meegoProject,
        config: parsedConfig,
      });
      await Promise.all(gitRepos.map(r =>
        repositoryApi.update(workspaceId, r.id, {
          name: r.name,
          url: r.url,
          type: r.type,
          defaultBranch: r.defaultBranch,
          sshKey: r.sshKey,
        })
      ));
      toast.success('基础配置已保存');
    } catch {
      toast.error('保存基础配置失败');
    }
  };
```

- [ ] **Step 6: Verify**

Run:

```bash
cd /home/nan/deepharness-ent-platform/apps/web && npx tsc --noEmit -p tsconfig.check.json
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/Settings.tsx
git commit -m "feat(web): dynamic platform list and mapping JSON editor in settings"
```

---

### Task 18: Write unit tests for mapping helpers

**Files:**
- Create: `packages/go-sdk/infrastructure/workitem-tracker/mapping_test.go`

- [ ] **Step 1: Create the tests**

```go
package workitemtracker

import (
	"testing"
	"time"
)

func TestGetFieldString(t *testing.T) {
	data := map[string]any{
		"id":       "101",
		"assignee": map[string]any{"id": "u1"},
		"reporter": map[string]any{"name": "xiaohong"},
	}
	if got := getFieldString(data, "assignee.id"); got != "u1" {
		t.Fatalf("expected u1, got %s", got)
	}
	if got := getFieldString(data, "reporter.name"); got != "xiaohong" {
		t.Fatalf("expected xiaohong, got %s", got)
	}
	if got := getFieldString(data, "missing"); got != "" {
		t.Fatalf("expected empty, got %s", got)
	}
	if got := getFieldString(data, "assignee.name"); got != "" {
		t.Fatalf("expected empty for missing nested field, got %s", got)
	}
}

func TestMapValue(t *testing.T) {
	m := map[string]string{"open": "backlog"}
	if got := mapValue(m, "open"); got != "backlog" {
		t.Fatalf("expected backlog, got %s", got)
	}
	if got := mapValue(m, "closed"); got != "closed" {
		t.Fatalf("expected closed fallback, got %s", got)
	}
	if got := mapValue(nil, "open"); got != "open" {
		t.Fatalf("expected key on nil map, got %s", got)
	}
}

func TestReverseMap(t *testing.T) {
	m := map[string]string{"open": "backlog", "resolved": "done"}
	r := reverseMap(m)
	if r["backlog"] != "open" || r["done"] != "resolved" {
		t.Fatalf("unexpected reverse map: %v", r)
	}
}

func TestParseTimeString(t *testing.T) {
	s := "2026-06-15T12:00:00Z"
	got := parseTimeString(s)
	want := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	if !parseTimeString("").IsZero() {
		t.Fatalf("expected zero time for empty string")
	}
}

func TestSubstituteEndpoint(t *testing.T) {
	got := substituteEndpoint("/projects/{projectKey}/issues/{externalID}", map[string]string{
		"projectKey": "myproj",
		"externalID": "101",
	})
	if got != "/projects/myproj/issues/101" {
		t.Fatalf("unexpected substitution: %s", got)
	}
}
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go test ./infrastructure/workitem-tracker/... -run TestGetFieldString -v
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/mapping_test.go
git commit -m "test(workitem): add mapping helper tests"
```

---

### Task 19: Write integration tests for `HTTPTracker` + `MeegoDriver`

**Files:**
- Create: `packages/go-sdk/infrastructure/workitem-tracker/http_tracker_test.go`

- [ ] **Step 1: Create the tests**

```go
package workitemtracker

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

func TestHTTPTracker_List(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/projects/myproj/issues" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if auth := r.Header.Get("Authorization"); auth != "Bearer token-1" {
			t.Fatalf("unexpected auth %s", auth)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"id":"MEEGO-101","title":"Login","description":"SSO login","status":"open","priority":"P0","assignee":{"id":"u1"},"reporter":{"name":"xiaohong"},"createdAt":"2026-06-15T12:00:00Z","updatedAt":"2026-06-15T12:00:00Z"}
		]`))
	}))
	defer srv.Close()

	cfg := DriverConfig{
		BaseURL: srv.URL,
		Auth:    AuthConfig{Type: "bearer", Token: "token-1"},
		Endpoints: EndpointConfig{
			List: "/projects/{projectKey}/issues",
		},
	}
	mapping := MappingConfig{
		FieldMapping: map[string]string{
			"id": "id", "title": "title", "description": "description",
			"status": "status", "priority": "priority", "assigneeId": "assignee.id",
			"reporter": "reporter.name", "externalID": "id", "createdAt": "createdAt", "updatedAt": "updatedAt",
		},
		StatusMapping:   map[string]string{"open": "backlog", "resolved": "done"},
		PriorityMapping: map[string]string{"P0": "high"},
	}
	tracker := NewHTTPTracker(nil, MeegoDriver{}, cfg, mapping, 5*time.Second)
	items, err := tracker.List(context.Background(), "myproj")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	it := items[0]
	if it.ExternalID != "MEEGO-101" {
		t.Fatalf("expected external id MEEGO-101, got %s", it.ExternalID)
	}
	if it.Status != workitem.StatusBacklog {
		t.Fatalf("expected status backlog, got %s", it.Status)
	}
	if it.Priority != workitem.PriorityHigh {
		t.Fatalf("expected priority high, got %s", it.Priority)
	}
	if it.AssigneeID != "u1" || it.Reporter != "xiaohong" {
		t.Fatalf("unexpected assignee/reporter: %s / %s", it.AssigneeID, it.Reporter)
	}
}

func TestHTTPTracker_UpdateStatus(t *testing.T) {
	var captured []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/issues/MEEGO-101/status" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.Method != http.MethodPatch {
			t.Fatalf("unexpected method %s", r.Method)
		}
		captured, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	cfg := DriverConfig{
		BaseURL: srv.URL,
		Auth:    AuthConfig{Type: "bearer", Token: "token-1"},
		Endpoints: EndpointConfig{
			UpdateStatus: "/issues/{externalID}/status",
		},
	}
	mapping := MappingConfig{
		StatusMapping: map[string]string{
			"open":        "backlog",
			"in_progress": "in_progress",
			"resolved":    "done",
			"closed":      "closed",
		},
	}
	tracker := NewHTTPTracker(nil, MeegoDriver{}, cfg, mapping, 5*time.Second)
	if err := tracker.UpdateStatus(context.Background(), "MEEGO-101", workitem.StatusDone); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(captured) != `{"status":"resolved"}` {
		t.Fatalf("unexpected request body %s", string(captured))
	}
}
```

- [ ] **Step 2: Run the tests**

```bash
cd /home/nan/deepharness-ent-platform/packages/go-sdk && go test ./infrastructure/workitem-tracker/... -v
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/go-sdk/infrastructure/workitem-tracker/http_tracker_test.go
git commit -m "test(workitem): add HTTPTracker and MeegoDriver integration tests"
```

---

### Task 20: Final verification

**Files:**
- All files above

- [ ] **Step 1: Go vet and tests**

```bash
cd /home/nan/deepharness-ent-platform
cd packages/go-sdk && go vet ./... && go test ./infrastructure/workitem-tracker/... -v
cd ../apps/dh-backend && go vet ./... && go build -o /tmp/dh-backend .
```

Expected:
- `go vet` prints no warnings.
- Tests PASS.
- `go build` succeeds and produces `/tmp/dh-backend`.

- [ ] **Step 2: Type-check the frontend**

```bash
cd /home/nan/deepharness-ent-platform/apps/web && npx tsc --noEmit -p tsconfig.check.json
```

Expected: no errors.

- [ ] **Step 3: Full build**

```bash
cd /home/nan/deepharness-ent-platform && pnpm build
```

Expected: build succeeds for `apps/web` and `apps/dh-backend`.

- [ ] **Step 4: Smoke test**

Start the stack:

```bash
cd /home/nan/deepharness-ent-platform && pnpm dev
```

In another terminal:

```bash
curl -s http://localhost:8080/api/v1/workitem/platforms
# Expected: ["meego","jira"]

curl -s http://localhost:8080/api/v1/workitems
# Expected: workitem list (empty array or synced items)
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(workitem): complete external integration implementation"
```

---

## Self-Review

### 1. Spec coverage

| Spec section | Implementing task |
|--------------|-------------------|
| Global `config.yaml` workitem config | Task 1 |
| Tracker/Driver interfaces | Task 2 |
| Generic `HTTPTracker` | Task 4 |
| `MeegoDriver` | Task 5 |
| DB repository for workitems | Task 7 |
| DB service + writeback enqueue | Task 9 |
| `SyncScheduler` + worker pool | Task 11 |
| `WritebackWorker` + retry/backoff | Task 10 |
| Gateway wiring | Task 15 |
| Platform whitelist endpoint | Task 14 |
| Frontend settings changes | Tasks 16-17 |
| Mapping/HTTPTracker tests | Tasks 18-19 |

No gaps identified.

### 2. Placeholder scan

Scanned for `TBD`, `TODO`, `implement later`, and vague instructions. None found; every step contains runnable code and explicit commands.

### 3. Type consistency

- `WorkItemService.ListWorkItems` uses `repository.Filter` consistently across interface, mock, DB service, and handler.
- `WorkitemProjectRequest.Config` is `any` in service DTO and stored as JSONB in DB/mock.
- `Tracker` interface (`List`, `Get`, `UpdateStatus`) matches `HTTPTracker` and `MeegoDriver` signatures.
- `WritebackTask` carries `ProjectID`, `ExternalID`, and `Status` used by both `DBWorkItemService` and `WritebackWorker`.
- `SyncScheduler` and `WritebackWorker` share the same `tracker.Provider` and `repository.WorkItemRepository` types.

All signatures align across tasks.


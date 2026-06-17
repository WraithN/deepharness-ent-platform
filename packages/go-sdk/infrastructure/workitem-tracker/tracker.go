package workitemtracker

import (
	"context"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
)

// Known authentication types.
const (
	AuthTypeBearer = "bearer"
)

// Known mapping field keys. Drivers use these keys to locate the corresponding
// external field name from MappingConfig.FieldMapping.
const (
	MappingKeyExternalID = "externalID"
	MappingKeyTitle      = "title"
	MappingKeyStatus     = "status"
	MappingKeyPriority   = "priority"
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

	BuildGetRequest(ctx context.Context, cfg DriverConfig, externalID string) (*http.Request, error)
	ParseGetResponse(body []byte, mapping MappingConfig) (*workitem.WorkItem, error)

	BuildUpdateStatusRequest(ctx context.Context, cfg DriverConfig, externalID string, status workitem.Status, mapping MappingConfig) (*http.Request, error)
	ParseUpdateStatusResponse(body []byte) error
}

// AuthConfig holds platform authentication details (initially bearer token only).
type AuthConfig struct {
	Type  string `json:"type"`
	Token string `json:"token"`
}

// APIConfig holds base URL and auth for a platform instance.
// It matches the persisted workspace configuration shape used by callers to
// assemble a DriverConfig.
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

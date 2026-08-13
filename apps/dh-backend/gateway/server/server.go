package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer/memory"
	redisbuffer "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/agui/buffer/redis"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat"
	session "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/chat/session"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/client"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/provisioner/directhost"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/sessionmanager"
	sessionmanagerservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/agent/sessionmanager/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review"
	agentreviewservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agent_review/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig"
	agentconfigservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentconfig/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime"
	agentruntimeservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/agentruntime/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit"
	auditservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/audit/service"
	crawlerhandler "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/handler"
	crawlerservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu"
	feishuservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/feishu/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity"
	identityservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/identity/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification"
	notificationobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/object"
	notificationservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/notification/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant"
	paservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/personalassistant/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate"
	platformtemplateservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/platformtemplate/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent"
	pragentservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process"
	processservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/service"
	processstore "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/process/store"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc"
	productdocservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productdoc/service"
	psHandler "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace"
	psService "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/prototypetemplate"
	prototypetemplateservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/prototypetemplate/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository"
	repositoryservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team"
	teamservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/team/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem"
	workitemobject "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/object"
	workitemservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workitem/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace"
	workspaceservice "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/workspace/service"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/handler"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/middleware"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	devorchestrator "github.com/deepharness/deepharness-ent-platform/apps/dh-backend/orchestrator"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/crypto"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"
	sdkworkitem "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/workitem"
	sdkpostgres "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/postgres"
	"github.com/redis/go-redis/v9"
)

const (
	API_V1_PREFIX = "/api/v1"
	WS_V1_PREFIX  = "/ws/v1"

	ROUTE_HEALTH                                                                       = "/health"
	ROUTE_AGENT                                                                        = API_V1_PREFIX + "/agent"
	ROUTE_AGENT_RESPOND                                                                = API_V1_PREFIX + "/agent/respond"
	ROUTE_SESSIONS                                                                     = API_V1_PREFIX + "/sessions"
	ROUTE_SESSIONS_BY_ID                                                               = API_V1_PREFIX + "/sessions/{id}"
	ROUTE_SESSIONS_BY_ID_MESSAGES                                                      = API_V1_PREFIX + "/sessions/{id}/messages"
	ROUTE_SESSIONS_BY_ID_SSE                                                           = API_V1_PREFIX + "/sessions/{id}/sse"
	ROUTE_HELLO                                                                        = API_V1_PREFIX + "/hello"
	ROUTE_FILES                                                                        = API_V1_PREFIX + "/files/"
	ROUTE_PROJECTS                                                                     = API_V1_PREFIX + "/projects/"
	ROUTE_PREVIEW                                                                      = API_V1_PREFIX + "/preview/"
	ROUTE_POST_SESSIONS_BY_ID_CHAT                                                     = http.MethodPost + " " + API_V1_PREFIX + "/sessions/{id}/chat"
	ROUTE_GET_SESSIONS_BY_ID_WS                                                        = http.MethodGet + " " + API_V1_PREFIX + "/sessions/{id}/ws"
	ROUTE_IDENTITY_USERS                                                               = API_V1_PREFIX + "/identity/users"
	ROUTE_IDENTITY_USERS_ME                                                            = API_V1_PREFIX + "/identity/users/me"
	ROUTE_IDENTITY_USERS_ME_PROFILE                                                    = API_V1_PREFIX + "/identity/users/me/profile"
	ROUTE_IDENTITY_LOGIN                                                               = API_V1_PREFIX + "/identity/login"
	ROUTE_TENANTS                                                                      = API_V1_PREFIX + "/tenants"
	ROUTE_TENANTS_BY_ID                                                                = API_V1_PREFIX + "/tenants/{id}"
	ROUTE_TENANTS_BY_ID_MEMBERS                                                        = API_V1_PREFIX + "/tenants/{id}/members"
	ROUTE_TENANTS_BY_ID_MEMBERS_BY_USER_ID                                             = API_V1_PREFIX + "/tenants/{id}/members/{userId}"
	ROUTE_TEMPLATES                                                                    = API_V1_PREFIX + "/templates"
	ROUTE_TEMPLATES_ORDER                                                              = API_V1_PREFIX + "/templates/order"
	ROUTE_TEMPLATES_BY_KEY_PUBLISH                                                     = API_V1_PREFIX + "/templates/{key}/publish"
	ROUTE_TEMPLATES_BY_KEY                                                             = API_V1_PREFIX + "/templates/{key}"
	ROUTE_PROTO_TEMPLATES                                                              = API_V1_PREFIX + "/proto-templates"
	ROUTE_PROTO_TEMPLATES_BY_ID_INSTALL                                                = API_V1_PREFIX + "/proto-templates/{id}/install"
	ROUTE_PROTO_TEMPLATES_BY_ID                                                        = API_V1_PREFIX + "/proto-templates/{id}"
	ROUTE_AGENT_RUNTIMES_BY_ID_STATUS                                                  = API_V1_PREFIX + "/agent-runtimes/{id}/status"
	ROUTE_AGENT_RUNTIMES                                                               = API_V1_PREFIX + "/agent-runtimes"
	ROUTE_AGENT_RUNTIMES_BY_ID                                                         = API_V1_PREFIX + "/agent-runtimes/{id}"
	ROUTE_WORKITEMS                                                                    = API_V1_PREFIX + "/workitems"
	ROUTE_WORKITEM_PLATFORMS                                                           = API_V1_PREFIX + "/workitem-platforms"
	ROUTE_WORKITEMS_BY_ID                                                              = API_V1_PREFIX + "/workitems/{id}"
	ROUTE_WORKITEMS_BY_ID_STATUS                                                       = API_V1_PREFIX + "/workitems/{id}/status"
	ROUTE_WORKITEMS_BY_ID_ASSIGNEE                                                     = API_V1_PREFIX + "/workitems/{id}/assignee"
	ROUTE_WORKITEMS_BY_ID_DOC_LINKS                                                    = API_V1_PREFIX + "/workitems/{id}/doc-links"
	ROUTE_WORKITEMS_BY_ID_DOC_LINKS_BY_ITEM_ID                                         = API_V1_PREFIX + "/workitems/{id}/doc-links/{itemId}"
	ROUTE_WORKITEMS_BY_ID_DESIGN_VERSIONS                                              = API_V1_PREFIX + "/workitems/{id}/design-versions"
	ROUTE_WORKITEMS_BY_ID_COMMITS                                                      = API_V1_PREFIX + "/workitems/{id}/commits"
	ROUTE_WORKSPACES_BY_ID_WORKITEMS_WITH_DESIGN_ITEMS                                 = API_V1_PREFIX + "/workspaces/{id}/workitems-with-design-items"
	ROUTE_REVIEW_REVIEW                                                                = API_V1_PREFIX + "/review/review"
	ROUTE_AUDIT_EVENTS                                                                 = API_V1_PREFIX + "/audit/events"
	ROUTE_ORCHESTRATOR_SESSIONS                                                        = API_V1_PREFIX + "/orchestrator/sessions"
	ROUTE_ORCHESTRATOR_PRODUCT_FLOW                                                    = API_V1_PREFIX + "/orchestrator/product-flow"
	ROUTE_POST_AGENT_REVIEWS_REPORTS                                                   = http.MethodPost + " " + API_V1_PREFIX + "/agent-reviews/reports"
	ROUTE_GET_AGENT_REVIEWS_REPORTS                                                    = http.MethodGet + " " + API_V1_PREFIX + "/agent-reviews/reports"
	ROUTE_GET_AGENT_REVIEWS_REPORTS_BY_ID                                              = http.MethodGet + " " + API_V1_PREFIX + "/agent-reviews/reports/{id}"
	ROUTE_PATCH_AGENT_REVIEWS_REPORTS_BY_ID_ISSUES_BY_ISSUE_ID                         = http.MethodPatch + " " + API_V1_PREFIX + "/agent-reviews/reports/{id}/issues/{issueId}"
	ROUTE_GET_NOTIFICATIONS                                                            = http.MethodGet + " " + API_V1_PREFIX + "/notifications"
	ROUTE_POST_NOTIFICATIONS_ALL_READ                                                  = http.MethodPost + " " + API_V1_PREFIX + "/notifications/all-read"
	ROUTE_PATCH_NOTIFICATIONS_BY_ID_READ                                               = http.MethodPatch + " " + API_V1_PREFIX + "/notifications/{id}/read"
	ROUTE_POST_NOTIFICATIONS_BY_ID_ACTION                                              = http.MethodPost + " " + API_V1_PREFIX + "/notifications/{id}/action"
	ROUTE_GET_PROCESSES                                                                = http.MethodGet + " " + API_V1_PREFIX + "/processes"
	ROUTE_GET_PROCESSES_BY_ID                                                          = http.MethodGet + " " + API_V1_PREFIX + "/processes/{id}"
	ROUTE_GET_PROCESSES_ACTIVE_CHECK                                                   = http.MethodGet + " " + API_V1_PREFIX + "/processes/active-check"
	ROUTE_POST_PROCESSES                                                               = http.MethodPost + " " + API_V1_PREFIX + "/processes"
	ROUTE_PATCH_PROCESSES_BY_ID_STAGES_BY_STAGE_NAME                                   = http.MethodPatch + " " + API_V1_PREFIX + "/processes/{id}/stages/{stageName}"
	ROUTE_POST_PROCESSES_BY_ID_DELIVERABLES_SHARE                                      = http.MethodPost + " " + API_V1_PREFIX + "/processes/{id}/deliverables/share"
	ROUTE_STATS_SUMMARY                                                                = API_V1_PREFIX + "/stats/summary"
	ROUTE_STATS_TREND                                                                  = API_V1_PREFIX + "/stats/trend"
	ROUTE_STATS_COMMITS                                                                = API_V1_PREFIX + "/stats/commits"
	ROUTE_STATS_TRAILS                                                                 = API_V1_PREFIX + "/stats/trails"
	ROUTE_STATS_TRAILS_BY_SESSION_ID_MESSAGES                                          = API_V1_PREFIX + "/stats/trails/{sessionId}/messages"
	ROUTE_STATS_REQUIREMENTS                                                           = API_V1_PREFIX + "/stats/requirements"
	ROUTE_COMMANDS                                                                     = API_V1_PREFIX + "/commands"
	ROUTE_COMMANDS_BY_CMD                                                              = API_V1_PREFIX + "/commands/{cmd}"
	ROUTE_FEATURE_FLAGS                                                                = API_V1_PREFIX + "/platform/feature-flags"
	ROUTE_FEATURE_FLAGS_BY_KEY                                                         = API_V1_PREFIX + "/platform/feature-flags/{key}"
	ROUTE_PERSONAL_ASSISTANTS                                                          = API_V1_PREFIX + "/personal-assistants"
	ROUTE_PERSONAL_ASSISTANTS_BY_ID                                                    = API_V1_PREFIX + "/personal-assistants/{id}"
	ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS                                           = API_V1_PREFIX + "/personal-assistants/{id}/sessions"
	ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS_BY_SESSION_ID                             = API_V1_PREFIX + "/personal-assistants/{id}/sessions/{sessionId}"
	ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS_BY_SESSION_ID_MESSAGES                    = API_V1_PREFIX + "/personal-assistants/{id}/sessions/{sessionId}/messages"
	ROUTE_WS_PERSONAL_ASSISTANT_BY_ASSISTANT_ID_SESSIONS_BY_SESSION_ID                 = WS_V1_PREFIX + "/personal-assistant/{assistantId}/sessions/{sessionId}"
	ROUTE_WORKSPACES_MINE                                                              = API_V1_PREFIX + "/workspaces/mine"
	ROUTE_WORKSPACES                                                                   = API_V1_PREFIX + "/workspaces"
	ROUTE_WORKSPACES_BY_ID                                                             = API_V1_PREFIX + "/workspaces/{id}"
	ROUTE_WORKSPACES_BY_ID_MEMBERS                                                     = API_V1_PREFIX + "/workspaces/{id}/members"
	ROUTE_WORKSPACES_BY_ID_MEMBERS_BY_USER_ID                                          = API_V1_PREFIX + "/workspaces/{id}/members/{userId}"
	ROUTE_WORKSPACES_BY_ID_WORKITEM_PROJECT                                            = API_V1_PREFIX + "/workspaces/{id}/workitem-project"
	ROUTE_WORKSPACES_BY_ID_CRAWLER_SESSIONS                                            = API_V1_PREFIX + "/workspaces/{id}/crawler-sessions"
	ROUTE_WORKSPACES_BY_ID_CRAWLER_SESSIONS_BY_DOMAIN                                  = API_V1_PREFIX + "/workspaces/{id}/crawler-sessions/{domain}"
	ROUTE_AGENT_TYPES                                                                  = API_V1_PREFIX + "/agent-types"
	ROUTE_AGENT_TYPES_BY_KEY                                                           = API_V1_PREFIX + "/agent-types/{key}"
	ROUTE_AGENT_MODELS                                                                 = API_V1_PREFIX + "/agent-models"
	ROUTE_WORKSPACES_BY_ID_AGENTS                                                      = API_V1_PREFIX + "/workspaces/{id}/agents"
	ROUTE_WORKSPACES_BY_ID_AGENT_CONFIGS                                               = API_V1_PREFIX + "/workspaces/{id}/agent-configs"
	ROUTE_WORKSPACES_BY_ID_AGENT_CONFIGS_BY_KEY                                        = API_V1_PREFIX + "/workspaces/{id}/agent-configs/{key}"
	ROUTE_WORKSPACES_BY_ID_AVAILABLE_AGENTS                                            = API_V1_PREFIX + "/workspaces/{id}/available-agents"
	ROUTE_WORKSPACES_BY_ID_STANDARDS                                                   = API_V1_PREFIX + "/workspaces/{id}/standards"
	ROUTE_WORKSPACES_BY_ID_STANDARDS_GENERATE                                          = API_V1_PREFIX + "/workspaces/{id}/standards/generate"
	ROUTE_WORKSPACES_BY_ID_STANDARDS_BY_STANDARD_ID                                    = API_V1_PREFIX + "/workspaces/{id}/standards/{standardId}"
	ROUTE_WORKSPACES_BY_ID_CICD                                                        = API_V1_PREFIX + "/workspaces/{id}/cicd"
	ROUTE_CICD_CONFIGS                                                                 = API_V1_PREFIX + "/cicd-configs"
	ROUTE_CICD_CONFIGS_BY_ID                                                           = API_V1_PREFIX + "/cicd-configs/{id}"
	ROUTE_WORKSPACES_BY_ID_PROMPTS                                                     = API_V1_PREFIX + "/workspaces/{id}/prompts"
	ROUTE_WORKSPACES_BY_ID_PROMPTS_BY_PROMPT_ID                                        = API_V1_PREFIX + "/workspaces/{id}/prompts/{promptId}"
	ROUTE_WORKSPACES_BY_ID_PROMPTS_BY_PROMPT_ID_BY_ACTION                              = API_V1_PREFIX + "/workspaces/{id}/prompts/{promptId}/{action}"
	ROUTE_WORKSPACES_BY_ID_PROMPT_CATEGORIES                                           = API_V1_PREFIX + "/workspaces/{id}/prompt-categories"
	ROUTE_WORKSPACES_BY_ID_PROMPT_CATEGORIES_BY_CATEGORY_ID                            = API_V1_PREFIX + "/workspaces/{id}/prompt-categories/{categoryId}"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES                                                = API_V1_PREFIX + "/workspaces/{id}/repositories"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_SCAN                                           = API_V1_PREFIX + "/workspaces/{id}/repositories/scan"
	ROUTE_WORKSPACES_BY_ID_ARCH_GRAPH                                                  = API_V1_PREFIX + "/workspaces/{id}/arch/graph"
	ROUTE_WORKSPACES_BY_ID_USER_REPOS                                                  = API_V1_PREFIX + "/workspaces/{id}/user-repos"
	ROUTE_WORKSPACES_BY_ID_USER_REPOS_BY_REPO_ID_SYNC                                  = API_V1_PREFIX + "/workspaces/{id}/user-repos/{repoId}/sync"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID                                     = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STANDARD_FILES                      = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/standard-files"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STANDARD_FILES_INIT                 = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/standard-files/init"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SYNC                                = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/sync"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_DETAILS                             = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/details"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_BRANCHES                            = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/branches"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_BRANCHES_REFRESH                    = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/branches/refresh"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SWITCH_BRANCH                       = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/switch-branch"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_TREE                                = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/tree"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_CONTENT                             = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/content"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SAVE                                = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/save"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_COMMIT                              = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/commit"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STATUS                              = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/status"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_REMOTE                              = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/remote"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_PUSH                                = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/push"
	ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_UNPUSHED                            = API_V1_PREFIX + "/workspaces/{id}/repositories/{repoId}/unpushed"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS                                                = API_V1_PREFIX + "/workspaces/{id}/product-docs"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID                                      = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS                             = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/versions"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_VERSIONS                                        = API_V1_PREFIX + "/workspaces/{id}/product-doc-versions"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS_BY_VERSION                  = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/versions/{version}"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS_BY_VERSION_RESTORE          = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/versions/{version}/restore"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_PUBLISH                              = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/publish"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_FOLDERS                                         = API_V1_PREFIX + "/workspaces/{id}/product-doc-folders"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_FOLDERS_BY_FOLDER_ID                            = API_V1_PREFIX + "/workspaces/{id}/product-doc-folders/{folderId}"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE                                = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/share"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_MATERIALIZE                          = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/materialize"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE_COMMENTS                       = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/share-comments"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE_COMMENTS_BY_COMMENT_ID_RESOLVE = API_V1_PREFIX + "/workspaces/{id}/product-docs/{docId}/share-comments/{commentId}/resolve"
	ROUTE_SHARES_BY_TOKEN                                                              = API_V1_PREFIX + "/shares/{token}"
	ROUTE_SHARES_BY_TOKEN_COMMENTS                                                     = API_V1_PREFIX + "/shares/{token}/comments"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_TREE                                          = API_V1_PREFIX + "/workspaces/{id}/product-space/tree"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS                                         = API_V1_PREFIX + "/workspaces/{id}/product-space/items"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID                              = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_CONTENT                      = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}/content"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_VERSIONS                     = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}/versions"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_VERSIONS_BY_VERSION_RESTORE  = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}/versions/{version}/restore"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_DOWNLOAD                     = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}/download"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_COMMENTS                     = API_V1_PREFIX + "/workspaces/{id}/product-space/items/{itemId}/comments"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_FOLDERS                                       = API_V1_PREFIX + "/workspaces/{id}/product-space/folders"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_PROTOTYPE                              = API_V1_PREFIX + "/workspaces/{id}/product-space/import-prototype"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_DOC                                    = API_V1_PREFIX + "/workspaces/{id}/product-space/import-doc"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_DOC_STATUS                             = API_V1_PREFIX + "/workspaces/{id}/product-space/import-doc/status"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_SERVE_BY_PATH                                 = API_V1_PREFIX + "/workspaces/{id}/product-space/serve/{path...}"
	ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_SHARE                                         = API_V1_PREFIX + "/workspaces/{id}/product-space/share"
	ROUTE_PROTOTYPE_SHARES_BY_TOKEN                                                    = API_V1_PREFIX + "/prototype-shares/{token}"
	ROUTE_PROTOTYPE_SHARES_BY_TOKEN_FILES_BY_PATH                                      = API_V1_PREFIX + "/prototype-shares/{token}/files/{path...}"
	ROUTE_PROTOTYPE_SHARES_BY_TOKEN_PAGES_BY_ITEM_ID_COMMENTS                          = API_V1_PREFIX + "/prototype-shares/{token}/pages/{itemId}/comments"
	ROUTE_WORKSPACES_BY_ID_REQUIREMENT_SHARES                                          = API_V1_PREFIX + "/workspaces/{id}/requirement-shares"
	ROUTE_GET_WORKSPACES_BY_ID_REQUIREMENT_SHARES_VIEW                                 = http.MethodGet + " " + API_V1_PREFIX + "/workspaces/{id}/requirement-shares/view"
	ROUTE_REQUIREMENT_SHARES_BY_TOKEN                                                  = API_V1_PREFIX + "/requirement-shares/{token}"
	ROUTE_REQUIREMENT_SHARES_BY_TOKEN_FILES_BY_PATH                                    = API_V1_PREFIX + "/requirement-shares/{token}/files/{path...}"
	ROUTE_REQUIREMENT_SHARES_BY_TOKEN_PAGES_BY_ITEM_ID_COMMENTS                        = API_V1_PREFIX + "/requirement-shares/{token}/pages/{itemId}/comments"
	ROUTE_REQUIREMENT_SHARES_BY_TOKEN_DOC_COMMENTS                                     = API_V1_PREFIX + "/requirement-shares/{token}/doc-comments"
	ROUTE_TEAM_SKILLS                                                                  = API_V1_PREFIX + "/team/skills"
	ROUTE_TEAM_SKILLS_BY_ID                                                            = API_V1_PREFIX + "/team/skills/{id}"
	ROUTE_TEAM_SKILLS_BY_ID_REVIEW                                                     = API_V1_PREFIX + "/team/skills/{id}/review"
	ROUTE_TEAM_SKILLS_BY_ID_CATEGORIES                                                 = API_V1_PREFIX + "/team/skills/{id}/categories"
	ROUTE_TEAM_SKILL_CATEGORIES                                                        = API_V1_PREFIX + "/team/skill-categories"
	ROUTE_TEAM_SKILL_CATEGORIES_BY_ID                                                  = API_V1_PREFIX + "/team/skill-categories/{id}"
	ROUTE_TEAM_PROMPTS                                                                 = API_V1_PREFIX + "/team/prompts"
	ROUTE_TEAM_PROMPTS_BY_ID                                                           = API_V1_PREFIX + "/team/prompts/{id}"
	ROUTE_TEAM_PROMPTS_BY_ID_REVIEW                                                    = API_V1_PREFIX + "/team/prompts/{id}/review"
	ROUTE_TEAM_PROMPTS_BY_ID_CATEGORIES                                                = API_V1_PREFIX + "/team/prompts/{id}/categories"
	ROUTE_TEAM_PROMPTS_BY_ID_USE                                                       = API_V1_PREFIX + "/team/prompts/{id}/use"
	ROUTE_TEAM_PROMPT_CATEGORIES                                                       = API_V1_PREFIX + "/team/prompt-categories"
	ROUTE_TEAM_PROMPT_CATEGORIES_BY_ID                                                 = API_V1_PREFIX + "/team/prompt-categories/{id}"
	ROUTE_TEAM_SKILLS_STATS                                                            = API_V1_PREFIX + "/team/skills/stats"
	ROUTE_TEAM_PROMPTS_STATS                                                           = API_V1_PREFIX + "/team/prompts/stats"
	ROUTE_FEISHU_WEBHOOK                                                               = API_V1_PREFIX + "/feishu/webhook"
	ROUTE_FEISHU_BINDINGS                                                              = API_V1_PREFIX + "/feishu/bindings"
	ROUTE_FEISHU_CHAT_SESSIONS                                                         = API_V1_PREFIX + "/feishu/chat-sessions"
	ROUTE_WORKSPACES_BY_ID_AGENT_STATUS                                                = API_V1_PREFIX + "/workspaces/{id}/agent-status"
)

var (
	defaultAgentConfigService agentconfigservice.AgentConfigService
	productSpaceService       psService.ProductSpaceService
)

// workItemDocLinkerAdapter 将 workitemservice.WorkItemService 适配为 productspace.WorkItemDocLinker，
// 使 productspace handler 只依赖最小接口，避免 productspace 包反向依赖 workitem/object。
type workItemDocLinkerAdapter struct {
	svc workitemservice.WorkItemService
}

func (a *workItemDocLinkerAdapter) GetWorkItem(ctx context.Context, workspaceID, workitemID string) (sdkworkitem.WorkItem, error) {
	return a.svc.GetWorkItem(workitemID)
}

func (a *workItemDocLinkerAdapter) CreateDocLink(ctx context.Context, req psHandler.CreateDocLinkRequest) error {
	_, err := a.svc.CreateDocLink(req.WorkitemID, workitemobject.CreateDocLinkRequest{
		ProductSpaceItemID: req.ProductSpaceItemID,
		WorkspaceID:        req.WorkspaceID,
		ItemType:           req.ItemType,
	})
	return err
}

func (a *workItemDocLinkerAdapter) CreateDesignVersion(ctx context.Context, workspaceID, workitemID, changeSummary string) (sdkworkitem.WorkItem, error) {
	_, err := a.svc.CreateDesignVersion(workitemID, workspaceID, "", changeSummary)
	if err != nil {
		return sdkworkitem.WorkItem{}, err
	}
	return a.svc.GetWorkItem(workitemID)
}

func New(cfg config.Config) (http.Handler, func()) {
	mux := http.NewServeMux()

	// Shared DB connection (if available)
	db := initDB(cfg)

	// Infrastructure layer: PostgreSQL storage.
	sessions := session.NewPostgresStore(db)
	messages := session.NewPostgresStore(db)
	log.Println("[Chat] using postgres storage")
	// Business logic layer
	agentClient := client.NewGatewaydClient(cfg.GatewaydAdminURL, cfg.GatewaydAgentID)

	userService := initIdentityService(db)
	initPersonalAssistantService(db)
	workItemSvc := initWorkItemService(db)
	initReviewService(db)
	initEventService(db)
	initOrchestratorService(db)
	initAgentReviewService(db)
	notificationSvc := initNotificationService(db)
	initProcessService(db)
	orch := initDevReviewOrchestrator(db, cfg, workItemSvc, notificationSvc, sessions, messages)
	productFlowHandler := &devorchestrator.ProductFlowHandler{Orchestrator: orch, WorkspaceRoot: cfg.WorkspaceRoot, UserService: userService}
	workspaceService := initWorkspaceService(db, cfg.WorkspaceRoot, userService, cfg.CodingAgents)
	initProductSpaceService(db, cfg, workspaceService)
	initAgentConfigService(db, cfg.CodingAgents, cfg.CodingAgentModels, cfg.CodingAgentModelVendors)
	initWorkspacePromptService(db)
	initRepositoryService(db, cfg)
	productdocHandler := initProductDocService(db, cfg.WorkspaceRoot)
	workspaceHandler := workspace.NewHandler(workspaceService, workspaceService, workspaceService, workspaceService, workspaceService, workspaceService, workspaceService, workspaceService, userService)
	initPlatformTemplateService(db)
	initPrototypeTemplateService(db, cfg.WorkspaceRoot)
	// 注入功能开关 DB 连接，供 comet_flow 开关运行时读取与后台管理。
	handler.SetFeatureFlagDB(db)
	// 注入指令 DB 存储与超管校验，供指令 CRUD 管理使用。
	handler.SetCommandStore(handler.NewCommandStore(db))
	handler.SetSuperAdminChecker(identity.RequireSuperAdmin)
	agentRuntimeSvc := initAgentRuntimeService(db, cfg.WorkspaceRoot)

	prov, err := provisioner.NewProvisioner(cfg.AgentProvisioner)
	if err != nil {
		log.Fatalf("[provisioner] failed to create provisioner: %v", err)
	}

	// direct-host 模式：注入 workspace 解析器，供 Manager 启动 per-user 进程时补全 workspaceID。
	if dm, ok := prov.(*directhost.Manager); ok {
		dm.SetWorkspaceResolver(func(userID string) string {
			var wsID string
			_ = db.QueryRow("SELECT workspace_id FROM workspace_members WHERE user_id = $1 LIMIT 1", userID).Scan(&wsID)
			return wsID
		})
		// personal-stub 存活巡检：进程死亡或僵死时自动重启（nil = 随进程生命周期持续运行）。
		dm.StartReconcileLoop(nil)
	}
	agentStatusTracker := provisioner.NewStatusTracker()
	agentController := provisioner.NewController(prov, cfg.AgentProvisioner)
	agentStatusHandler := handler.NewAgentStatusHandler(prov, agentStatusTracker)
	agentController.Start(context.Background())

	// 容器池：管理 per-user 容器（gatewayd + personal-stub）的分配与释放。
	// direct-host 模式使用固定 IP 列表；k8s / self-defined 模式通过 AgentProvisioner 委托管理。
	containerPool, err := provisioner.NewContainerPool(cfg.AgentProvisioner, prov)
	if err != nil {
		log.Fatalf("[container-pool] failed to create pool: %v", err)
	}
	log.Printf("[container-pool] type=%s", cfg.AgentProvisioner.Type)

	// 注入 auth 中间件的 userID 提取函数，供 ContainerMiddleware 使用。
	provisioner.SetMiddlewareUserIDFunc(func(ctx context.Context) string {
		uid, _ := middleware.UserIDFromContext(ctx)
		return uid
	})

	initTeamService(db, userService)
	initFeishuService(db, cfg, sessions, messages)

	// Crawler cookie 服务：按 workspace + domain 持久化浏览器 cookie，供 /prd-research 使用。
	crawlerCookieSvc := crawlerservice.NewCrawlerCookieService(cfg.WorkspaceRoot)
	crawlerHandler := crawlerhandler.NewCrawlerHandler(crawlerCookieSvc)

	// Handlers
	// 根据 buffer_store_type 配置选择 SSE buffer 后端：memory（默认）或 redis。
	// Redis 支持单节点和 Cluster 模式，生产环境推荐使用 Redis 以支持崩溃恢复。
	var sseBuffer buffer.SSEBuffer
	switch cfg.BufferStoreType {
	case "redis":
		var redisOpts []redisbuffer.Option
		if cfg.RedisPrefix != "" {
			redisOpts = append(redisOpts, redisbuffer.WithKeyPrefix(cfg.RedisPrefix))
		}
		sseBuffer = redisbuffer.NewFromOptions(cfg.RedisAddrs, cfg.RedisPassword, cfg.RedisDB, redisOpts...)
		log.Printf("[Server] using Redis SSE buffer, addrs=%v prefix=%s", cfg.RedisAddrs, cfg.RedisPrefix)
	default:
		sseBuffer = memory.New()
		log.Printf("[Server] using in-memory SSE buffer")
	}
	sessionHandler := handler.NewSessionHandler(sessions, messages, agentClient, workspaceService, defaultAgentConfigService, cfg, sseBuffer)
	// 为 agentconfig 模块注入会话存储与 gatewayd 客户端，用于配置保存后向运行时同步。
	agentconfig.InitRuntimeSync(sessions, agentClient)
	// 注入配置文件中启用的需求管理平台列表，供空间设置的平台下拉框读取。
	workitem.InitPlatforms(cfg.WorkitemPlatformWhitelist)
	aguiHandler := handler.NewAGUIHandler(cfg.GatewaydAdminURL, cfg.GatewaydAgentID, cfg.WorkspaceRoot, sessions, messages, sseBuffer, workItemSvc, crawlerCookieSvc, cfg.CrawlerServiceURL, cfg.CrawlerServiceTimeout, cfg.CrawlerMCPName)
	// 注入空间级智能体配置服务，确保每次 agent run attach 后都能同步模型/看门狗配置，
	// 避免 gatewayd 重启后复用旧会话时回退到默认 120s watchdog。
	aguiHandler.SetAgentConfigService(defaultAgentConfigService)
	// 为 workspace 模块注入同步补全能力，用于规范的智能生成。
	// 规范生成不绑定特定 agent，使用默认 pluginKey（agentKey 传空）。
	workspace.InitStandardCompleter(func(ctx context.Context, prompt string) (string, error) {
		return aguiHandler.QuickComplete(ctx, prompt, "")
	})
	sseReplayHandler := handler.NewSSEReplayHandler(sseBuffer)
	statsHandler := handler.NewStatsHandler(sessions, messages, cfg.WorkspaceRoot, workspaceService, workItemSvc)

	// personal-stub 反向代理：将文件/工程/预览请求转发到 personal-stub 服务。
	// personal-stub 部署在 WORKSPACE_ROOT 所在服务器上，直接操作文件系统和 git。
	stubProxy := handler.NewStubProxy(cfg.PersonalStubURL)

	// 初始化全局 stubclient，供各 domain service 委托 personal-stub 执行文件/git 操作。
	// 架构合规：dh-backend 不直接写共享目录、不直接 exec git/npm，全部通过 stubclient 代理。
	// 注意：全局 Default 仅作为降级 fallback；per-user 请求通过 ContainerMiddleware 注入
	// 指向用户容器的 stubclient 到 context 中。
	stubclient.SetDefault(stubclient.New(cfg.PersonalStubURL))

	// containerMiddleware 为每个已认证请求解析用户容器，并注入 ContainerInfo + stubclient 到 context。
	// 顺序：Auth（注入 userID）-> Container（分配容器 + 注入 context）-> Handler。
	// 1:N 模式下，还会通过 personal-stub health 端点发现 gatewayd 端口并更新 ContainerInfo。
	containerMW := func(next http.Handler) http.Handler {
		return middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, _ := middleware.UserIDFromContext(r.Context())
			if userID == "" {
				next.ServeHTTP(w, r)
				return
			}
			container, err := containerPool.Acquire(r.Context(), userID)
			if err != nil {
				if errors.Is(err, provisioner.ErrPoolExhausted) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"code":503,"message":"当前服务器资源紧缺，请联系管理员"}`))
					return
				}
				log.Printf("[container-pool] acquire failed for user=%s: %v", userID, err)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"code":500,"message":"container pool error"}`))
				return
			}
			// 1:N 模式下通过 personal-stub health 端点发现 gatewayd 端口。
			container = discoverGatewaydPorts(r.Context(), container, userID)
			ctx := provisioner.WithContainer(r.Context(), container)
			ctx = stubclient.WithClient(ctx, stubclient.New(container.PersonalStubURL()))
			next.ServeHTTP(w, r.WithContext(ctx))
		}))
	}

	// 启动文档采纳源文件清理任务：超过 retention_days 的源草稿文件由 personal-stub 删除。
	// 必须在 stubclient 初始化之后启动，否则首次扫描无法委托删除。
	var cleanupStop func()
	if cfg.DocAdoptionCleanupEnabled {
		cleanupStop = productSpaceService.StartDocAdoptionCleanupTask(context.Background(), cfg.DocAdoptionCleanupInterval, cfg.DocAdoptionCleanupRetentionDays)
	} else {
		log.Println("[ProductSpace] doc adoption cleanup disabled by config")
		cleanupStop = func() {}
	}

	// Routes
	mux.HandleFunc(ROUTE_HEALTH, handler.HealthCheck)
	// agent run 需要登录态 + 容器分配，以解析 per-user gatewayd 地址。
	mux.Handle(ROUTE_AGENT, containerMW(http.HandlerFunc(aguiHandler.AgentRun)))
	mux.Handle(ROUTE_AGENT_RESPOND, containerMW(http.HandlerFunc(aguiHandler.RespondToAgent)))
	// 会话创建、删除、消息查询均需登录态：handler 内 UserIDFromContext 依赖 auth 中间件注入的 userID
	// 会话创建走 containerMW：containerMW 内含 Auth，并为请求注入 per-user ContainerInfo + stubclient，
	// 使 ensureWorkspaceDir 能路由到用户专属 stub 而非 default slot 0（修复 slot 0 未启动时 500）。
	mux.Handle(ROUTE_SESSIONS, containerMW(http.HandlerFunc(sessionHandler.Sessions)))
	mux.Handle(ROUTE_SESSIONS_BY_ID, middleware.Auth(http.HandlerFunc(sessionHandler.DeleteSession)))
	mux.Handle(ROUTE_SESSIONS_BY_ID_MESSAGES, middleware.Auth(http.HandlerFunc(sessionHandler.GetMessages)))
	mux.HandleFunc(ROUTE_SESSIONS_BY_ID_SSE, sseReplayHandler.ServeSSE)
	mux.HandleFunc(ROUTE_HELLO, handler.Hello)

	// 文件/工程/预览 → 代理到 personal-stub
	mux.Handle(ROUTE_FILES, containerMW(stubProxy))
	mux.Handle(ROUTE_PROJECTS, containerMW(stubProxy))
	mux.Handle(ROUTE_PREVIEW, containerMW(stubProxy))

	// gatewayd 代理：将前端 chat/ws 请求通过 dh-backend 转发到用户专属 gatewayd 实例
	gatewaydProxy := handler.NewGatewaydProxy(sessions, agentRuntimeSvc, cfg.GatewaydAdminURL)
	mux.Handle(ROUTE_POST_SESSIONS_BY_ID_CHAT, containerMW(gatewaydProxy))
	mux.Handle(ROUTE_GET_SESSIONS_BY_ID_WS, containerMW(gatewaydProxy))

	// Internal business modules
	mux.HandleFunc(ROUTE_IDENTITY_USERS, identity.Users)
	mux.Handle(ROUTE_IDENTITY_USERS_ME, middleware.Auth(http.HandlerFunc(identity.Me)))
	mux.Handle(ROUTE_IDENTITY_USERS_ME_PROFILE, middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			identity.GetProfile(w, r)
		case http.MethodPut, http.MethodPost:
			identity.SaveProfile(w, r)
		default:
			handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		}
	})))
	mux.HandleFunc(ROUTE_IDENTITY_LOGIN, identity.Login)

	// 租户管理（仅超级管理员）
	mux.Handle(ROUTE_TENANTS, middleware.Auth(http.HandlerFunc(identity.Tenants)))
	mux.Handle(ROUTE_TENANTS_BY_ID, middleware.Auth(http.HandlerFunc(identity.TenantByID)))
	mux.Handle(ROUTE_TENANTS_BY_ID_MEMBERS, middleware.Auth(http.HandlerFunc(identity.TenantMembers)))
	mux.Handle(ROUTE_TENANTS_BY_ID_MEMBERS_BY_USER_ID, middleware.Auth(http.HandlerFunc(identity.TenantMemberByID)))

	// 平台模板：GET 列表已登录即可访问（按角色过滤可见范围），写操作仍需超级管理员
	mux.Handle(ROUTE_TEMPLATES, middleware.Auth(http.HandlerFunc(platformtemplate.Templates)))
	mux.Handle(ROUTE_TEMPLATES_ORDER, middleware.Auth(http.HandlerFunc(platformtemplate.TemplatesOrder)))
	mux.Handle(ROUTE_TEMPLATES_BY_KEY_PUBLISH, middleware.Auth(http.HandlerFunc(platformtemplate.TemplatePublish)))
	mux.Handle(ROUTE_TEMPLATES_BY_KEY, middleware.Auth(http.HandlerFunc(platformtemplate.TemplateByKey)))

	// 原型工程模版：仅超级管理员可上传/安装/管理，供 /proto-make 按场景描述自动选用
	mux.Handle(ROUTE_PROTO_TEMPLATES, middleware.Auth(http.HandlerFunc(prototypetemplate.Templates)))
	mux.Handle(ROUTE_PROTO_TEMPLATES_BY_ID_INSTALL, middleware.Auth(http.HandlerFunc(prototypetemplate.TemplateInstall)))
	mux.Handle(ROUTE_PROTO_TEMPLATES_BY_ID, middleware.Auth(http.HandlerFunc(prototypetemplate.TemplateByID)))

	// Agent 运行时：外部 gatewayd / personal-stub 通过固定 Bearer Token 上报状态；列表/详情超级管理员可看全部，普通用户仅可看自己的运行时
	mux.Handle(ROUTE_AGENT_RUNTIMES_BY_ID_STATUS, middleware.BearerAuth(cfg.AgentRuntimeBearerToken)(http.HandlerFunc(agentruntime.ReportStatus)))
	mux.Handle(ROUTE_AGENT_RUNTIMES, middleware.Auth(http.HandlerFunc(agentruntime.ListRuntimes)))
	mux.Handle(ROUTE_AGENT_RUNTIMES_BY_ID, middleware.Auth(http.HandlerFunc(agentruntime.GetRuntime)))

	// 工作项：需登录态，按 workspaceId 隔离
	mux.Handle(ROUTE_WORKITEMS, middleware.Auth(http.HandlerFunc(workitem.WorkItems)))
	mux.Handle(ROUTE_WORKITEM_PLATFORMS, middleware.Auth(http.HandlerFunc(workitem.Platforms)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID, middleware.Auth(http.HandlerFunc(workitem.WorkItemByID)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_STATUS, middleware.Auth(http.HandlerFunc(workitem.UpdateWorkItemStatus)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_ASSIGNEE, middleware.Auth(http.HandlerFunc(workitem.UpdateWorkItemAssignee)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_DOC_LINKS, middleware.Auth(http.HandlerFunc(workitem.DocLinks)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_DOC_LINKS_BY_ITEM_ID, middleware.Auth(http.HandlerFunc(workitem.DocLinkByID)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_DESIGN_VERSIONS, middleware.Auth(http.HandlerFunc(workitem.ListDesignVersions)))
	mux.Handle(ROUTE_WORKITEMS_BY_ID_COMMITS, middleware.Auth(http.HandlerFunc(workitem.WorkItemCommits)))
	// 按工作空间聚合需求及其关联的文档/原型，供智能会话「设计」按钮下拉菜单使用
	mux.Handle(ROUTE_WORKSPACES_BY_ID_WORKITEMS_WITH_DESIGN_ITEMS, middleware.Auth(http.HandlerFunc(workitem.ListRequirementsWithDesignItems)))
	mux.HandleFunc(ROUTE_REVIEW_REVIEW, pragent.Reviews)
	mux.HandleFunc(ROUTE_AUDIT_EVENTS, audit.Events)
	mux.HandleFunc(ROUTE_ORCHESTRATOR_SESSIONS, sessionmanager.Sessions)
	mux.Handle(ROUTE_ORCHESTRATOR_PRODUCT_FLOW, middleware.Auth(http.HandlerFunc(productFlowHandler.StartProductFlow)))
	// Agent Review 报告存储：采纳/查询/更新问题状态，需登录态，按 workspaceId 隔离
	mux.Handle(ROUTE_POST_AGENT_REVIEWS_REPORTS, middleware.Auth(http.HandlerFunc(agent_review.Adopt)))
	mux.Handle(ROUTE_GET_AGENT_REVIEWS_REPORTS, middleware.Auth(http.HandlerFunc(agent_review.ListReports)))
	mux.Handle(ROUTE_GET_AGENT_REVIEWS_REPORTS_BY_ID, middleware.Auth(http.HandlerFunc(agent_review.GetReport)))
	mux.Handle(ROUTE_PATCH_AGENT_REVIEWS_REPORTS_BY_ID_ISSUES_BY_ISSUE_ID, middleware.Auth(http.HandlerFunc(agent_review.UpdateIssueStatus)))
	// 通知系统：列出/标记已读/操作，需登录态
	mux.Handle(ROUTE_GET_NOTIFICATIONS, middleware.Auth(http.HandlerFunc(notification.List)))
	mux.Handle(ROUTE_POST_NOTIFICATIONS_ALL_READ, middleware.Auth(http.HandlerFunc(notification.MarkAllAsRead)))
	mux.Handle(ROUTE_PATCH_NOTIFICATIONS_BY_ID_READ, middleware.Auth(http.HandlerFunc(notification.MarkAsRead)))
	mux.Handle(ROUTE_POST_NOTIFICATIONS_BY_ID_ACTION, middleware.Auth(http.HandlerFunc(notification.Action)))
	// 流程追踪：列出/详情/创建/更新阶段
	mux.Handle(ROUTE_GET_PROCESSES, middleware.Auth(http.HandlerFunc(process.List)))
	mux.Handle(ROUTE_GET_PROCESSES_BY_ID, middleware.Auth(http.HandlerFunc(process.GetByID)))
	mux.Handle(ROUTE_GET_PROCESSES_ACTIVE_CHECK, middleware.Auth(http.HandlerFunc(process.ActiveCheck)))
	mux.Handle(ROUTE_POST_PROCESSES, middleware.Auth(http.HandlerFunc(process.Create)))
	mux.Handle(ROUTE_PATCH_PROCESSES_BY_ID_STAGES_BY_STAGE_NAME, middleware.Auth(http.HandlerFunc(process.UpdateStage)))
	// 数据大盘统计需登录并按 workspaceId 隔离
	mux.Handle(ROUTE_STATS_SUMMARY, middleware.Auth(http.HandlerFunc(statsHandler.Summary)))
	mux.Handle(ROUTE_STATS_TREND, middleware.Auth(http.HandlerFunc(statsHandler.Trend)))
	mux.Handle(ROUTE_STATS_COMMITS, middleware.Auth(http.HandlerFunc(statsHandler.CodeCommits)))
	mux.Handle(ROUTE_STATS_TRAILS, middleware.Auth(http.HandlerFunc(statsHandler.Trails)))
	mux.Handle(ROUTE_STATS_TRAILS_BY_SESSION_ID_MESSAGES, middleware.Auth(http.HandlerFunc(statsHandler.TrailMessages)))
	mux.Handle(ROUTE_STATS_REQUIREMENTS, middleware.Auth(http.HandlerFunc(statsHandler.WorkItemSummary)))
	mux.Handle(ROUTE_COMMANDS, middleware.Auth(http.HandlerFunc(handler.CommandsHandler)))
	mux.Handle(ROUTE_COMMANDS_BY_CMD, middleware.Auth(http.HandlerFunc(handler.CommandByCmdHandler)))
	// 平台级功能开关（如 comet 流程开关），供后台指令管理页切换。
	mux.Handle(ROUTE_FEATURE_FLAGS, middleware.Auth(http.HandlerFunc(handler.FeatureFlagsHandler)))
	mux.Handle(ROUTE_FEATURE_FLAGS_BY_KEY, middleware.Auth(http.HandlerFunc(handler.FeatureFlagByKeyHandler)))

	// Personal assistant module
	mux.HandleFunc(ROUTE_PERSONAL_ASSISTANTS, personalassistant.Assistants)
	mux.HandleFunc(ROUTE_PERSONAL_ASSISTANTS_BY_ID, personalassistant.AssistantByID)
	mux.HandleFunc(ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS, personalassistant.AssistantSessions)
	mux.HandleFunc(ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS_BY_SESSION_ID, personalassistant.DeleteSession)
	mux.HandleFunc(ROUTE_PERSONAL_ASSISTANTS_BY_ID_SESSIONS_BY_SESSION_ID_MESSAGES, personalassistant.GetMessages)
	mux.HandleFunc(ROUTE_WS_PERSONAL_ASSISTANT_BY_ASSISTANT_ID_SESSIONS_BY_SESSION_ID, personalassistant.WebSocket)

	// Workspace module
	// /workspaces/mine 需登录态，需在 /workspaces/{id} 之前注册以避免路径冲突。
	mux.Handle(ROUTE_WORKSPACES_MINE, middleware.Auth(http.HandlerFunc(workspaceHandler.Mine)))
	mux.Handle(ROUTE_WORKSPACES, middleware.Auth(http.HandlerFunc(workspaceHandler.Workspaces)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID, middleware.Auth(http.HandlerFunc(workspaceHandler.WorkspaceByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_MEMBERS, middleware.Auth(http.HandlerFunc(workspaceHandler.Members)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_MEMBERS_BY_USER_ID, middleware.Auth(http.HandlerFunc(workspaceHandler.MemberByID)))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_WORKITEM_PROJECT, workspaceHandler.WorkitemProject)
	mux.Handle(ROUTE_WORKSPACES_BY_ID_CRAWLER_SESSIONS, middleware.Auth(http.HandlerFunc(crawlerHandler.SaveCookies)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_CRAWLER_SESSIONS_BY_DOMAIN, middleware.Auth(http.HandlerFunc(crawlerHandler.GetCookies)))
	mux.Handle(ROUTE_AGENT_TYPES, middleware.Auth(http.HandlerFunc(agentconfig.AgentTypes)))
	mux.Handle(ROUTE_AGENT_TYPES_BY_KEY, middleware.Auth(http.HandlerFunc(agentconfig.AgentTypeByKey)))
	mux.Handle(ROUTE_AGENT_MODELS, middleware.Auth(http.HandlerFunc(agentconfig.AgentModels)))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_AGENTS, workspaceHandler.WorkspaceAgents)
	mux.Handle(ROUTE_WORKSPACES_BY_ID_AGENT_CONFIGS, middleware.Auth(http.HandlerFunc(agentconfig.WorkspaceAgentConfigs)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_AGENT_CONFIGS_BY_KEY, middleware.Auth(http.HandlerFunc(agentconfig.WorkspaceAgentConfigByKey)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_AVAILABLE_AGENTS, middleware.Auth(http.HandlerFunc(agentconfig.AvailableAgents)))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_STANDARDS, workspaceHandler.WorkspaceStandards)
	mux.Handle(ROUTE_WORKSPACES_BY_ID_STANDARDS_GENERATE, middleware.Auth(http.HandlerFunc(workspace.StandardGenerate)))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_STANDARDS_BY_STANDARD_ID, workspaceHandler.WorkspaceStandardByID)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_CICD, workspaceHandler.WorkspaceCICD)
	mux.Handle(ROUTE_CICD_CONFIGS, middleware.Auth(http.HandlerFunc(workspaceHandler.CICDConfigs)))
	mux.Handle(ROUTE_CICD_CONFIGS_BY_ID, middleware.Auth(http.HandlerFunc(workspaceHandler.CICDConfigByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PROMPTS, middleware.Auth(http.HandlerFunc(workspace.Prompts)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PROMPTS_BY_PROMPT_ID, middleware.Auth(http.HandlerFunc(workspace.PromptByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PROMPTS_BY_PROMPT_ID_BY_ACTION, middleware.Auth(http.HandlerFunc(workspace.PromptAction)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PROMPT_CATEGORIES, middleware.Auth(http.HandlerFunc(workspace.PromptCategories)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PROMPT_CATEGORIES_BY_CATEGORY_ID, middleware.Auth(http.HandlerFunc(workspace.PromptCategoryByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES, middleware.Auth(http.HandlerFunc(repository.Repositories)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_SCAN, middleware.Auth(http.HandlerFunc(repository.ScanRepositories)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_ARCH_GRAPH, containerMW(http.HandlerFunc(repository.ArchGraph)))
	// 用户级仓库操作（需登录态，userID 由 auth 中间件注入）
	mux.Handle(ROUTE_WORKSPACES_BY_ID_USER_REPOS, containerMW(http.HandlerFunc(repository.UserRepos)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_USER_REPOS_BY_REPO_ID_SYNC, containerMW(http.HandlerFunc(repository.SyncUserRepo)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID, middleware.Auth(http.HandlerFunc(repository.RepositoryByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STANDARD_FILES, middleware.Auth(http.HandlerFunc(repository.StandardFiles)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STANDARD_FILES_INIT, middleware.Auth(http.HandlerFunc(repository.StandardFilesInit)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SYNC, middleware.Auth(http.HandlerFunc(repository.SyncRepository)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_DETAILS, middleware.Auth(http.HandlerFunc(repository.RepositoryDetails)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_BRANCHES, middleware.Auth(http.HandlerFunc(repository.RepositoryBranches)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_BRANCHES_REFRESH, middleware.Auth(http.HandlerFunc(repository.RefreshBranches)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SWITCH_BRANCH, middleware.Auth(http.HandlerFunc(repository.SwitchBranch)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_TREE, middleware.Auth(http.HandlerFunc(repository.RepositoryFileTree)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_CONTENT, middleware.Auth(http.HandlerFunc(repository.RepositoryFileContent)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_SAVE, middleware.Auth(http.HandlerFunc(repository.SaveFileContent)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_COMMIT, middleware.Auth(http.HandlerFunc(repository.GitCommit)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_STATUS, middleware.Auth(http.HandlerFunc(repository.GitStatus)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_REMOTE, middleware.Auth(http.HandlerFunc(repository.SetRemoteURL)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_PUSH, middleware.Auth(http.HandlerFunc(repository.PushRepository)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REPOSITORIES_BY_REPO_ID_UNPUSHED, middleware.Auth(http.HandlerFunc(repository.UnpushedCommits)))

	// Product doc module
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS, productdocHandler.ProductDocs)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID, productdocHandler.ProductDocByID)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS, productdocHandler.ProductDocVersions)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_VERSIONS, productdocHandler.ProductDocWorkspaceVersions)
	// 版本写操作（备注编辑/删除/回滚）需登录态，userID 由 auth 中间件注入用于审计
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS_BY_VERSION, middleware.Auth(http.HandlerFunc(productdocHandler.ProductDocVersionByVersion)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_VERSIONS_BY_VERSION_RESTORE, middleware.Auth(http.HandlerFunc(productdocHandler.ProductDocVersionRestore)))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_PUBLISH, productdocHandler.PublishProductDoc)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_FOLDERS, productdocHandler.ProductDocFolders)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOC_FOLDERS_BY_FOLDER_ID, productdocHandler.ProductDocFolderByID)
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE, productdocHandler.ShareProductDoc)
	// 文档按需落盘需登录态：userID 决定 agent 工作目录下的落盘位置
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_MATERIALIZE, middleware.Auth(http.HandlerFunc(productdocHandler.MaterializeProductDoc)))
	// 分享批注管理（列表/解决）需登录态，userID 由 auth 中间件注入用于审计
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE_COMMENTS, middleware.Auth(http.HandlerFunc(productdocHandler.ProductDocShareComments)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_DOCS_BY_DOC_ID_SHARE_COMMENTS_BY_COMMENT_ID_RESOLVE, middleware.Auth(http.HandlerFunc(productdocHandler.ProductDocShareCommentResolve)))
	// 分享落地页公开接口：无需登录
	mux.HandleFunc(ROUTE_SHARES_BY_TOKEN, productdocHandler.SharedDoc)
	// 分享页批注公开接口：访客免登录查看/新增批注
	mux.HandleFunc(ROUTE_SHARES_BY_TOKEN_COMMENTS, productdocHandler.ShareDocComments)

	// Product space module
	psH := psHandler.NewHandler(productSpaceService, process.GetService(), &workItemDocLinkerAdapter{svc: workItemSvc})
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_TREE, containerMW(http.HandlerFunc(psH.GetTree)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS, containerMW(http.HandlerFunc(psH.CreateItem)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID, containerMW(http.HandlerFunc(psH.ItemByID)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_CONTENT, containerMW(http.HandlerFunc(psH.UpdateContent)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_VERSIONS, containerMW(http.HandlerFunc(psH.ListVersions)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_VERSIONS_BY_VERSION_RESTORE, containerMW(http.HandlerFunc(psH.RestoreVersion)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_DOWNLOAD, containerMW(http.HandlerFunc(psH.DownloadVersion)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_ITEMS_BY_ITEM_ID_COMMENTS, containerMW(http.HandlerFunc(psH.Comments)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_FOLDERS, containerMW(http.HandlerFunc(psH.Folders)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_PROTOTYPE, containerMW(http.HandlerFunc(psH.ImportPrototype)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_DOC, containerMW(http.HandlerFunc(psH.ImportDoc)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_IMPORT_DOC_STATUS, containerMW(http.HandlerFunc(psH.ImportDocStatus)))
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_SERVE_BY_PATH, containerMW(http.HandlerFunc(psH.ServePrototype)))
	// 流程交付物分享：工作空间任意成员可按流程所有者身份导入产物并生成需求级分享链接
	mux.Handle(ROUTE_POST_PROCESSES_BY_ID_DELIVERABLES_SHARE, containerMW(http.HandlerFunc(psH.ShareProcessDeliverable)))
	// 原型产品分享：需 PM 权限创建，公开接口免登录访问
	mux.Handle(ROUTE_WORKSPACES_BY_ID_PRODUCT_SPACE_SHARE, containerMW(http.HandlerFunc(psH.CreateShare)))
	// 分享落地页公开接口：无需登录（使用独立前缀避免与 /api/v1/shares/{token} 路由冲突）
	mux.HandleFunc(ROUTE_PROTOTYPE_SHARES_BY_TOKEN, psH.SharedPrototype)
	mux.HandleFunc(ROUTE_PROTOTYPE_SHARES_BY_TOKEN_FILES_BY_PATH, psH.ServeSharedPrototype)
	mux.HandleFunc(ROUTE_PROTOTYPE_SHARES_BY_TOKEN_PAGES_BY_ITEM_ID_COMMENTS, psH.SharedPrototypeComments)

	// 需求级统一分享（文档+原型）：需 PM 权限创建，公开接口免登录访问
	mux.Handle(ROUTE_WORKSPACES_BY_ID_REQUIREMENT_SHARES, containerMW(http.HandlerFunc(psH.CreateRequirementShare)))
	// 工作空间成员获取/创建需求分享（无需 PM 权限，用于流程详情页等非 PM 场景）
	mux.Handle(ROUTE_GET_WORKSPACES_BY_ID_REQUIREMENT_SHARES_VIEW, containerMW(http.HandlerFunc(psH.GetOrCreateRequirementShare)))
	mux.HandleFunc(ROUTE_REQUIREMENT_SHARES_BY_TOKEN, psH.SharedRequirement)
	mux.HandleFunc(ROUTE_REQUIREMENT_SHARES_BY_TOKEN_FILES_BY_PATH, psH.ServeSharedRequirementFile)
	mux.HandleFunc(ROUTE_REQUIREMENT_SHARES_BY_TOKEN_PAGES_BY_ITEM_ID_COMMENTS, psH.RequirementShareComments)
	mux.HandleFunc(ROUTE_REQUIREMENT_SHARES_BY_TOKEN_DOC_COMMENTS, psH.RequirementShareDocComments)

	// Team skills / prompts
	mux.HandleFunc(ROUTE_TEAM_SKILLS, team.Skills)
	mux.HandleFunc(ROUTE_TEAM_SKILLS_BY_ID, team.SkillByID)
	mux.Handle(ROUTE_TEAM_SKILLS_BY_ID_REVIEW, middleware.Auth(http.HandlerFunc(team.ReviewSkill)))
	mux.Handle(ROUTE_TEAM_SKILLS_BY_ID_CATEGORIES, middleware.Auth(http.HandlerFunc(team.SkillCategoriesUpdate)))
	mux.Handle(ROUTE_TEAM_SKILL_CATEGORIES, middleware.Auth(http.HandlerFunc(team.SkillCategories)))
	mux.Handle(ROUTE_TEAM_SKILL_CATEGORIES_BY_ID, middleware.Auth(http.HandlerFunc(team.SkillCategoryByID)))

	mux.Handle(ROUTE_TEAM_PROMPTS, middleware.Auth(http.HandlerFunc(team.Prompts)))
	mux.Handle(ROUTE_TEAM_PROMPTS_BY_ID, middleware.Auth(http.HandlerFunc(team.PromptByID)))
	mux.Handle(ROUTE_TEAM_PROMPTS_BY_ID_REVIEW, middleware.Auth(http.HandlerFunc(team.ReviewPrompt)))
	mux.Handle(ROUTE_TEAM_PROMPTS_BY_ID_CATEGORIES, middleware.Auth(http.HandlerFunc(team.PromptCategoriesUpdate)))
	mux.Handle(ROUTE_TEAM_PROMPTS_BY_ID_USE, middleware.Auth(http.HandlerFunc(team.PromptUsage)))
	mux.Handle(ROUTE_TEAM_PROMPT_CATEGORIES, middleware.Auth(http.HandlerFunc(team.PromptCategories)))
	mux.Handle(ROUTE_TEAM_PROMPT_CATEGORIES_BY_ID, middleware.Auth(http.HandlerFunc(team.PromptCategoryByID)))
	mux.Handle(ROUTE_TEAM_SKILLS_STATS, middleware.Auth(http.HandlerFunc(team.SkillStats)))
	mux.Handle(ROUTE_TEAM_PROMPTS_STATS, middleware.Auth(http.HandlerFunc(team.PromptStats)))

	// Feishu 机器人模块
	// webhook 接口使用 BearerAuth 保护（本平台侧鉴权），飞书侧签名校验在 mock 模式下跳过。
	// 绑定/会话映射管理接口需登录态。
	mux.Handle(ROUTE_FEISHU_WEBHOOK, middleware.BearerAuth(cfg.FeishuWebhookToken)(http.HandlerFunc(feishu.Webhook)))
	mux.Handle(ROUTE_FEISHU_BINDINGS, middleware.Auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost:
			feishu.BindUser(w, r)
		case http.MethodGet:
			feishu.ListBindings(w, r)
		default:
			handler.WriteJSONError(w, http.StatusMethodNotAllowed, handler.ErrCodeGeneral, "method not allowed")
		}
	})))
	mux.HandleFunc(ROUTE_WORKSPACES_BY_ID_AGENT_STATUS, agentStatusHandler.GetStatus)

	mux.Handle(ROUTE_FEISHU_CHAT_SESSIONS, middleware.Auth(http.HandlerFunc(feishu.ListChatSessions)))

	// Apply middleware
	return middleware.Logger(middleware.CORS(mux)), func() {
		cleanupStop()
		agentController.Stop()
	}
}

func initDB(cfg config.Config) *sql.DB {
	dsn := sdkpostgres.DSN(sdkpostgres.Config{
		Host:     cfg.DBHost,
		Port:     cfg.DBPort,
		User:     cfg.DBUser,
		Password: cfg.DBPassword,
		Database: cfg.DBName,
	})

	pool := sdkpostgres.PoolConfig{
		MaxOpenConns:    cfg.DBMaxOpenConns,
		MaxIdleConns:    cfg.DBMaxIdleConns,
		ConnMaxLifetime: cfg.DBConnMaxLifetime,
	}

	db, err := sdkpostgres.OpenDBWithPool(dsn, pool)
	if err != nil {
		log.Fatalf("[DB] postgres connect failed: %v", err)
	}
	log.Printf("[DB] connected to postgres at %s:%s/%s (pool: maxOpen=%d, maxIdle=%d, maxLifetime=%s)",
		cfg.DBHost, cfg.DBPort, cfg.DBName, cfg.DBMaxOpenConns, cfg.DBMaxIdleConns, cfg.DBConnMaxLifetime)
	return db
}

func initIdentityService(db *sql.DB) identityservice.UserService {
	log.Println("[Identity] using postgres storage")
	svc := identityservice.NewDBUserService(db)
	identity.Init(svc)
	return svc
}

func initPersonalAssistantService(db *sql.DB) {
	log.Println("[PersonalAssistant] using postgres storage")
	personalassistant.Init(paservice.NewDBPersonalAssistantService(db))
}

func initWorkItemService(db *sql.DB) workitemservice.WorkItemService {
	log.Println("[WorkItem] using postgres storage")
	svc := workitemservice.NewDBWorkItemService(db)
	workitem.Init(svc)
	return svc
}

func initReviewService(db *sql.DB) {
	log.Println("[PR Agent] using postgres storage")
	pragent.Init(pragentservice.NewDBReviewService(db))
}

func initEventService(db *sql.DB) {
	log.Println("[Audit] using postgres storage")
	audit.Init(auditservice.NewDBEventService(db))
}

func initOrchestratorService(db *sql.DB) {
	log.Println("[Orchestrator] using postgres storage")
	sessionmanager.Init(sessionmanagerservice.NewDBSessionService(db))
}

func initAgentReviewService(db *sql.DB) {
	log.Println("[AgentReview] using postgres storage")
	agent_review.Init(agentreviewservice.NewDBAgentReviewService(db))
}

func initNotificationService(db *sql.DB) notificationservice.NotificationService {
	log.Println("[Notification] using postgres storage")
	svc := notificationservice.NewDBNotificationService(db)
	notification.Init(svc)
	return svc
}

// initDevReviewOrchestrator 初始化流程编排器，并注入 workitem 分配回调
func initDevReviewOrchestrator(db *sql.DB, cfg config.Config, workItemSvc workitemservice.WorkItemService, notificationSvc notificationservice.NotificationService, sessions chat.SessionStore, messages chat.MessageStore) *devorchestrator.Orchestrator {
	aguiClient := client.NewAGUIClient(cfg.GatewaydAdminURL, cfg.GatewaydAgentID)
	orch := devorchestrator.NewOrchestrator(notificationSvc, workItemSvc, aguiClient, sessions, messages, cfg.WorkspaceRoot, cfg.GatewaydAgentID)
	// 注入 workitem 分配回调
	workitem.SetAssigneeAssignedCallback(func(workitemID, workspaceID, tenantID, assigneeID, assigneeName, title, description string) {
		orch.OnWorkitemAssigned(context.Background(), workitemID, workspaceID, tenantID, assigneeID, assigneeName, title, description)
	})
	// 注入通知操作回调：研发批准时触发编排
	notification.SetActionCallback(func(notificationID, userID, action string, data map[string]any) {
		if action == "approve" {
			// 判断通知类型以决定调用哪个编排方法
			notificationType, _ := data["notificationType"].(string)
			if notificationType == "requirement_eval_required" {
				workitemID, _ := data["workitemId"].(string)
				workitemTitle, _ := data["workitemTitle"].(string)
				processID, _ := data["processId"].(string)
				workspacePath, _ := data["workspacePath"].(string)
				workspaceID, _ := data["workspaceId"].(string)
				tenantID, _ := data["tenantId"].(string)
				userName, _ := data["userName"].(string)
				if userName == "" {
					userName = "用户"
				}
				// approved=true -> 直接开发(不需要架构设计), approved=false -> 需要架构设计
				approvedRaw, hasApproved := data["approved"]
				approved := false
				if hasApproved {
					approved, _ = approvedRaw.(bool)
				}
				needArch := !approved // approved=true 表示"直接开发", 所以 needArch=false
				if workitemID != "" {
					orch.OnRequirementEvalResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, needArch)
				}
				return
			}
			if notificationType == "human_review_required" {
				workitemID, _ := data["workitemId"].(string)
				workitemTitle, _ := data["workitemTitle"].(string)
				processID, _ := data["processId"].(string)
				workspacePath, _ := data["workspacePath"].(string)
				workspaceID, _ := data["workspaceId"].(string)
				tenantID, _ := data["tenantId"].(string)
				reviewReport, _ := data["reviewReport"].(string)
				developerPrompt, _ := data["developerPrompt"].(string)
				devSessionID, _ := data["sessionId"].(string)
				devThreadID, _ := data["threadId"].(string)
				userName, _ := data["userName"].(string)
				if userName == "" {
					userName = "用户"
				}
				// approved 可能为 nil（旧版前端不传此字段），默认为 false（需优化）
				approvedRaw, hasApproved := data["approved"]
				approved := false
				if hasApproved {
					approved, _ = approvedRaw.(bool)
				}
				if workitemID != "" {
					orch.OnHumanReviewResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, devSessionID, devThreadID, reviewReport, developerPrompt, approved)
				}
				return
			}
			if notificationType == "human_audit_required" {
				workitemID, _ := data["workitemId"].(string)
				workitemTitle, _ := data["workitemTitle"].(string)
				processID, _ := data["processId"].(string)
				workspacePath, _ := data["workspacePath"].(string)
				workspaceID, _ := data["workspaceId"].(string)
				tenantID, _ := data["tenantId"].(string)
				sessionID, _ := data["sessionId"].(string)
				threadID, _ := data["threadId"].(string)
				archDesignResult, _ := data["archDesignResult"].(string)
				aiEvalResult, _ := data["aiEvalResult"].(string)
				userName, _ := data["userName"].(string)
				if userName == "" {
					userName = "用户"
				}
				approvedRaw, hasApproved := data["approved"]
				approved := false
				if hasApproved {
					approved, _ = approvedRaw.(bool)
				}
				if workitemID != "" {
					orch.OnHumanAuditResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, sessionID, threadID, archDesignResult, aiEvalResult, approved)
				}
				return
			}
			if notificationType == notificationobject.TypeTestPlanReviewRequired ||
				notificationType == notificationobject.TypeTestCaseReviewRequired ||
				notificationType == notificationobject.TypeTestAdmissionReviewRequired {
				workitemID, _ := data["workitemId"].(string)
				workitemTitle, _ := data["workitemTitle"].(string)
				processID, _ := data["processId"].(string)
				workspacePath, _ := data["workspacePath"].(string)
				workspaceID, _ := data["workspaceId"].(string)
				tenantID, _ := data["tenantId"].(string)
				sessionID, _ := data["sessionId"].(string)
				threadID, _ := data["threadId"].(string)
				userName, _ := data["userName"].(string)
				if userName == "" {
					userName = "用户"
				}
				approvedRaw, hasApproved := data["approved"]
				approved := false
				if hasApproved {
					approved, _ = approvedRaw.(bool)
				}
				if workitemID != "" {
					orch.OnTestReviewResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, sessionID, threadID, notificationType, approved)
				}
				return
			}
			if notificationType == notificationobject.TypeProductReviewRequired ||
				notificationType == notificationobject.TypeProductProtoReviewRequired ||
				notificationType == notificationobject.TypeProductFinalReviewRequired {
				workitemID, _ := data["workitemId"].(string)
				workitemTitle, _ := data["workitemTitle"].(string)
				processID, _ := data["processId"].(string)
				workspacePath, _ := data["workspacePath"].(string)
				workspaceID, _ := data["workspaceId"].(string)
				tenantID, _ := data["tenantId"].(string)
				userName, _ := data["userName"].(string)
				if userName == "" {
					userName = "用户"
				}
				approvedRaw, hasApproved := data["approved"]
				approved := false
				if hasApproved {
					approved, _ = approvedRaw.(bool)
				}
				if workitemID != "" {
					if notificationType == notificationobject.TypeProductReviewRequired {
						orch.OnProductReviewResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, approved)
					} else if notificationType == notificationobject.TypeProductProtoReviewRequired {
						orch.OnProductProtoReviewResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, approved)
					} else {
						orch.OnProductFinalReviewResult(context.Background(), notificationID, userID, userName, workitemID, processID, workspacePath, workspaceID, tenantID, workitemTitle, approved)
					}
				}
				return
			}

			workitemID, _ := data["workitemId"].(string)
			repositoryID, _ := data["repositoryId"].(string)
			projectName, _ := data["projectName"].(string)
			targetWorkspaceID, _ := data["targetWorkspaceId"].(string)
			userName, _ := data["assigneeName"].(string)
			if userName == "" {
				userName = "用户"
			}
			if workitemID != "" {
				orch.OnApproveAIDev(context.Background(), notificationID, userID, userName, workitemID, repositoryID, projectName, targetWorkspaceID)
			}
		}
	})
	log.Println("[Orchestrator] dev-review orchestrator initialized")
	return orch
}

func initWorkspaceService(db *sql.DB, workspaceRoot string, userService identityservice.UserService, codingAgents []config.CodingAgentDefinition) workspaceservice.WorkspaceService {
	log.Printf("[Workspace] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := workspaceservice.NewDBWorkspaceService(db, workspaceRoot)
	workspace.Init(svc)
	workspace.InitUserService(userService)
	keys := make([]string, 0, len(codingAgents))
	for _, a := range codingAgents {
		keys = append(keys, a.Key)
	}
	workspace.SetAllowedAgentKeys(keys)
	return svc
}

func initAgentConfigService(db *sql.DB, codingAgents []config.CodingAgentDefinition, models []string, modelVendors []config.ModelVendorGroup) {
	log.Println("[AgentConfig] using postgres storage")
	agents := make([]agent.AgentType, 0, len(codingAgents))
	for _, a := range codingAgents {
		agents = append(agents, agent.AgentType{
			Key:         a.Key,
			Name:        a.Name,
			Description: a.Description,
			Enabled:     true,
			Builtin:     true,
		})
	}
	vendors := make([]agent.ModelVendorGroup, 0, len(modelVendors))
	for _, v := range modelVendors {
		vendors = append(vendors, agent.ModelVendorGroup{
			Key:    v.Key,
			Name:   v.Name,
			Models: v.Models,
		})
	}
	defaultAgentConfigService = agentconfigservice.NewDBAgentConfigService(db, agentconfigservice.AgentGlobalConfig{
		Agents:       agents,
		Models:       models,
		ModelVendors: vendors,
	})
	agentconfig.Init(defaultAgentConfigService)
}

func initTeamService(db *sql.DB, userService identityservice.UserService) {
	log.Println("[Team] using postgres storage")
	svc := teamservice.NewDBTeamService(db)
	team.Init(svc)
	team.InitUserService(userService)
}

// initFeishuService 初始化飞书机器人服务。
// 构造独立的 AGUIClient 向 gatewayd 分发 agent 命令，
// 复用平台 session/message 存储持久化持久化会话，
// replier 按 mock/real 模式选择回复发送器。
func initFeishuService(db *sql.DB, cfg config.Config, sessions chat.SessionStore, messages chat.MessageStore) {
	log.Printf("[Feishu] init mockMode=%v botUser=%s defaultWorkspace=%s adminUsers=%d",
		cfg.FeishuMockMode, cfg.FeishuBotUserID, cfg.FeishuDefaultWorkspace, len(cfg.FeishuAdminUserIDs))
	aguiClient := client.NewAGUIClient(cfg.GatewaydAdminURL, cfg.GatewaydAgentID)
	// 共享同一个 FeishuTokenManager，避免三个客户端各自刷新 token 造成重复请求与数据竞争
	var tokenManager *feishuservice.FeishuTokenManager
	if !cfg.FeishuMockMode {
		tokenManager = feishuservice.NewFeishuTokenManager(cfg.FeishuAppID, cfg.FeishuAppSecret, cfg.FeishuAPIBaseURL)
	}
	replier := feishuservice.NewReplier(cfg.FeishuMockMode, tokenManager, cfg.FeishuAPIBaseURL)
	cardKit := feishuservice.NewCardKitManager(cfg.FeishuMockMode, tokenManager, cfg.FeishuAPIBaseURL)
	var groupHistory *feishuservice.GroupHistoryFetcher
	if !cfg.FeishuMockMode {
		groupHistory = feishuservice.NewGroupHistoryFetcher(tokenManager, cfg.FeishuAPIBaseURL)
	}
	svc := feishuservice.NewDBFeishuService(db, aguiClient, sessions, messages, cfg.WorkspaceRoot, feishuservice.Config{
		BotUserID:        cfg.FeishuBotUserID,
		DefaultWorkspace: cfg.FeishuDefaultWorkspace,
		MockMode:         cfg.FeishuMockMode,
		DispatchTimeout:  cfg.FeishuDispatchTimeout,
		AdminUserIDs:     cfg.FeishuAdminUserIDs,
	}, replier, cardKit, groupHistory)
	feishu.Init(svc)
}

func initWorkspacePromptService(db *sql.DB) {
	log.Println("[WorkspacePrompt] using postgres storage")
	svc := workspaceservice.NewDBWorkspacePromptService(db)
	workspace.InitPromptService(svc)
}

func initProductDocService(db *sql.DB, workspaceRoot string) *productdoc.Handler {
	log.Printf("[ProductDoc] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := productdocservice.NewDBProductDocService(db, workspaceRoot)
	productdoc.Init(svc)
	return productdoc.NewHandler(svc)
}

func initPlatformTemplateService(db *sql.DB) {
	log.Println("[PlatformTemplate] using postgres storage")
	platformtemplate.Init(platformtemplateservice.NewDBPlatformTemplateService(db))
}

func initPrototypeTemplateService(db *sql.DB, workspaceRoot string) {
	log.Printf("[PrototypeTemplate] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := prototypetemplateservice.NewDBPrototypeTemplateService(db, workspaceRoot)
	prototypetemplate.Init(svc)
	// 注册模版清单提供者，供 /proto-make 渲染 {PROTO_TEMPLATES} 占位符。
	handler.SetProtoTemplatesProvider(svc.BuildProtoTemplatesBlock)
}

func initAgentRuntimeService(db *sql.DB, workspaceRoot string) agentruntimeservice.AgentRuntimeService {
	log.Printf("[AgentRuntime] using postgres storage, workspaceRoot=%s", workspaceRoot)
	svc := agentruntimeservice.NewDBAgentRuntimeService(db, workspaceRoot)
	agentruntime.Init(svc)
	// 启动后台过期检测：定期将超过心跳阈值未上报的运行时标记为 stopped。
	svc.StartStaleChecker()
	return svc
}

func initProductSpaceService(db *sql.DB, cfg config.Config, workspaceService workspaceservice.WorkspaceService) {
	log.Printf("[ProductSpace] using postgres storage, workspaceRoot=%s", cfg.WorkspaceRoot)
	var err error
	productSpaceService, err = psService.NewDBProductSpaceService(db, cfg.WorkspaceRoot, workspaceService)
	if err != nil {
		log.Fatalf("init productspace service: %v", err)
	}
}

func initRepositoryService(db *sql.DB, cfg config.Config) {
	root := cfg.WorkspaceRoot
	log.Printf("[Repository] using postgres storage with git clone, root=%s", root)

	// 解析 SSH 私钥加密密钥。为空时明文存储（开发环境兼容）。
	encryptionKey, err := crypto.ParseKey(cfg.SSHKeyEncryptionKey)
	if err != nil {
		log.Fatalf("[Repository] parse ssh key encryption key failed: %v", err)
	}
	if len(encryptionKey) > 0 {
		log.Println("[Repository] ssh key encryption enabled (AES-256-GCM)")
	} else {
		log.Println("[Repository] ssh key encryption disabled (no key configured, storing plaintext)")
	}

	svc, err := repositoryservice.NewDBRepositoryService(db, root, &dbSSHKeyResolver{db: db}, encryptionKey)
	if err != nil {
		log.Fatalf("[Repository] init repository service failed: %v", err)
	}

	// 根据 buffer_store_type 选择分支缓存后端：redis（分布式）或 memory（开发环境）。
	if cfg.BufferStoreType == "redis" && len(cfg.RedisAddrs) > 0 {
		var redisClient redis.UniversalClient
		if len(cfg.RedisAddrs) == 1 {
			redisClient = redis.NewClient(&redis.Options{
				Addr:     cfg.RedisAddrs[0],
				Password: cfg.RedisPassword,
				DB:       cfg.RedisDB,
			})
		} else {
			redisClient = redis.NewClusterClient(&redis.ClusterOptions{
				Addrs:    cfg.RedisAddrs,
				Password: cfg.RedisPassword,
			})
		}
		svc.SetBranchCache(repositoryservice.NewRedisBranchCache(redisClient))
		log.Printf("[Repository] branch cache: redis, addrs=%v", cfg.RedisAddrs)
	} else {
		log.Printf("[Repository] branch cache: memory (dev mode)")
	}

	repository.Init(svc)
}

// dbSSHKeyResolver 从 user_profiles 表解析用户 SSH Key，供仓库克隆/拉取使用。
type dbSSHKeyResolver struct {
	db *sql.DB
}

func (r *dbSSHKeyResolver) ResolveSSHKey(userID string) (string, error) {
	if r.db == nil || userID == "" {
		return "", nil
	}
	var key string
	err := r.db.QueryRow(`SELECT ssh_key FROM user_profiles WHERE user_id = $1`, userID).Scan(&key)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("resolve ssh key failed: %w", err)
	}
	return key, nil
}

// initProcessService 初始化流程追踪服务（PostgreSQL 存储）
func initProcessService(db *sql.DB) {
	store := processstore.NewDBProcessStore(db)
	svc := processservice.NewProcessService(store)
	process.Init(svc)
}

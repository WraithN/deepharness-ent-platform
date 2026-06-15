module github.com/deepharness/deepharness-ent-platform/apps/dh-backend

go 1.22

require (
	github.com/deepharness/deepharness-ent-platform/packages/go-sdk v0.0.0
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
)

replace github.com/deepharness/deepharness-ent-platform/packages/go-sdk => ../../packages/go-sdk

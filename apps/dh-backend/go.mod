module github.com/deepharness/deepharness-ent-platform/apps/dh-backend

go 1.22

require (
	github.com/deepharness/deepharness-ent-platform/packages/go-sdk v0.0.0
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
)

require (
	filippo.io/edwards25519 v1.1.0 // indirect
	github.com/go-sql-driver/mysql v1.8.1 // indirect
)

replace github.com/deepharness/deepharness-ent-platform/packages/go-sdk => ../../packages/go-sdk

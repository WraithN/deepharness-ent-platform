module github.com/deepharness/deepharness-ent-platform/apps/dh-backend

go 1.22

require (
	github.com/deepharness/deepharness-ent-platform/packages/go-sdk v0.0.0
	github.com/google/uuid v1.6.0
	github.com/gorilla/websocket v1.5.3
	golang.org/x/crypto v0.17.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20221227161230-091c0ba34f0a // indirect
	github.com/jackc/pgx/v5 v5.6.0 // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	golang.org/x/sync v0.1.0 // indirect
	golang.org/x/text v0.14.0 // indirect
)

replace github.com/deepharness/deepharness-ent-platform/packages/go-sdk => ../../packages/go-sdk

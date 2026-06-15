// Package postgres 提供 PostgreSQL 数据库连接基础设施。
//
// 设计目标：
//   - 为各微服务提供统一的 *sql.DB 初始化方式。
//   - 屏蔽 DSN 拼接细节，支持环境变量与显式配置两种模式。
//   - 提供合理的默认连接池参数，避免连接泄漏。
//
// 使用示例：
//
//	db, err := postgres.OpenDB(postgres.DSN(postgres.Config{
//	    Host:     os.Getenv("DB_HOST"),
//	    Port:     os.Getenv("DB_PORT"),
//	    User:     os.Getenv("DB_USER"),
//	    Password: os.Getenv("DB_PASSWORD"),
//	    Database: os.Getenv("DB_NAME"),
//	}))
//	if err != nil {
//	    log.Fatalf("open postgres failed: %v", err)
//	}
//	defer db.Close()
package postgres

import (
	"database/sql"
	"fmt"
	"net/url"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// Config 定义 PostgreSQL 连接配置。
type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	Database string
	// Params 为额外的 DSN 参数，例如 "sslmode=disable&connect_timeout=10"。
	Params string
}

const (
	// 默认连接池参数。
	defaultMaxOpenConns    = 25
	defaultMaxIdleConns    = 5
	defaultConnMaxLifetime = 5 * time.Minute
)

// DSN 根据 Config 构造 PostgreSQL DSN 字符串（URL 形式）。
// 默认 sslmode=disable，方便本地开发；生产环境应通过 Params 覆盖为 require/verify-full。
func DSN(cfg Config) string {
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == "" {
		port = "5432"
	}

	params := cfg.Params
	if params == "" {
		params = "sslmode=disable"
	} else if !containsParam(params, "sslmode") {
		params = params + "&sslmode=disable"
	}

	user := cfg.User
	if user == "" {
		user = "postgres"
	}
	password := cfg.Password
	if password == "" {
		password = "postgres"
	}
	dbname := cfg.Database
	if dbname == "" {
		dbname = "postgres"
	}

	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?%s",
		url.QueryEscape(user),
		url.QueryEscape(password),
		host,
		port,
		url.PathEscape(dbname),
		params,
	)
}

// OpenDB 使用给定的 DSN 打开 PostgreSQL 连接，并配置默认连接池。
func OpenDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open pgx failed: %w", err)
	}

	db.SetMaxOpenConns(defaultMaxOpenConns)
	db.SetMaxIdleConns(defaultMaxIdleConns)
	db.SetConnMaxLifetime(defaultConnMaxLifetime)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping pgx failed: %w", err)
	}

	return db, nil
}

// containsParam 判断 params 字符串中是否包含指定 key（不考虑值）。
func containsParam(params, key string) bool {
	for i := 0; i < len(params); i++ {
		if params[i] == '?' || params[i] == '&' {
			j := i + 1
			for j < len(params) && params[j] != '=' && params[j] != '&' {
				j++
			}
			if params[i+1:j] == key {
				return true
			}
		}
	}
	return false
}

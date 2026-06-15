// Package mysql 提供 MySQL 数据库连接基础设施。
//
// 设计目标：
//   - 为各微服务提供统一的 *sql.DB 初始化方式。
//   - 屏蔽 DSN 拼接细节，支持环境变量与显式配置两种模式。
//   - 提供合理的默认连接池参数，避免连接泄漏。
//
// 使用示例：
//
//	db, err := mysql.OpenDB(mysql.DSN(mysql.Config{
//	    Host:     os.Getenv("DB_HOST"),
//	    Port:     os.Getenv("DB_PORT"),
//	    User:     os.Getenv("DB_USER"),
//	    Password: os.Getenv("DB_PASSWORD"),
//	    Database: os.Getenv("DB_NAME"),
//	}))
//	if err != nil {
//	    log.Fatalf("open mysql failed: %v", err)
//	}
//	defer db.Close()
package mysql

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

// Config 定义 MySQL 连接配置。
type Config struct {
	Host     string
	Port     string
	User     string
	Password string
	Database string
	// Params 为额外的 DSN 参数，例如 "parseTime=true&loc=Local"。
	Params string
}

const (
	// 默认连接池参数。
	defaultMaxOpenConns    = 25
	defaultMaxIdleConns    = 5
	defaultConnMaxLifetime = 5 * time.Minute
)

// DSN 根据 Config 构造 MySQL DSN 字符串。
// 默认启用 parseTime=true，确保 TIME/DATE/DATETIME 类型可被扫描为 time.Time。
func DSN(cfg Config) string {
	host := cfg.Host
	if host == "" {
		host = "127.0.0.1"
	}
	port := cfg.Port
	if port == "" {
		port = "3306"
	}

	params := cfg.Params
	if params == "" {
		params = "parseTime=true"
	} else if !containsParam(params, "parseTime") {
		params = params + "&parseTime=true"
	}

	return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?%s",
		cfg.User,
		cfg.Password,
		host,
		port,
		cfg.Database,
		params,
	)
}

// OpenDB 使用给定的 DSN 打开 MySQL 连接，并配置默认连接池。
func OpenDB(dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open mysql failed: %w", err)
	}

	db.SetMaxOpenConns(defaultMaxOpenConns)
	db.SetMaxIdleConns(defaultMaxIdleConns)
	db.SetConnMaxLifetime(defaultConnMaxLifetime)

	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping mysql failed: %w", err)
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

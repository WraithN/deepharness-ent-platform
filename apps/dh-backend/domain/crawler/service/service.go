// Package service 实现 crawler cookie 的本地文件持久化。
package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/crawler/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
)

// CrawlerCookieService 按 workspace + domain 持久化浏览器 cookie。
type CrawlerCookieService struct {
	workspaceRoot string
}

// NewCrawlerCookieService 创建 cookie 服务。
func NewCrawlerCookieService(workspaceRoot string) *CrawlerCookieService {
	return &CrawlerCookieService{workspaceRoot: workspaceRoot}
}

// Save 将指定 workspace + domain 的 cookie 写入本地 JSON 文件。
func (s *CrawlerCookieService) Save(userID, workspaceID, domain string, cookies []object.Cookie) error {
	dir, err := s.sessionDir(userID, workspaceID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create crawler session dir failed: %w", err)
	}

	path := filepath.Join(dir, safeDomainFileName(domain))
	data, err := json.MarshalIndent(cookies, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal cookies failed: %w", err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return fmt.Errorf("write cookies file failed: %w", err)
	}
	return nil
}

// Load 读取指定 workspace + domain 的 cookie 列表。
func (s *CrawlerCookieService) Load(userID, workspaceID, domain string) ([]object.Cookie, error) {
	dir, err := s.sessionDir(userID, workspaceID)
	if err != nil {
		return nil, err
	}
	path := filepath.Join(dir, safeDomainFileName(domain))
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read cookies file failed: %w", err)
	}
	var cookies []object.Cookie
	if err := json.Unmarshal(data, &cookies); err != nil {
		return nil, fmt.Errorf("parse cookies file failed: %w", err)
	}
	return cookies, nil
}

func (s *CrawlerCookieService) sessionDir(userID, workspaceID string) (string, error) {
	root, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return "", err
	}
	return filepath.Join(root, ".crawler-sessions"), nil
}

// safeDomainFileName 把域名转换为合法文件名。
func safeDomainFileName(domain string) string {
	// 去掉 scheme 和 path，仅保留 host。
	domain = strings.TrimSpace(domain)
	domain = strings.TrimPrefix(domain, "http://")
	domain = strings.TrimPrefix(domain, "https://")
	if idx := strings.Index(domain, "/"); idx != -1 {
		domain = domain[:idx]
	}
	// 文件名中不允许的字符替换为下划线。
	domain = strings.ReplaceAll(domain, ":", "_")
	domain = strings.ReplaceAll(domain, "/", "_")
	return domain + ".json"
}

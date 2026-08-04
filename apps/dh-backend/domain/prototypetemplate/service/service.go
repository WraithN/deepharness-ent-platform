// Package service 实现原型工程模版模块的业务逻辑与数据访问。
package service

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/prototypetemplate/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/lib/pq"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// 模版依赖安装相关常量。
const (
	// installTimeout 限制单次 pnpm install 的最长耗时，避免长期阻塞 HTTP 请求。
	installTimeout = 10 * time.Minute
	// maxInstallLog 限制存储到数据库的安装日志长度，防止超大输出撑爆字段。
	maxInstallLog = 16 * 1024
)

// PrototypeTemplateService 定义原型工程模版模块的服务接口。
type PrototypeTemplateService interface {
	// List 返回全部模版，按 id 倒序（最新上传在前）。
	List() ([]object.PrototypeTemplate, error)
	// Get 按 id 查询单个模版。
	Get(id int64) (object.PrototypeTemplate, error)
	// CreateWithZip 创建模版记录并将 zip 源码解压到磁盘。
	CreateWithZip(name, description, tags string, zipData []byte) (object.PrototypeTemplate, error)
	// UpdateMeta 更新模版的名称、场景描述、标签。
	UpdateMeta(id int64, req object.UpdateMetaRequest) (object.PrototypeTemplate, error)
	// Delete 删除模版记录并移除磁盘目录。
	Delete(id int64) error
	// InstallDeps 在模版目录执行 pnpm install（或 npm install），并更新状态与日志。
	InstallDeps(id int64) (object.PrototypeTemplate, error)
	// BuildProtoTemplatesBlock 构造注入 /proto-make 模板的「可用工程模版」清单文本。
	BuildProtoTemplatesBlock() string
}

// DBPrototypeTemplateService 是基于 PostgreSQL 的 PrototypeTemplateService 实现。
type DBPrototypeTemplateService struct {
	db            *sql.DB
	workspaceRoot string
	sharesBase    string
}

// NewDBPrototypeTemplateService 创建原型工程模版服务。
// workspaceRoot 用于定位 ${workspace_root}/shares/prototypes-templates 目录。
func NewDBPrototypeTemplateService(db *sql.DB, workspaceRoot string) *DBPrototypeTemplateService {
	s := &DBPrototypeTemplateService{
		db:            db,
		workspaceRoot: workspaceRoot,
		sharesBase:    filepath.Join(workspaceRoot, "shares", "prototypes-templates"),
	}
	// 服务初始化时自动建表，避免开发/测试环境因未执行迁移脚本而缺少表。
	if err := s.ensureTable(); err != nil {
		log.Printf("[PrototypeTemplate] ensureTable failed: %v", err)
	}
	return s
}

// ensureTable 在表不存在时自动创建，DDL 与 infra/database/prototypetemplate/schema.sql 保持一致。
func (s *DBPrototypeTemplateService) ensureTable() error {
	_, err := s.db.Exec(`
		CREATE TABLE IF NOT EXISTS prototype_templates (
			id BIGSERIAL PRIMARY KEY,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			tags TEXT NOT NULL DEFAULT '',
			dir_path TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL DEFAULT 'pending',
			has_node_modules BOOLEAN NOT NULL DEFAULT FALSE,
			install_log TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		CREATE UNIQUE INDEX IF NOT EXISTS idx_prototype_templates_name ON prototype_templates (name);
		CREATE INDEX IF NOT EXISTS idx_prototype_templates_status ON prototype_templates (status);

		CREATE OR REPLACE FUNCTION update_updated_at_column()
		RETURNS TRIGGER AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql;

		DROP TRIGGER IF EXISTS trigger_prototype_templates_updated_at ON prototype_templates;
		CREATE TRIGGER trigger_prototype_templates_updated_at
		BEFORE UPDATE ON prototype_templates
		FOR EACH ROW
		EXECUTE FUNCTION update_updated_at_column();
	`)
	if err != nil {
		return fmt.Errorf("create prototype_templates table failed: %w", err)
	}
	return nil
}

// dirFor 返回指定模版的磁盘目录绝对路径。
func (s *DBPrototypeTemplateService) dirFor(id int64) string {
	return filepath.Join(s.sharesBase, strconv.FormatInt(id, 10))
}

// List 返回全部模版，按 id 倒序。
func (s *DBPrototypeTemplateService) List() ([]object.PrototypeTemplate, error) {
	rows, err := s.db.Query(`
		SELECT id, name, description, tags, dir_path, status, has_node_modules, install_log, created_at, updated_at
		FROM prototype_templates
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("list prototype templates failed: %w", err)
	}
	defer rows.Close()
	return scanTemplates(rows)
}

// Get 按 id 查询单个模版。
func (s *DBPrototypeTemplateService) Get(id int64) (object.PrototypeTemplate, error) {
	row := s.db.QueryRow(`
		SELECT id, name, description, tags, dir_path, status, has_node_modules, install_log, created_at, updated_at
		FROM prototype_templates
		WHERE id = $1
	`, id)
	t, err := scanTemplate(row.Scan)
	if err != nil {
		return object.PrototypeTemplate{}, err
	}
	return t, nil
}

// CreateWithZip 创建模版记录并将 zip 源码解压到磁盘。
// 流程：插入记录（status=pending）-> 创建目录 -> 解压 zip -> 回填 dir_path。
// 任何步骤失败都会回滚（删除记录与目录），保证不留半成品。
func (s *DBPrototypeTemplateService) CreateWithZip(name, description, tags string, zipData []byte) (object.PrototypeTemplate, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return object.PrototypeTemplate{}, errors.New("name is required")
	}
	if len(zipData) == 0 {
		return object.PrototypeTemplate{}, errors.New("zip file is required")
	}

	var t object.PrototypeTemplate
	err := s.db.QueryRow(`
		INSERT INTO prototype_templates (name, description, tags, status, has_node_modules)
		VALUES ($1, $2, $3, $4, FALSE)
		RETURNING id, name, description, tags, dir_path, status, has_node_modules, install_log, created_at, updated_at
	`, name, strings.TrimSpace(description), strings.TrimSpace(tags), object.StatusPending).Scan(
		&t.ID, &t.Name, &t.Description, &t.Tags, &t.DirPath, &t.Status, &t.HasNodeModules, &t.InstallLog, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return object.PrototypeTemplate{}, errors.New("template name already exists")
		}
		return object.PrototypeTemplate{}, fmt.Errorf("create prototype template failed: %w", err)
	}

	dir := s.dirFor(t.ID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		_ = s.hardDelete(t.ID)
		return object.PrototypeTemplate{}, fmt.Errorf("create template dir failed: %w", err)
	}
	if err := extractZip(dir, zipData); err != nil {
		_ = os.RemoveAll(dir)
		_ = s.hardDelete(t.ID)
		return object.PrototypeTemplate{}, fmt.Errorf("extract zip failed: %w", err)
	}
	// 若 zip 内含单一顶层目录（常见于「压缩文件夹」），上提其内容，保证 package.json 落在模版根目录。
	if err := flattenSingleRoot(dir); err != nil {
		_ = os.RemoveAll(dir)
		_ = s.hardDelete(t.ID)
		return object.PrototypeTemplate{}, fmt.Errorf("flatten zip root failed: %w", err)
	}

	if _, err := s.db.Exec(`UPDATE prototype_templates SET dir_path = $1 WHERE id = $2`, dir, t.ID); err != nil {
		_ = os.RemoveAll(dir)
		_ = s.hardDelete(t.ID)
		return object.PrototypeTemplate{}, fmt.Errorf("update template dir_path failed: %w", err)
	}
	t.DirPath = dir
	return t, nil
}

// UpdateMeta 更新模版的名称、场景描述、标签。
func (s *DBPrototypeTemplateService) UpdateMeta(id int64, req object.UpdateMetaRequest) (object.PrototypeTemplate, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return object.PrototypeTemplate{}, errors.New("name is required")
	}
	res, err := s.db.Exec(`
		UPDATE prototype_templates SET name = $1, description = $2, tags = $3 WHERE id = $4
	`, name, strings.TrimSpace(req.Description), strings.TrimSpace(req.Tags), id)
	if err != nil {
		if isUniqueViolation(err) {
			return object.PrototypeTemplate{}, errors.New("template name already exists")
		}
		return object.PrototypeTemplate{}, fmt.Errorf("update prototype template failed: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return object.PrototypeTemplate{}, common.NotFoundErrorf("prototype template not found")
	}
	return s.Get(id)
}

// Delete 删除模版记录并移除磁盘目录。
func (s *DBPrototypeTemplateService) Delete(id int64) error {
	t, err := s.Get(id)
	if err != nil {
		return err
	}
	if t.DirPath != "" {
		_ = os.RemoveAll(t.DirPath)
	}
	return s.hardDelete(id)
}

// hardDelete 仅删除数据库记录，不触碰磁盘（供内部回滚使用）。
func (s *DBPrototypeTemplateService) hardDelete(id int64) error {
	res, err := s.db.Exec(`DELETE FROM prototype_templates WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete prototype template failed: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return common.NotFoundErrorf("prototype template not found")
	}
	return nil
}

// InstallDeps 在模版目录执行 pnpm install（pnpm 不可用时回退 npm install），并更新状态与日志。
// 无 package.json 的模版直接标记为 ready（视为无需依赖的纯静态模版）。
func (s *DBPrototypeTemplateService) InstallDeps(id int64) (object.PrototypeTemplate, error) {
	t, err := s.Get(id)
	if err != nil {
		return object.PrototypeTemplate{}, err
	}
	if t.DirPath == "" {
		return object.PrototypeTemplate{}, errors.New("template dir not initialized")
	}

	// 无 package.json 视为无需安装依赖的模版，直接就绪。
	if _, statErr := os.Stat(filepath.Join(t.DirPath, "package.json")); statErr != nil {
		return s.updateInstallResult(id, object.StatusReady, false, "no package.json, skipped install")
	}

	// 标记安装中，便于前端展示状态。
	if _, err := s.db.Exec(`UPDATE prototype_templates SET status = $1, install_log = '' WHERE id = $2`, object.StatusInstalling, id); err != nil {
		return object.PrototypeTemplate{}, fmt.Errorf("mark installing failed: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), installTimeout)
	defer cancel()
	// 架构合规：通过 stubclient 委托 personal-stub 执行 npm install，
	// personal-stub 自动检测包管理器（pnpm/yarn/npm），不直接 exec npm。
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return s.updateInstallResult(id, object.StatusError, false, "personal-stub client not initialized")
	}
	result, runErr := sc.NpmInstall(ctx, t.DirPath)
	logText := truncateLog(result.Output)
	if runErr != nil {
		logText = truncateLog(logText + "\n" + runErr.Error())
		return s.updateInstallResult(id, object.StatusError, false, logText)
	}
	return s.updateInstallResult(id, object.StatusReady, true, logText)
}

// updateInstallResult 写入安装结果（状态、是否已装依赖、日志）并返回最新模版。
func (s *DBPrototypeTemplateService) updateInstallResult(id int64, status string, hasNodeModules bool, logText string) (object.PrototypeTemplate, error) {
	if _, err := s.db.Exec(`
		UPDATE prototype_templates SET status = $1, has_node_modules = $2, install_log = $3 WHERE id = $4
	`, status, hasNodeModules, truncateLog(logText), id); err != nil {
		return object.PrototypeTemplate{}, fmt.Errorf("update install result failed: %w", err)
	}
	return s.Get(id)
}

// BuildProtoTemplatesBlock 构造注入 /proto-make 模板的「可用工程模版」清单文本。
// 仅包含 status=ready 的模版；无可用模版时返回空串（/proto-make 据此回退单页 HTML 方案）。
func (s *DBPrototypeTemplateService) BuildProtoTemplatesBlock() string {
	rows, err := s.db.Query(`
		SELECT id, name, description, tags, dir_path
		FROM prototype_templates
		WHERE status = $1
		ORDER BY id ASC
	`, object.StatusReady)
	if err != nil {
		log.Printf("[PrototypeTemplate] list ready templates failed: %v", err)
		return ""
	}
	defer rows.Close()

	type readyItem struct {
		name        string
		description string
		tags        string
		dirPath     string
	}
	var items []readyItem
	for rows.Next() {
		var it readyItem
		var id int64
		if err := rows.Scan(&id, &it.name, &it.description, &it.tags, &it.dirPath); err != nil {
			log.Printf("[PrototypeTemplate] scan ready template failed: %v", err)
			return ""
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[PrototypeTemplate] iterate ready templates failed: %v", err)
		return ""
	}
	if len(items) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("【可用工程模版】\n")
	b.WriteString("以下模版已就绪（依赖已预装），请根据需求场景选择最匹配的一个使用。若没有匹配项，则改用「单页 HTML」方案。\n")
	for i, it := range items {
		fmt.Fprintf(&b, "%d. 名称: %s\n", i+1, it.name)
		if it.description != "" {
			fmt.Fprintf(&b, "   场景: %s\n", it.description)
		}
		if it.tags != "" {
			fmt.Fprintf(&b, "   标签: %s\n", it.tags)
		}
		fmt.Fprintf(&b, "   路径: %s\n", it.dirPath)
	}
	return b.String()
}

// scanTemplates 将多行查询结果扫描为模版列表（空结果返回非 nil 空切片，避免前端拿到 null）。
func scanTemplates(rows *sql.Rows) ([]object.PrototypeTemplate, error) {
	result := make([]object.PrototypeTemplate, 0)
	for rows.Next() {
		t, err := scanTemplate(rows.Scan)
		if err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate prototype templates failed: %w", err)
	}
	return result, nil
}

// scanTemplate 将单行查询结果扫描为模版，支持 sql.Row 与 sql.Rows 的 Scan 函数。
func scanTemplate(scan func(...any) error) (object.PrototypeTemplate, error) {
	var t object.PrototypeTemplate
	err := scan(&t.ID, &t.Name, &t.Description, &t.Tags, &t.DirPath, &t.Status, &t.HasNodeModules, &t.InstallLog, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return object.PrototypeTemplate{}, common.NotFoundErrorf("prototype template not found")
		}
		return object.PrototypeTemplate{}, fmt.Errorf("scan prototype template failed: %w", err)
	}
	return t, nil
}

// truncateLog 截断日志到最大长度，尾部保留最近的内容。
func truncateLog(s string) string {
	if len(s) <= maxInstallLog {
		return s
	}
	return s[len(s)-maxInstallLog:]
}

// isUniqueViolation 判断是否为唯一约束冲突（名称重复）。
func isUniqueViolation(err error) bool {
	if pgErr, ok := err.(*pq.Error); ok {
		return pgErr.Code == "23505"
	}
	return false
}

// extractZip 将 zip 数据解压到 dest 目录，带路径穿越防护。
// 跳过符号链接类条目，避免通过 zip 注入任意链接。
func extractZip(dest string, zipData []byte) error {
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	for _, f := range reader.File {
		if err := extractZipEntry(dest, f); err != nil {
			return err
		}
	}
	return nil
}

// extractZipEntry 解压单个 zip 条目，校验目标路径不逃逸出 dest。
func extractZipEntry(dest string, f *zip.File) error {
	// 跳过符号链接，避免安全风险。
	if f.FileInfo().Mode()&os.ModeSymlink != 0 {
		return nil
	}
	target := filepath.Join(dest, f.Name)
	if rel, err := filepath.Rel(dest, target); err != nil || strings.HasPrefix(rel, "..") {
		return fmt.Errorf("zip entry escapes dest dir: %s", f.Name)
	}
	if f.FileInfo().IsDir() {
		return os.MkdirAll(target, 0o755)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("open zip entry %s: %w", f.Name, err)
	}
	defer rc.Close()
	out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("create file %s: %w", target, err)
	}
	defer out.Close()
	if _, err := io.Copy(out, rc); err != nil {
		return fmt.Errorf("write file %s: %w", target, err)
	}
	return nil
}

// flattenSingleRoot 处理「zip 内含单一顶层目录」的常见情况：
// 若 dest 下只有一个子目录，则把该子目录的内容上提到 dest，保证 package.json 等位于模版根目录。
func flattenSingleRoot(dest string) error {
	entries, err := os.ReadDir(dest)
	if err != nil {
		return err
	}
	var dirs []os.DirEntry
	for _, e := range entries {
		dirs = append(dirs, e)
	}
	if len(dirs) != 1 || !dirs[0].IsDir() {
		return nil
	}
	root := filepath.Join(dest, dirs[0].Name())
	rootEntries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	// 按名称排序，保证移动顺序稳定。
	sort.Slice(rootEntries, func(i, j int) bool {
		return rootEntries[i].Name() < rootEntries[j].Name()
	})
	for _, e := range rootEntries {
		src := filepath.Join(root, e.Name())
		dst := filepath.Join(dest, e.Name())
		if err := os.Rename(src, dst); err != nil {
			return fmt.Errorf("move %s: %w", e.Name(), err)
		}
	}
	return os.Remove(root)
}

package handler

import (
	"database/sql"
	"log"
)

// platform_commands 表相关常量。
const (
	platformCommandsTable = "platform_commands"
)

// dbCommand 对应 platform_commands 表的一行。
// 系统指令仅用 cmd+enabled+is_builtin 做 enabled override；自定义指令使用全部字段。
type dbCommand struct {
	Cmd           string
	Label         string
	Desc          string
	Icon          string
	AllowTask     bool
	AllowRepos    bool
	RequireRepos  bool
	RequireTask   bool
	MaxRepos      int
	Enabled       bool
	Template      string
	CometTemplate string
	IsBuiltin     bool
	SortOrder     int
}

// commandStore 管理指令的 DB 持久化（自定义指令全字段 + 系统指令 enabled override）。
type commandStore struct {
	db *sql.DB
}

// NewCommandStore 创建指令存储，并确保表存在。
func NewCommandStore(db *sql.DB) *commandStore {
	s := &commandStore{db: db}
	s.ensureTable()
	return s
}

// ensureTable 幂等建表（DDL 与 infra/database/platform/schema.sql 保持一致）。
func (s *commandStore) ensureTable() {
	if s.db == nil {
		return
	}
	const ddl = `CREATE TABLE IF NOT EXISTS platform_commands (
		cmd VARCHAR(64) PRIMARY KEY,
		label VARCHAR(128) NOT NULL DEFAULT '',
		description TEXT DEFAULT '',
		icon VARCHAR(64) DEFAULT '',
		allow_task BOOLEAN DEFAULT FALSE,
		allow_repos BOOLEAN DEFAULT FALSE,
		require_repos BOOLEAN DEFAULT FALSE,
		require_task BOOLEAN DEFAULT FALSE,
		max_repos INT DEFAULT 0,
		enabled BOOLEAN DEFAULT TRUE,
		template TEXT DEFAULT '',
		comet_template TEXT DEFAULT '',
		is_builtin BOOLEAN DEFAULT FALSE,
		sort_order INT DEFAULT 0,
		created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`
	if _, err := s.db.Exec(ddl); err != nil {
		log.Printf("[Commands] ensureTable %s failed: %v", platformCommandsTable, err)
	}
}

// commandSelectColumns 是 platform_commands 的查询列清单，供 listAll/get 复用。
const commandSelectColumns = `cmd, label, description, icon, allow_task, allow_repos, require_repos, require_task, max_repos, enabled, template, comet_template, is_builtin, sort_order`

// listAll 查询全部指令行。
func (s *commandStore) listAll() ([]dbCommand, error) {
	if s.db == nil {
		return nil, nil
	}
	rows, err := s.db.Query(`SELECT ` + commandSelectColumns + ` FROM platform_commands ORDER BY sort_order, cmd`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]dbCommand, 0)
	for rows.Next() {
		c, err := scanDBCommand(rows)
		if err != nil {
			log.Printf("[Commands] scan failed: %v", err)
			continue
		}
		result = append(result, c)
	}
	return result, nil
}

// scanDBCommand 从单行读取 dbCommand，供 listAll/get 复用。
func scanDBCommand(rows *sql.Rows) (dbCommand, error) {
	var c dbCommand
	err := rows.Scan(&c.Cmd, &c.Label, &c.Desc, &c.Icon, &c.AllowTask, &c.AllowRepos,
		&c.RequireRepos, &c.RequireTask, &c.MaxRepos, &c.Enabled, &c.Template, &c.CometTemplate, &c.IsBuiltin, &c.SortOrder)
	return c, err
}

// get 按 cmd 查询单条，found=false 表示不存在。
func (s *commandStore) get(cmd string) (dbCommand, bool, error) {
	if s.db == nil {
		return dbCommand{}, false, nil
	}
	var c dbCommand
	err := s.db.QueryRow(`SELECT `+commandSelectColumns+` FROM platform_commands WHERE cmd = $1`, cmd).
		Scan(&c.Cmd, &c.Label, &c.Desc, &c.Icon, &c.AllowTask, &c.AllowRepos,
			&c.RequireRepos, &c.RequireTask, &c.MaxRepos, &c.Enabled, &c.Template, &c.CometTemplate, &c.IsBuiltin, &c.SortOrder)
	if err == sql.ErrNoRows {
		return dbCommand{}, false, nil
	}
	if err != nil {
		return dbCommand{}, false, err
	}
	return c, true, nil
}

// upsertBuiltinOverride 写入/更新系统指令的 enabled override。
// 系统指令核心字段始终来自 commands.yaml，DB 仅持久化 enabled 状态。
func (s *commandStore) upsertBuiltinOverride(cmd string, enabled bool) error {
	_, err := s.db.Exec(`INSERT INTO platform_commands (cmd, enabled, is_builtin, updated_at)
		VALUES ($1, $2, true, CURRENT_TIMESTAMP)
		ON CONFLICT (cmd) DO UPDATE SET enabled = $2, is_builtin = true, updated_at = CURRENT_TIMESTAMP`,
		cmd, enabled)
	return err
}

// createCustom 创建自定义指令（is_builtin=false）。
func (s *commandStore) createCustom(c dbCommand) error {
	_, err := s.db.Exec(`INSERT INTO platform_commands
		(cmd, label, description, icon, allow_task, allow_repos, require_repos, require_task, max_repos, enabled, template, comet_template, is_builtin, sort_order)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,$13)`,
		c.Cmd, c.Label, c.Desc, c.Icon, c.AllowTask, c.AllowRepos, c.RequireRepos,
		c.RequireTask, c.MaxRepos, c.Enabled, c.Template, c.CometTemplate, c.SortOrder)
	return err
}

// updateCustom 更新自定义指令全字段（仅 is_builtin=false 的行）。
func (s *commandStore) updateCustom(c dbCommand) error {
	_, err := s.db.Exec(`UPDATE platform_commands SET
		label=$1, description=$2, icon=$3, allow_task=$4, allow_repos=$5, require_repos=$6,
		require_task=$7, max_repos=$8, enabled=$9, template=$10, comet_template=$11, sort_order=$12,
		updated_at=CURRENT_TIMESTAMP
		WHERE cmd=$13 AND is_builtin=false`,
		c.Label, c.Desc, c.Icon, c.AllowTask, c.AllowRepos, c.RequireRepos,
		c.RequireTask, c.MaxRepos, c.Enabled, c.Template, c.CometTemplate, c.SortOrder, c.Cmd)
	return err
}

// deleteCustom 删除自定义指令（仅 is_builtin=false 的行）。
func (s *commandStore) deleteCustom(cmd string) error {
	_, err := s.db.Exec(`DELETE FROM platform_commands WHERE cmd=$1 AND is_builtin=false`, cmd)
	return err
}

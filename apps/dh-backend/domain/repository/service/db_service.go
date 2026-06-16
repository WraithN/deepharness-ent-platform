package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
	"github.com/google/uuid"
)

// DBRepositoryService 是基于 PostgreSQL 的 RepositoryService 实现。
type DBRepositoryService struct {
	db        *sql.DB
	gitClient *gitrepo.GitClient
	locksMu   sync.Mutex
	syncLocks map[string]*sync.Mutex
}

func (s *DBRepositoryService) repoLock(repoID string) *sync.Mutex {
	s.locksMu.Lock()
	defer s.locksMu.Unlock()
	if s.syncLocks == nil {
		s.syncLocks = make(map[string]*sync.Mutex)
	}
	mu, ok := s.syncLocks[repoID]
	if !ok {
		mu = &sync.Mutex{}
		s.syncLocks[repoID] = mu
	}
	return mu
}

// NewDBRepositoryService 创建 DBRepositoryService。
func NewDBRepositoryService(db *sql.DB, root string) *DBRepositoryService {
	return &DBRepositoryService{
		db:        db,
		gitClient: gitrepo.NewGitClient(root),
	}
}

// List 列出工作空间下所有仓库。
func (s *DBRepositoryService) List(workspaceID string) ([]repository.Repository, error) {
	rows, err := s.db.Query(`
		SELECT id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, last_sync_at, error_message, config, created_at, updated_at
		FROM repositories WHERE workspace_id = $1 ORDER BY created_at DESC
	`, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("list repositories failed: %w", err)
	}
	defer rows.Close()

	result := make([]repository.Repository, 0)
	for rows.Next() {
		r, err := scanRepository(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate repositories failed: %w", err)
	}
	return result, nil
}

// Get 获取单个仓库。
func (s *DBRepositoryService) Get(workspaceID, repoID string) (repository.Repository, error) {
	row := s.db.QueryRow(`
		SELECT id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, last_sync_at, error_message, config, created_at, updated_at
		FROM repositories WHERE id = $1 AND workspace_id = $2
	`, repoID, workspaceID)
	return scanRepository(row)
}

// Create 创建仓库并触发异步 clone。
func (s *DBRepositoryService) Create(workspaceID string, req CreateRepositoryRequest) (repository.Repository, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return repository.Repository{}, err
	}

	now := time.Now().UTC()
	r := repository.Repository{
		ID:            uuid.New().String(),
		WorkspaceID:   workspaceID,
		Name:          req.Name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		SSHKey:        req.SSHKey,
		LocalPath:     s.gitClient.DefaultLocalPath(workspaceID, req.Name),
		CloneStatus:   repository.CloneStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	configStr, err := sqlutil.MarshalConfig(nil)
	if err != nil {
		return repository.Repository{}, err
	}

	_, err = s.db.Exec(`
		INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, r.ID, r.WorkspaceID, r.Name, r.URL, r.Type, r.DefaultBranch, r.SSHKey, r.LocalPath, r.CloneStatus, configStr, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("insert repository failed: %w", err)
	}

	go s.syncRepository(r)
	return r, nil
}

// Update 更新仓库并触发同步（clone 或 pull）。
func (s *DBRepositoryService) Update(workspaceID, repoID string, req UpdateRepositoryRequest) (repository.Repository, error) {
	existing, err := s.Get(workspaceID, repoID)
	if err != nil {
		return repository.Repository{}, err
	}

	if req.Name != "" {
		existing.Name = req.Name
		existing.LocalPath = s.gitClient.DefaultLocalPath(workspaceID, req.Name)
	}
	if req.URL != "" {
		existing.URL = req.URL
	}
	if req.Type != "" {
		existing.Type = repository.RepoType(req.Type)
	}
	if req.DefaultBranch != "" {
		existing.DefaultBranch = req.DefaultBranch
	}
	if req.SSHKey != "" {
		existing.SSHKey = req.SSHKey
	}

	_, err = s.db.Exec(`
		UPDATE repositories
		SET name = $1, url = $2, type = $3, default_branch = $4, ssh_key = $5, local_path = $6, updated_at = $7
		WHERE id = $8 AND workspace_id = $9
	`, existing.Name, existing.URL, existing.Type, existing.DefaultBranch, existing.SSHKey, existing.LocalPath, time.Now().UTC(), existing.ID, existing.WorkspaceID)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("update repository failed: %w", err)
	}

	go s.syncRepository(existing)
	return s.Get(workspaceID, repoID)
}

// Delete 删除仓库记录并清理本地目录。
func (s *DBRepositoryService) Delete(workspaceID, repoID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	res, err := s.db.Exec(`DELETE FROM repositories WHERE id = $1 AND workspace_id = $2`, repoID, workspaceID)
	if err != nil {
		return fmt.Errorf("delete repository failed: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected failed: %w", err)
	}
	if n == 0 {
		return errors.New("repository not found")
	}

	if r.LocalPath != "" {
		if err := os.RemoveAll(r.LocalPath); err != nil {
			log.Printf("[Repository] failed to remove local path %s: %v", r.LocalPath, err)
		}
	}
	return nil
}

// Sync 手动触发仓库同步。
func (s *DBRepositoryService) Sync(workspaceID, repoID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	go s.syncRepository(r)
	return nil
}

// syncRepository 执行 clone 或 pull，并更新数据库状态。
func (s *DBRepositoryService) syncRepository(r repository.Repository) {
	mu := s.repoLock(r.ID)
	mu.Lock()
	defer mu.Unlock()

	s.updateStatus(r.ID, repository.CloneStatusCloning, "")

	exists := false
	if _, err := os.Stat(filepath.Join(r.LocalPath, ".git")); err == nil {
		exists = true
	}

	var err error
	if exists {
		err = s.gitClient.Pull(r.LocalPath, r.SSHKey)
	} else {
		err = s.gitClient.Clone(r.URL, r.LocalPath, r.SSHKey, r.DefaultBranch)
	}

	if err != nil {
		s.updateStatus(r.ID, repository.CloneStatusFailed, err.Error())
		return
	}
	now := time.Now().UTC()
	s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
}

func (s *DBRepositoryService) updateStatus(id string, status repository.CloneStatus, errMsg string) {
	if _, err := s.db.Exec(`UPDATE repositories SET clone_status = $1, error_message = $2 WHERE id = $3`, status, errMsg, id); err != nil {
		log.Printf("[Repository] update status failed for %s: %v", id, err)
	}
}

func (s *DBRepositoryService) updateStatusAndSyncTime(id string, status repository.CloneStatus, t *time.Time) {
	if _, err := s.db.Exec(`UPDATE repositories SET clone_status = $1, last_sync_at = $2, error_message = $3 WHERE id = $4`, status, t, "", id); err != nil {
		log.Printf("[Repository] update sync time failed for %s: %v", id, err)
	}
}

func (s *DBRepositoryService) workspaceExists(workspaceID string) error {
	var id string
	err := s.db.QueryRow(`SELECT id FROM workspaces WHERE id = $1`, workspaceID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return errors.New("workspace not found")
	}
	if err != nil {
		return fmt.Errorf("check workspace exists failed: %w", err)
	}
	return nil
}

// scannable 兼容 *sql.Row 与 *sql.Rows。
type scannable interface {
	Scan(dest ...any) error
}

func scanRepository(row scannable) (repository.Repository, error) {
	var r repository.Repository
	var defaultBranch, sshKey, localPath, errorMessage sql.NullString
	var lastSyncAt sql.NullTime
	var config sql.NullString

	err := row.Scan(
		&r.ID, &r.WorkspaceID, &r.Name, &r.URL, &r.Type,
		&defaultBranch, &sshKey, &localPath, &r.CloneStatus,
		&lastSyncAt, &errorMessage, &config,
		&r.CreatedAt, &r.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return repository.Repository{}, errors.New("repository not found")
	}
	if err != nil {
		return repository.Repository{}, fmt.Errorf("scan repository failed: %w", err)
	}

	r.DefaultBranch = sqlutil.ScanNullString(defaultBranch)
	r.SSHKey = sqlutil.ScanNullString(sshKey)
	r.LocalPath = sqlutil.ScanNullString(localPath)
	r.ErrorMessage = sqlutil.ScanNullString(errorMessage)
	if lastSyncAt.Valid {
		r.LastSyncAt = &lastSyncAt.Time
	}
	r.Config, err = sqlutil.UnmarshalConfig(config)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("unmarshal repository config failed: %w", err)
	}
	return r, nil
}

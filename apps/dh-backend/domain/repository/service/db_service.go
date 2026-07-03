package service

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
	"github.com/google/uuid"
)

// DBRepositoryService 是基于 PostgreSQL 的 RepositoryService 实现。
type DBRepositoryService struct {
	db            *sql.DB
	gitClient     *gitrepo.GitClient
	keyResolver   SSHKeyResolver
	workspaceRoot string
	locksMu       sync.Mutex
	syncLocks     map[string]*sync.Mutex
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

// NewDBRepositoryService 创建 DBRepositoryService。keyResolver 用于解析操作者的 SSH Key。
// root 为工作空间根目录，既用于 git clone 存储，也用于用户级 projects 目录。
func NewDBRepositoryService(db *sql.DB, root string, keyResolver SSHKeyResolver) *DBRepositoryService {
	return &DBRepositoryService{
		db:            db,
		gitClient:     gitrepo.NewGitClient(root),
		keyResolver:   keyResolver,
		workspaceRoot: root,
		syncLocks:     make(map[string]*sync.Mutex),
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

// Create 创建仓库并触发异步 clone。仓库名称由 URL 解析，SSH Key 取自操作者 Profile。
func (s *DBRepositoryService) Create(workspaceID, userID string, req CreateRepositoryRequest) (repository.Repository, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return repository.Repository{}, err
	}

	name := ParseRepoName(req.URL)
	now := time.Now().UTC()
	r := repository.Repository{
		ID:            uuid.New().String(),
		WorkspaceID:   workspaceID,
		Name:          name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		LocalPath:     s.gitClient.DefaultLocalPath(workspaceID, name),
		CloneStatus:   repository.CloneStatusPending,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	sshKey, keyErr := s.resolveSSHKey(userID)
	if keyErr != nil {
		log.Printf("[Repository] Create resolveSSHKey failed for user %s: %v", userID, keyErr)
	}
	r.SSHKey = sshKey

	configStr, err := sqlutil.MarshalConfig(nil)
	if err != nil {
		return repository.Repository{}, err
	}

	_, err = s.db.Exec(`
		INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, r.ID, r.WorkspaceID, r.Name, r.URL, r.Type, r.DefaultBranch, sshKey, r.LocalPath, r.CloneStatus, configStr, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("insert repository failed: %w", err)
	}

	go s.syncRepository(r, sshKey)
	return r, nil
}

// Update 更新仓库并触发同步。URL 变更时仓库名称与本地路径同步重算。
func (s *DBRepositoryService) Update(workspaceID, repoID, userID string, req UpdateRepositoryRequest) (repository.Repository, error) {
	existing, err := s.Get(workspaceID, repoID)
	if err != nil {
		return repository.Repository{}, err
	}

	if req.URL != "" {
		existing.URL = req.URL
		// URL 变更时重新解析名称与本地路径
		existing.Name = ParseRepoName(req.URL)
		existing.LocalPath = s.gitClient.DefaultLocalPath(workspaceID, existing.Name)
	}
	if req.Type != "" {
		existing.Type = repository.RepoType(req.Type)
	}
	if req.DefaultBranch != "" {
		existing.DefaultBranch = req.DefaultBranch
	}

	sshKey, keyErr := s.resolveSSHKey(userID)
	if keyErr != nil {
		log.Printf("[Repository] Update resolveSSHKey failed for user %s: %v", userID, keyErr)
	}
	existing.SSHKey = sshKey

	_, err = s.db.Exec(`
		UPDATE repositories
		SET name = $1, url = $2, type = $3, default_branch = $4, ssh_key = $5, local_path = $6, updated_at = $7
		WHERE id = $8 AND workspace_id = $9
	`, existing.Name, existing.URL, existing.Type, existing.DefaultBranch, sshKey, existing.LocalPath, time.Now().UTC(), existing.ID, existing.WorkspaceID)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("update repository failed: %w", err)
	}

	go s.syncRepository(existing, sshKey)
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

// Sync 手动触发仓库同步，使用操作者的 SSH Key。
func (s *DBRepositoryService) Sync(workspaceID, repoID, userID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	go s.syncRepository(r, r.SSHKey)
	return nil
}

// syncRepository 执行 clone 或 pull，并更新数据库状态。sshKey 由操作者 Profile 提供。
func (s *DBRepositoryService) syncRepository(r repository.Repository, sshKey string) {
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
		err = s.gitClient.Pull(r.LocalPath, r.URL, sshKey)
	} else {
		err = s.gitClient.Clone(r.URL, r.LocalPath, sshKey, r.DefaultBranch, func(int) {})
	}

	if err != nil {
		s.updateStatus(r.ID, repository.CloneStatusFailed, err.Error())
		return
	}
	now := time.Now().UTC()
	s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
}

// isValidSSHKey 校验是否为有效的 SSH 私钥格式。
func isValidSSHKey(key string) bool {
	key = strings.TrimSpace(key)
	if key == "" {
		return false
	}
	privateKeyHeaders := []string{
		"-----BEGIN OPENSSH PRIVATE KEY-----",
		"-----BEGIN RSA PRIVATE KEY-----",
		"-----BEGIN DSA PRIVATE KEY-----",
		"-----BEGIN EC PRIVATE KEY-----",
		"-----BEGIN PRIVATE KEY-----",
	}
	for _, prefix := range privateKeyHeaders {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// resolveSSHKey 解析操作者的 SSH Key，校验格式并返回。
func (s *DBRepositoryService) resolveSSHKey(userID string) (string, error) {
	if s.keyResolver == nil || userID == "" {
		return "", errors.New("密钥解析器未初始化")
	}
	key, err := s.keyResolver.ResolveSSHKey(userID)
	if err != nil {
		return "", fmt.Errorf("解析 SSH 密钥失败: %w", err)
	}
	if key == "" {
		return "", errors.New("SSH 密钥未配置，请先在个人设置中添加 SSH 私钥")
	}
	if !isValidSSHKey(key) {
		return "", errors.New("SSH 私钥格式无效，请确认粘贴的是完整私钥内容（以 '-----BEGIN ... PRIVATE KEY-----' 开头），而非公钥")
	}
	return key, nil
}

// ── 用户级仓库操作 ──

// userProjectPath 构建用户 projects 目录下某个仓库的本地路径。
// 路径格式：WORKSPACE_ROOT/{workspaceID}/{userID}/projects/{repoName}
func (s *DBRepositoryService) userProjectPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(s.workspaceRoot, workspaceID, userID, "projects", safeName)
}

// userSyncLockPath 构建用户仓库同步锁文件的路径。
// 路径格式：WORKSPACE_ROOT/{workspaceID}/{userID}/projects/{repoName}.clone.lock
func (s *DBRepositoryService) userSyncLockPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(s.workspaceRoot, workspaceID, userID, "projects", safeName+".clone.lock")
}

// hasSyncLock 检查是否存在同步锁文件（表示正在同步中）。
func (s *DBRepositoryService) hasSyncLock(workspaceID, userID, repoName string) bool {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return false
	}
	_, err := os.Stat(lockPath)
	return err == nil
}

// writeSyncLock 写入同步锁文件，内容为进度百分比。
func (s *DBRepositoryService) writeSyncLock(workspaceID, userID, repoName string, progress int) error {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return errors.New("workspace root is not configured")
	}
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		log.Printf("[Repository] writeSyncLock mkdir failed for %s: %v", repoName, err)
		return err
	}
	if err := os.WriteFile(lockPath, []byte(strconv.Itoa(progress)), 0o644); err != nil {
		log.Printf("[Repository] writeSyncLock write failed for %s: %v", repoName, err)
		return err
	}
	return nil
}

// deleteSyncLock 删除同步锁文件（同步完成或失败后清理）。
func (s *DBRepositoryService) deleteSyncLock(workspaceID, userID, repoName string) {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return
	}
	if err := os.Remove(lockPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[Repository] deleteSyncLock failed for %s: %v", repoName, err)
	}
}

// readSyncProgress 读取同步锁文件中的进度值，文件不存在时返回 0。
func (s *DBRepositoryService) readSyncProgress(workspaceID, userID, repoName string) int {
	lockPath := s.userSyncLockPath(workspaceID, userID, repoName)
	if lockPath == "" {
		return 0
	}
	data, err := os.ReadFile(lockPath)
	if err != nil {
		return 0
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0
	}
	return v
}

// userSyncErrorPath 构建同步错误文件的路径。
func (s *DBRepositoryService) userSyncErrorPath(workspaceID, userID, repoName string) string {
	if s.workspaceRoot == "" {
		return ""
	}
	safeName := gitrepo.SanitizePathSegment(repoName)
	return filepath.Join(s.workspaceRoot, workspaceID, userID, "projects", safeName+".clone.error")
}

// writeSyncError 写入同步错误信息到 .clone.error 文件。
func (s *DBRepositoryService) writeSyncError(workspaceID, userID, repoName, errMsg string) {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(errPath), 0o755); err != nil {
		log.Printf("[Repository] writeSyncError mkdir failed for %s: %v", repoName, err)
		return
	}
	if err := os.WriteFile(errPath, []byte(errMsg), 0o644); err != nil {
		log.Printf("[Repository] writeSyncError write failed for %s: %v", repoName, err)
	}
}

// readSyncError 读取同步错误文件的内容，文件不存在时返回空串。
func (s *DBRepositoryService) readSyncError(workspaceID, userID, repoName string) string {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return ""
	}
	data, err := os.ReadFile(errPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

// deleteSyncError 删除同步错误文件（重新同步时清理）。
func (s *DBRepositoryService) deleteSyncError(workspaceID, userID, repoName string) {
	errPath := s.userSyncErrorPath(workspaceID, userID, repoName)
	if errPath == "" {
		return
	}
	if err := os.Remove(errPath); err != nil && !os.IsNotExist(err) {
		log.Printf("[Repository] deleteSyncError failed for %s: %v", repoName, err)
	}
}

// isUserRepoSynced 检查用户 projects 目录下仓库是否已同步完成。
// 优先检查锁文件（正在同步中返回 false），然后 fallback 到 .git 目录检查。
func (s *DBRepositoryService) isUserRepoSynced(workspaceID, userID, repoName string) bool {
	if s.hasSyncLock(workspaceID, userID, repoName) {
		return false
	}
	p := s.userProjectPath(workspaceID, userID, repoName)
	if p == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(p, ".git"))
	return err == nil
}

// ListUserRepos 列出工作空间下所有配置仓库在用户 projects 目录中的同步状态。
func (s *DBRepositoryService) ListUserRepos(workspaceID, userID string) ([]UserRepoStatus, error) {
	repos, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}
	result := make([]UserRepoStatus, 0, len(repos))
	for _, r := range repos {
		syncing := s.hasSyncLock(workspaceID, userID, r.Name)
		synced := s.isUserRepoSynced(workspaceID, userID, r.Name)
		status := UserRepoStatus{
			RepositoryID:  r.ID,
			Name:          r.Name,
			URL:           r.URL,
			Type:          string(r.Type),
			DefaultBranch: r.DefaultBranch,
			Synced:        synced,
		}
		if syncing {
			status.SyncStatus = STATE_SYNCING
			status.Progress = s.readSyncProgress(workspaceID, userID, r.Name)
		} else if synced {
			status.SyncStatus = STATE_SYNCED
		} else if errMsg := s.readSyncError(workspaceID, userID, r.Name); errMsg != "" {
			status.SyncStatus = STATE_FAILED
			status.ErrorMessage = errMsg
		}
		result = append(result, status)
	}
	return result, nil
}

// SyncUserRepo 将指定仓库异步克隆到用户 projects 目录。
// SSH Key 取自当前用户的 Profile，若未配置则返回错误提示。
func (s *DBRepositoryService) SyncUserRepo(workspaceID, repoID, userID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	// 仅 SSH URL 需要私钥；HTTPS/git:// 无需
	sshKey := ""
	if gitrepo.IsSSHURL(r.URL) {
		var keyErr error
		sshKey, keyErr = s.resolveSSHKey(userID)
		if keyErr != nil {
			return fmt.Errorf("SSH 密钥校验失败: %w", keyErr)
		}
	}

	// 如果已经同步完成，直接返回
	if s.isUserRepoSynced(workspaceID, userID, r.Name) {
		return nil
	}
	// 如果正在同步中（锁文件存在），直接返回
	if s.hasSyncLock(workspaceID, userID, r.Name) {
		return nil
	}

	dest := s.userProjectPath(workspaceID, userID, r.Name)
	if dest == "" {
		return errors.New("workspace root is not configured")
	}

	// 写入锁文件，标记同步开始
	if err := s.writeSyncLock(workspaceID, userID, r.Name, 0); err != nil {
		log.Printf("[Repository] SyncUserRepo writeSyncLock failed for %s: %v", r.Name, err)
		return err
	}

	go func() {
		defer s.deleteSyncLock(workspaceID, userID, r.Name)

		// 清理上次同步残留的错误信息
		s.deleteSyncError(workspaceID, userID, r.Name)

		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			s.writeSyncError(workspaceID, userID, r.Name, fmt.Sprintf("创建项目目录失败: %v", err))
			log.Printf("[Repository] create user project dir %s failed: %v", dest, err)
			return
		}
		if _, err := os.Stat(dest); err == nil {
			_ = os.RemoveAll(dest)
		}
		if err := s.gitClient.Clone(r.URL, dest, sshKey, r.DefaultBranch, func(pct int) {
			_ = s.writeSyncLock(workspaceID, userID, r.Name, pct)
		}); err != nil {
			s.writeSyncError(workspaceID, userID, r.Name, fmt.Sprintf("克隆仓库失败: %v", err))
			log.Printf("[Repository] user repo sync failed for %s: %v", r.Name, err)
			return
		}
		log.Printf("[Repository] user repo sync completed: %s -> %s", r.Name, dest)
	}()

	return nil
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

// Scan 扫描工作空间目录下的本地 Git 仓库并自动导入到数据库。
func (s *DBRepositoryService) Scan(workspaceID string) ([]ScannedRepository, error) {
	workspaceRoot := filepath.Join(s.gitClient.Root(), workspaceID)
	if _, err := os.Stat(workspaceRoot); os.IsNotExist(err) {
		if err := os.MkdirAll(workspaceRoot, 0755); err != nil {
			return nil, fmt.Errorf("create workspace directory failed: %w", err)
		}
	}

	existingRepos, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}
	existingPaths := make(map[string]repository.Repository)
	for _, r := range existingRepos {
		if r.LocalPath != "" {
			existingPaths[r.LocalPath] = r
		}
	}

	result := []ScannedRepository{}

	err = filepath.Walk(workspaceRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() || info.Name() != ".git" {
			return nil
		}

		repoDir := filepath.Dir(path)
		repoName := filepath.Base(repoDir)

		scanned := ScannedRepository{
			Name:     repoName,
			Path:     repoDir,
			IsCloned: true,
		}

		if url, err := gitExec(repoDir, "config", "--get", "remote.origin.url"); err == nil {
			scanned.URL = strings.TrimSpace(url)
		}

		if branch, err := gitExec(repoDir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
			scanned.CurrentBranch = strings.TrimSpace(branch)
		}

		if commit, err := gitExec(repoDir, "rev-parse", "HEAD"); err == nil {
			scanned.LastCommit = strings.TrimSpace(commit)
		}

		if msg, err := gitExec(repoDir, "log", "-1", "--pretty=%B"); err == nil {
			scanned.LastCommitMessage = strings.TrimSpace(msg)
			if len(scanned.LastCommitMessage) > 200 {
				scanned.LastCommitMessage = scanned.LastCommitMessage[:197] + "..."
			}
		}

		if t, err := gitExec(repoDir, "log", "-1", "--pretty=%ci"); err == nil {
			if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
				scanned.LastCommitTime = &pt
			}
		}

		// Auto-import to DB if not exists
		if existingRepo, exists := existingPaths[repoDir]; !exists {
			now := time.Now().UTC()
			id := uuid.New().String()
			_, err := s.db.Exec(`
				INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, local_path, clone_status, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			`, id, workspaceID, repoName, scanned.URL, "dev", scanned.CurrentBranch, repoDir, "cloned", now, now)
			if err != nil {
				log.Printf("[Repository] failed to auto-import %s: %v", repoName, err)
			}
		} else if existingRepo.LocalPath != repoDir || existingRepo.DefaultBranch != scanned.CurrentBranch {
			// Update existing repo if path or branch changed
			_, err := s.db.Exec(`
				UPDATE repositories 
				SET local_path = $1, default_branch = $2, updated_at = $3
				WHERE id = $4
			`, repoDir, scanned.CurrentBranch, time.Now().UTC(), existingRepo.ID)
			if err != nil {
				log.Printf("[Repository] failed to update %s: %v", repoName, err)
			}
		}

		result = append(result, scanned)
		return filepath.SkipDir
	})

	if err != nil {
		return nil, fmt.Errorf("scan repositories failed: %w", err)
	}

	return result, nil
}

// GetDetails 获取仓库详细信息。
func (s *DBRepositoryService) GetDetails(workspaceID, repoID string) (*RepositoryDetails, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	details := &RepositoryDetails{
		Repository: repo,
	}

	if repo.LocalPath == "" {
		return details, nil
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return details, nil
	}

	if total, err := gitExecInt(repo.LocalPath, "rev-list", "--count", "HEAD"); err == nil {
		details.CommitStats.TotalCommits = total
	}

	if lastWeek, err := gitExecInt(repo.LocalPath, "rev-list", "--count", "--since=1.week", "HEAD"); err == nil {
		details.CommitStats.LastWeek = lastWeek
	}

	if lastMonth, err := gitExecInt(repo.LocalPath, "rev-list", "--count", "--since=1.month", "HEAD"); err == nil {
		details.CommitStats.LastMonth = lastMonth
	}

	if t, err := gitExec(repo.LocalPath, "log", "-1", "--pretty=%ci"); err == nil {
		if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
			details.CommitStats.LastCommit = &pt
		}
	}

	if t, err := gitExec(repo.LocalPath, "log", "--reverse", "-1", "--pretty=%ci"); err == nil {
		if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
			details.CommitStats.FirstCommit = &pt
		}
	}

	if branches, err := gitExec(repo.LocalPath, "branch", "-v", "--format=%(refname:short);%(objectname);%(committerdate:iso8601)"); err == nil {
		currentBranch, _ := gitExec(repo.LocalPath, "rev-parse", "--abbrev-ref", "HEAD")
		currentBranch = strings.TrimSpace(currentBranch)

		for _, line := range strings.Split(branches, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.Split(line, ";")
			if len(parts) >= 2 {
				bi := BranchInfo{
					Name:       parts[0],
					IsCurrent:  parts[0] == currentBranch,
					LastCommit: parts[1],
				}
				if len(parts) >= 3 && parts[2] != "" {
					if t, err := time.Parse("2006-01-02 15:04:05 -0700", parts[2]); err == nil {
						bi.LastCommitTime = &t
					}
				}
				details.Branches = append(details.Branches, bi)
			}
		}
	}

	if contributors, err := gitExec(repo.LocalPath, "shortlog", "-sn", "HEAD"); err == nil {
		for _, line := range strings.Split(contributors, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if parts := strings.SplitN(line, "\t", 2); len(parts) == 2 {
				details.Contributors = append(details.Contributors, strings.TrimSpace(parts[1]))
			}
		}
	}

	if out, err := gitExec(repo.LocalPath, "ls-files", "-z"); err == nil {
		details.FileCount = strings.Count(out, "\000")
	}

	// Calculate total file size from git ls-files
	if fileList, err := gitExec(repo.LocalPath, "ls-files"); err == nil {
		var totalSize int64 = 0
		for _, file := range strings.Split(fileList, "\n") {
			file = strings.TrimSpace(file)
			if file == "" {
				continue
			}
			fullPath := filepath.Join(repo.LocalPath, file)
			if info, err := os.Stat(fullPath); err == nil {
				totalSize += info.Size()
			}
		}
		details.SizeBytes = totalSize
	}

	details.Language = detectLanguage(repo.LocalPath)

	return details, nil
}

func gitExec(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func gitExecInt(dir string, args ...string) (int, error) {
	out, err := gitExec(dir, args...)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(out))
}

func strconvParseInt(s string, base int, bitSize int) (int64, error) {
	return strconv.ParseInt(s, base, bitSize)
}

func detectLanguage(repoDir string) string {
	extCounts := make(map[string]int)
	err := filepath.Walk(repoDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || strings.Contains(path, ".git") {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != "" {
			extCounts[ext]++
		}
		return nil
	})
	if err != nil {
		return ""
	}

	langMap := map[string]string{
		".go":    "Go",
		".js":    "JavaScript",
		".ts":    "TypeScript",
		".jsx":   "React",
		".tsx":   "React",
		".py":    "Python",
		".java":  "Java",
		".rb":    "Ruby",
		".php":   "PHP",
		".rs":    "Rust",
		".cpp":   "C++",
		".c":     "C",
		".h":     "C/C++ Header",
		".cs":    "C#",
		".swift": "Swift",
		".kt":    "Kotlin",
		".scala": "Scala",
		".vue":   "Vue",
		".html":  "HTML",
		".css":   "CSS",
		".scss":  "SCSS",
		".sql":   "SQL",
		".sh":    "Shell",
		".md":    "Markdown",
	}

	maxCount := 0
	maxExt := ""
	for ext, count := range extCounts {
		if count > maxCount {
			maxCount = count
			maxExt = ext
		}
	}

	if lang, ok := langMap[maxExt]; ok {
		return lang
	}
	return "Other"
}

// GetFileTree 获取仓库文件树，尊重 .gitignore，按指定顺序排序。
func (s *DBRepositoryService) GetFileTree(workspaceID, repoID, branch string) ([]FileNode, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	if repo.LocalPath == "" {
		return nil, fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("repository local path not found")
	}

	// Load .gitignore patterns
	ignorePatterns := loadGitignorePatterns(repo.LocalPath)

	// Collect all file paths with directory info
	type pathInfo struct {
		path  string
		isDir bool
	}
	var paths []pathInfo
	err = filepath.Walk(repo.LocalPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if path == repo.LocalPath {
			return nil
		}
		relPath, _ := filepath.Rel(repo.LocalPath, path)
		isGitDir := relPath == ".git" || strings.HasPrefix(relPath, ".git"+string(filepath.Separator))
		if isGitDir || isIgnored(relPath, ignorePatterns) {
			if info.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		paths = append(paths, pathInfo{path: relPath, isDir: info.IsDir()})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("failed to walk directory: %w", err)
	}

	// Build tree using map of pointers
	type node struct {
		Name     string
		Path     string
		Type     string
		Children []*node
	}
	rootMap := make(map[string]*node)
	var roots []*node

	for _, p := range paths {
		parts := strings.Split(p.path, string(filepath.Separator))
		currentPath := ""
		var parent *node
		for i, part := range parts {
			currentPath = filepath.Join(currentPath, part)
			isLeaf := i == len(parts)-1

			if existing, ok := rootMap[currentPath]; ok {
				parent = existing
				continue
			}

			n := &node{
				Name: part,
				Path: currentPath,
				Type: "folder",
			}
			if isLeaf && !p.isDir {
				n.Type = "file"
			}
			rootMap[currentPath] = n

			if parent == nil {
				roots = append(roots, n)
			} else {
				parent.Children = append(parent.Children, n)
			}
			parent = n
		}
	}

	// Convert to final FileNode structure recursively
	var convert func(*node) FileNode
	convert = func(n *node) FileNode {
		children := make([]FileNode, len(n.Children))
		for i, c := range n.Children {
			children[i] = convert(c)
		}
		return FileNode{
			Name:     n.Name,
			Path:     n.Path,
			Type:     n.Type,
			Children: children,
		}
	}

	result := make([]FileNode, len(roots))
	for i, r := range roots {
		result[i] = convert(r)
	}

	sortFileNodes(&result)

	return result, nil
}

// loadGitignorePatterns 读取 .gitignore 文件并返回所有模式
func loadGitignorePatterns(repoRoot string) []string {
	var patterns []string

	gitignorePath := filepath.Join(repoRoot, ".gitignore")
	data, err := os.ReadFile(gitignorePath)
	if err != nil {
		return patterns
	}

	lines := strings.Split(string(data), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		// Skip comments and empty lines
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}

	return patterns
}

// isIgnored 检查文件路径是否匹配 .gitignore 模式（简化版）
func isIgnored(path string, patterns []string) bool {
	for _, pattern := range patterns {
		matched, _ := filepath.Match(pattern, filepath.Base(path))
		if matched {
			return true
		}
		// Check for directory pattern or partial path match
		matched, _ = filepath.Match(pattern, path)
		if matched {
			return true
		}
		// Check prefix for recursive patterns
		if strings.HasSuffix(pattern, "/") && strings.HasPrefix(path, strings.TrimSuffix(pattern, "/")) {
			return true
		}
	}
	return false
}

// isHidden 检查是否为隐藏文件/目录（.开头）
func isHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

// sortFileNodes 按指定顺序排序：隐藏目录 -> 目录 -> 隐藏文件 -> 文件，字母序
func sortFileNodes(nodes *[]FileNode) {
	sort.Slice(*nodes, func(i, j int) bool {
		a := (*nodes)[i]
		b := (*nodes)[j]

		aIsFolder := a.Type == "folder"
		bIsFolder := b.Type == "folder"
		aIsHidden := isHidden(a.Name)
		bIsHidden := isHidden(b.Name)

		// 隐藏目录优先
		if aIsFolder && aIsHidden && (!bIsFolder || !bIsHidden) {
			return true
		}
		if bIsFolder && bIsHidden && (!aIsFolder || !aIsHidden) {
			return false
		}

		// 普通目录次之
		if aIsFolder && !aIsHidden && !bIsFolder {
			return true
		}
		if bIsFolder && !bIsHidden && !aIsFolder {
			return false
		}

		// 隐藏文件再次之
		if !aIsFolder && aIsHidden && !bIsHidden {
			return true
		}
		if !bIsFolder && bIsHidden && !aIsHidden {
			return false
		}

		// 同类型按字母排序（不区分大小写）
		return strings.ToLower(a.Name) < strings.ToLower(b.Name)
	})

	// 递归排序子目录
	for i := range *nodes {
		if len((*nodes)[i].Children) > 0 {
			sortFileNodes(&(*nodes)[i].Children)
		}
	}
}

// GetFileContent 获取文件内容。
func (s *DBRepositoryService) GetFileContent(workspaceID, repoID, branch, path string) (*FileContent, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	if repo.LocalPath == "" {
		return nil, fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("repository local path not found")
	}

	// 优先读取本地工作区文件（以便显示编辑后的内容）
	fullPath := filepath.Join(repo.LocalPath, path)
	var content string
	if data, err := os.ReadFile(fullPath); err == nil {
		content = string(data)
	} else {
		// 本地文件不存在时，从 git 读取
		targetBranch := branch
		if targetBranch == "" {
			targetBranch = repo.DefaultBranch
		}
		gitContent, err := gitExec(repo.LocalPath, "show", fmt.Sprintf("%s:%s", targetBranch, path))
		if err != nil {
			return nil, fmt.Errorf("failed to get file content: %w", err)
		}
		content = gitContent
	}

	ext := strings.ToLower(filepath.Ext(path))
	language := map[string]string{
		".go":   "go",
		".js":   "javascript",
		".ts":   "typescript",
		".jsx":  "jsx",
		".tsx":  "tsx",
		".py":   "python",
		".java": "java",
		".rb":   "ruby",
		".php":  "php",
		".rs":   "rust",
		".cpp":  "cpp",
		".c":    "c",
		".h":    "c",
		".cs":   "csharp",
		".vue":  "vue",
		".html": "html",
		".css":  "css",
		".scss": "scss",
		".sql":  "sql",
		".sh":   "shell",
		".md":   "markdown",
		".json": "json",
		".yaml": "yaml",
		".yml":  "yaml",
	}[ext]
	if language == "" {
		language = "text"
	}

	return &FileContent{
		Path:     path,
		Name:     filepath.Base(path),
		Content:  content,
		Language: language,
		Encoding: "utf-8",
		Size:     int64(len(content)),
	}, nil
}

// GetBranches 获取仓库分支列表。
func (s *DBRepositoryService) GetBranches(workspaceID, repoID string) ([]BranchInfo, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	if repo.LocalPath == "" {
		return nil, fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("repository local path not found")
	}

	// Fetch latest from remote first
	_, _ = gitExec(repo.LocalPath, "fetch", "origin")

	currentBranch, err := gitExec(repo.LocalPath, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return nil, fmt.Errorf("failed to get current branch: %w", err)
	}
	currentBranch = strings.TrimSpace(currentBranch)

	// List all local and remote branches
	branchesOut, err := gitExec(repo.LocalPath, "branch", "-av", "--format=%(refname:short);%(objectname);%(committerdate:iso8601)")
	if err != nil {
		return nil, fmt.Errorf("failed to list branches: %w", err)
	}

	seenBranches := make(map[string]bool)
	var branches []BranchInfo
		for _, line := range strings.Split(branchesOut, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		parts := strings.Split(line, ";")
		if len(parts) >= 2 {
			branchName := parts[0]
			// Skip HEAD references (origin/HEAD) and remote dir itself (origin)
			if branchName == "HEAD" || branchName == "origin" || strings.HasPrefix(branchName, "origin/HEAD") {
				continue
			}
			// Remove origin/ prefix for display
			displayName := strings.TrimPrefix(branchName, "origin/")
			if seenBranches[displayName] {
				continue
			}
			seenBranches[displayName] = true
			
			bi := BranchInfo{
				Name:       displayName,
				IsRemote:   strings.HasPrefix(branchName, "origin/"),
				IsCurrent:  displayName == currentBranch,
				LastCommit: parts[1],
			}
			if len(parts) >= 3 && parts[2] != "" {
				if t, err := time.Parse("2006-01-02 15:04:05 -0700", parts[2]); err == nil {
					bi.LastCommitTime = &t
				}
			}
			branches = append(branches, bi)
		}
	}

	return branches, nil
}

// SwitchBranch 切换分支并拉取最新代码。
func (s *DBRepositoryService) SwitchBranch(workspaceID, repoID, branchName string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	if repo.LocalPath == "" {
		return fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return fmt.Errorf("repository local path not found")
	}

	// Fetch latest from remote
	_, _ = gitExec(repo.LocalPath, "fetch", "origin")

	// Check if branch exists locally
	localBranchExists := false
	if branchesOut, err := gitExec(repo.LocalPath, "branch", "--list", branchName); err == nil {
		localBranchExists = strings.TrimSpace(branchesOut) != ""
	}

	var checkoutErr error
	if localBranchExists {
		// Branch exists locally, just checkout
		_, checkoutErr = gitExec(repo.LocalPath, "checkout", branchName)
	} else {
		// Branch doesn't exist locally, checkout tracking branch from remote
		_, checkoutErr = gitExec(repo.LocalPath, "checkout", "-t", "origin/"+branchName)
	}
	if checkoutErr != nil {
		return fmt.Errorf("failed to checkout branch %s: %w", branchName, checkoutErr)
	}

	// Pull latest changes
	if _, err := gitExec(repo.LocalPath, "pull"); err != nil {
		// Pull may fail if no remote tracking configured, but checkout succeeded
		log.Printf("[Repository] pull failed (non-critical): %v", err)
	}

	// Update default_branch in database
	_, err = s.db.Exec(`
		UPDATE repositories 
		SET default_branch = $1, updated_at = $2
		WHERE id = $3
	`, branchName, time.Now().UTC(), repoID)
	if err != nil {
		log.Printf("[Repository] failed to update default branch: %v", err)
	}

	return nil
}

// SaveFileContent 保存文件内容到本地文件系统
func (s *DBRepositoryService) SaveFileContent(workspaceID, repoID, path, content string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}

	if repo.LocalPath == "" {
		return fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return fmt.Errorf("repository local path not found")
	}

	fullPath := filepath.Join(repo.LocalPath, path)

	// Ensure parent directory exists
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Write file content
	if err := os.WriteFile(fullPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %w", err)
	}

	return nil
}

// GitCommit 提交更改到 git
func (s *DBRepositoryService) GitCommit(workspaceID, repoID, message string) (string, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return "", err
	}

	if repo.LocalPath == "" {
		return "", fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return "", fmt.Errorf("repository local path not found")
	}

	// Add all changes
	if _, err := gitExec(repo.LocalPath, "add", "."); err != nil {
		return "", fmt.Errorf("failed to add changes: %w", err)
	}

	// Commit
	commitMsg := message
	if commitMsg == "" {
		commitMsg = "Update files via web interface"
	}
	if _, err := gitExec(repo.LocalPath, "commit", "-m", commitMsg); err != nil {
		// Check if there are no changes to commit
		if strings.Contains(err.Error(), "nothing to commit") {
			return "", fmt.Errorf("no changes to commit")
		}
		return "", fmt.Errorf("failed to commit: %w", err)
	}

	// Get commit hash
	hash, err := gitExec(repo.LocalPath, "rev-parse", "HEAD")
	if err != nil {
		return "", fmt.Errorf("failed to get commit hash: %w", err)
	}

	return strings.TrimSpace(hash), nil
}

// GitStatus 获取 git 状态（未提交的更改）
func (s *DBRepositoryService) GitStatus(workspaceID, repoID string) (string, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return "", err
	}

	if repo.LocalPath == "" {
		return "", fmt.Errorf("repository not cloned yet")
	}

	if _, err := os.Stat(repo.LocalPath); os.IsNotExist(err) {
		return "", fmt.Errorf("repository local path not found")
	}

	status, err := gitExec(repo.LocalPath, "status", "--porcelain")
	if err != nil {
		return "", fmt.Errorf("failed to get status: %w", err)
	}

	return strings.TrimSpace(status), nil
}

package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/crypto"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/gitutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/sqlutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	gitrepo "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common"
)

// DBRepositoryService 是基于 PostgreSQL 的 RepositoryService 实现。
type DBRepositoryService struct {
	db            *sql.DB
	gitClient     *gitrepo.GitClient
	keyResolver   SSHKeyResolver
	workspaceRoot string
	locksMu       sync.Mutex
	syncLocks     map[string]*sync.Mutex
	branchCache   BranchCache
	// encryptionKey 用于加密存储 SSH 私钥（AES-256-GCM）。为空时明文存储（开发环境）。
	encryptionKey []byte
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
// encryptionKey 用于加密存储 SSH 私钥，为空时明文存储（开发环境兼容）。
func NewDBRepositoryService(db *sql.DB, root string, keyResolver SSHKeyResolver, encryptionKey []byte) (*DBRepositoryService, error) {
	gitClient, err := gitrepo.NewGitClient(root)
	if err != nil {
		return nil, fmt.Errorf("create git client: %w", err)
	}
	return &DBRepositoryService{
		db:            db,
		gitClient:     gitClient,
		keyResolver:   keyResolver,
		workspaceRoot: root,
		syncLocks:     make(map[string]*sync.Mutex),
		branchCache:   NewMemoryBranchCache(),
		encryptionKey: encryptionKey,
	}, nil
}

// SetBranchCache 注入分支缓存实现（Redis 或内存）。
func (s *DBRepositoryService) SetBranchCache(cache BranchCache) {
	s.branchCache = cache
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
		r.SSHKey = s.decryptSSHKey(r.SSHKey)
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
	r, err := scanRepository(row)
	if err != nil {
		return repository.Repository{}, err
	}
	r.SSHKey = s.decryptSSHKey(r.SSHKey)
	return r, nil
}

// Create 创建仓库并触发异步 clone。仓库名称由 URL 解析，SSH Key 取自操作者 Profile。
func (s *DBRepositoryService) Create(workspaceID, userID string, req object.CreateRepositoryRequest) (repository.Repository, error) {
	if err := s.workspaceExists(workspaceID); err != nil {
		return repository.Repository{}, err
	}

	name := ParseRepoName(req.URL)
	now := time.Now().UTC()
	r := repository.Repository{
		ID:            idutil.GenerateID(),
		WorkspaceID:   workspaceID,
		Name:          name,
		URL:           req.URL,
		Type:          repository.RepoType(req.Type),
		DefaultBranch: req.DefaultBranch,
		LocalPath:     s.gitClient.DefaultLocalPath(userID, workspaceID, name),
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

	// 加密 SSH Key 后存入 DB，防止数据库泄露导致私钥暴露
	encryptedKey, encErr := crypto.Encrypt(sshKey, s.encryptionKey)
	if encErr != nil {
		return repository.Repository{}, fmt.Errorf("encrypt ssh key failed: %w", encErr)
	}

	_, err = s.db.Exec(`
		INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, ssh_key, local_path, clone_status, config, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
	`, r.ID, r.WorkspaceID, r.Name, r.URL, r.Type, r.DefaultBranch, encryptedKey, r.LocalPath, r.CloneStatus, configStr, r.CreatedAt, r.UpdatedAt)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("insert repository failed: %w", err)
	}

	safego.Go("repo-sync-create", func() { s.syncRepository(r, sshKey) })
	return r, nil
}

// Update 更新仓库并触发同步。URL 变更时仓库名称与本地路径同步重算。
func (s *DBRepositoryService) Update(workspaceID, repoID, userID string, req object.UpdateRepositoryRequest) (repository.Repository, error) {
	existing, err := s.Get(workspaceID, repoID)
	if err != nil {
		return repository.Repository{}, err
	}

	if req.URL != "" {
		existing.URL = req.URL
		// URL 变更时重新解析名称与本地路径
		existing.Name = ParseRepoName(req.URL)
		existing.LocalPath = s.gitClient.DefaultLocalPath(userID, workspaceID, existing.Name)
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

	// 本地路径已存在且 URL 变更时，同步更新 git remote origin URL。
	if req.URL != "" && existing.LocalPath != "" && existing.CloneStatus == repository.CloneStatusCloned {
		if err := s.gitClient.SetRemoteURL(existing.LocalPath, req.URL); err != nil {
			log.Printf("[Repository] Update SetRemoteURL failed for repo %s: %v", repoID, err)
		}
	}

	// 加密 SSH Key 后存入 DB
	encryptedKey, encErr := crypto.Encrypt(sshKey, s.encryptionKey)
	if encErr != nil {
		return repository.Repository{}, fmt.Errorf("encrypt ssh key failed: %w", encErr)
	}

	_, err = s.db.Exec(`
		UPDATE repositories
		SET name = $1, url = $2, type = $3, default_branch = $4, ssh_key = $5, local_path = $6, updated_at = $7
		WHERE id = $8 AND workspace_id = $9
	`, existing.Name, existing.URL, existing.Type, existing.DefaultBranch, encryptedKey, existing.LocalPath, time.Now().UTC(), existing.ID, existing.WorkspaceID)
	if err != nil {
		return repository.Repository{}, fmt.Errorf("update repository failed: %w", err)
	}

	safego.Go("repo-sync-update", func() { s.syncRepository(existing, sshKey) })
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
		return common.NotFoundErrorf("repository not found")
	}

	if r.LocalPath != "" {
		// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
		ctx := context.Background()
		if sc := stubclient.FromContext(ctx); sc != nil {
			if err := sc.RemoveDir(ctx, r.LocalPath); err != nil {
				log.Printf("[Repository] failed to remove local path %s: %v", r.LocalPath, err)
			}
		}
	}
	return nil
}

// Sync 手动触发仓库同步，重新从用户 profile 解析 SSH Key（确保配置后即时生效）。
func (s *DBRepositoryService) Sync(workspaceID, repoID, userID string) error {
	r, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	// 重新解析 SSH Key 并更新仓库记录，修复创建时未配置 Key 的场景
	sshKey, _ := s.resolveSSHKey(userID)
	if sshKey != "" {
		r.SSHKey = sshKey
		if encKey, encErr := crypto.Encrypt(sshKey, s.encryptionKey); encErr == nil {
			s.db.Exec(`UPDATE repositories SET ssh_key = $1, updated_at = $2 WHERE id = $3`, encKey, time.Now().UTC(), r.ID)
		}
	}
	// 修复 local_path 为空（创建时缺少 Auth 中间件导致 userID 为空，DefaultLocalPath 返回空）
	if r.LocalPath == "" && userID != "" {
		r.LocalPath = s.gitClient.DefaultLocalPath(userID, workspaceID, r.Name)
		s.db.Exec(`UPDATE repositories SET local_path = $1, updated_at = $2 WHERE id = $3`, r.LocalPath, time.Now().UTC(), r.ID)
	}
	safego.Go("repo-sync-manual", func() { s.syncRepository(r, r.SSHKey) })
	return nil
}

// syncRepository 执行 clone 或 pull，并更新数据库状态。sshKey 由操作者 Profile 提供。
// 该方法通过 safego.Go 在异步 goroutine 中调用，无调用方 context，使用 context.Background() 作为根 context。
func (s *DBRepositoryService) syncRepository(r repository.Repository, sshKey string) {
	mu := s.repoLock(r.ID)
	mu.Lock()
	defer mu.Unlock()

	s.updateStatus(r.ID, repository.CloneStatusCloning, "")

	ctx := context.Background()
	exists := false
	sc := stubclient.FromContext(ctx)
	if sc != nil {
		gitPath := filepath.Join(r.LocalPath, ".git")
		if ok, err := sc.FileExists(ctx, gitPath); err == nil && ok {
			exists = true
		}
	}

	var err error
	if exists {
		err = s.gitClient.Pull(r.LocalPath, r.URL, sshKey)
	} else {
		// 架构合规：传 nil 进度回调使 Clone 使用 go-git 纯 Go 库，不 exec git 命令。
		err = s.gitClient.Clone(r.URL, r.LocalPath, sshKey, r.DefaultBranch, nil)
	}

	if err != nil {
		s.updateStatus(r.ID, repository.CloneStatusFailed, err.Error())
		return
	}
	now := time.Now().UTC()
	s.updateStatusAndSyncTime(r.ID, repository.CloneStatusCloned, &now)
}

// SetRemoteURL 设置仓库的远程 origin URL 并同步更新本地仓库 remote。
func (s *DBRepositoryService) SetRemoteURL(workspaceID, repoID, userID, rawURL string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	if repo.LocalPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return fmt.Errorf("repository not cloned yet")
	}

	sshKey, _ := s.resolveSSHKey(userID)
	repo.URL = rawURL
	repo.Name = ParseRepoName(rawURL)
	repo.SSHKey = sshKey

	// 先更新本地 remote，再更新 DB；本地失败时返回错误便于前端提示。
	if err := s.gitClient.SetRemoteURL(repo.LocalPath, rawURL); err != nil {
		return fmt.Errorf("set remote url failed: %w", err)
	}

	encryptedKey, encErr := crypto.Encrypt(sshKey, s.encryptionKey)
	if encErr != nil {
		return fmt.Errorf("encrypt ssh key failed: %w", encErr)
	}

	_, err = s.db.Exec(`
		UPDATE repositories
		SET name = $1, url = $2, ssh_key = $3, updated_at = $4
		WHERE id = $5 AND workspace_id = $6
	`, repo.Name, repo.URL, encryptedKey, time.Now().UTC(), repo.ID, repo.WorkspaceID)
	if err != nil {
		return fmt.Errorf("update repository url failed: %w", err)
	}
	return nil
}

// Push 推送仓库当前分支到远程 origin。
func (s *DBRepositoryService) Push(workspaceID, repoID, userID string) error {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return err
	}
	if repo.LocalPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return fmt.Errorf("repository not cloned yet")
	}
	if repo.URL == "" {
		return fmt.Errorf("remote URL not configured")
	}

	sshKey, keyErr := s.resolveSSHKey(userID)
	if keyErr != nil {
		return fmt.Errorf("resolve ssh key failed: %w", keyErr)
	}
	if err := s.gitClient.Push(repo.LocalPath, repo.URL, sshKey); err != nil {
		return fmt.Errorf("git push failed: %w", err)
	}
	return nil
}

// GetUnpushedCommits 返回本地仓库中尚未推送到远程的提交数量。
func (s *DBRepositoryService) GetUnpushedCommits(workspaceID, repoID, userID string) (int, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return 0, err
	}
	if repo.LocalPath == "" || repo.CloneStatus != repository.CloneStatusCloned {
		return 0, nil
	}

	ctx := context.Background()
	out, err := gitutil.Exec(ctx, repo.LocalPath, "rev-list", "--count", "HEAD", "--not", "--remotes")
	if err != nil {
		return 0, fmt.Errorf("count unpushed commits failed: %w", err)
	}
	count, _ := strconv.Atoi(strings.TrimSpace(out))
	if count < 0 {
		count = 0
	}
	return count, nil
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

// decryptSSHKey 解密从数据库读取的 SSH Key。
// 解密失败时返回空字符串并记录日志，避免阻断列表/详情查询。
func (s *DBRepositoryService) decryptSSHKey(encrypted string) string {
	plaintext, err := crypto.Decrypt(encrypted, s.encryptionKey)
	if err != nil {
		log.Printf("[Repository] decrypt ssh key failed: %v", err)
		return ""
	}
	return plaintext
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
		return common.NotFoundErrorf("workspace not found")
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
		return repository.Repository{}, common.NotFoundErrorf("repository not found")
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

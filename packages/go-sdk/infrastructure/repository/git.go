package repository

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
	"golang.org/x/crypto/ssh"
)

// DEFAULT_WORKSPACE_ROOT 是所有仓库本地克隆的根目录。
const DEFAULT_WORKSPACE_ROOT = "/var/deepharness/workspace"

// sanitizePathSegment 移除路径段中的穿越和分隔符，避免路径穿越。
func sanitizePathSegment(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "/", "-")
	s = strings.ReplaceAll(s, "\\", "-")
	return strings.TrimSpace(s)
}

// buildLocalPath 在 root 下生成安全的本地路径，并校验不逃出 root。
func buildLocalPath(root, workspaceID, repoName string) (string, error) {
	safeWS := sanitizePathSegment(workspaceID)
	safeName := sanitizePathSegment(repoName)
	if safeWS == "" || safeName == "" {
		return "", fmt.Errorf("workspace id and repo name are required")
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve root path failed: %w", err)
	}

	p := filepath.Join(absRoot, safeWS, safeName)
	if !strings.HasPrefix(p, absRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid local path: %s", p)
	}
	return p, nil
}

// DefaultLocalPath 使用默认根目录生成仓库本地路径。
func DefaultLocalPath(workspaceID, repoName string) string {
	p, err := buildLocalPath(DEFAULT_WORKSPACE_ROOT, workspaceID, repoName)
	if err != nil {
		return ""
	}
	return p
}

// GitClient 封装基于 go-git 的克隆/拉取能力。
type GitClient struct {
	root string
}

// NewGitClient 创建 GitClient，root 为空时使用 DEFAULT_WORKSPACE_ROOT。
func NewGitClient(root string) *GitClient {
	if root == "" {
		root = DEFAULT_WORKSPACE_ROOT
	}
	return &GitClient{root: root}
}

// DefaultLocalPath 生成仓库默认本地路径。
func (c *GitClient) DefaultLocalPath(workspaceID, repoName string) string {
	p, err := buildLocalPath(c.root, workspaceID, repoName)
	if err != nil {
		return ""
	}
	return p
}

// Root 返回仓库根目录路径。
func (c *GitClient) Root() string {
	return c.root
}

// authFromKey 从 SSH 私钥文本构造 go-git 认证器。
func authFromKey(privateKey string) (gitssh.AuthMethod, error) {
	if privateKey == "" {
		return nil, fmt.Errorf("ssh private key is empty")
	}
	signer, err := ssh.ParsePrivateKey([]byte(privateKey))
	if err != nil {
		return nil, fmt.Errorf("parse private key failed: %w", err)
	}
	return &gitssh.PublicKeys{User: "git", Signer: signer}, nil
}

// Clone 将远程仓库克隆到 dest。branch 为空时依次尝试 main、master。
func (c *GitClient) Clone(url, dest, sshKey, branch string) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("create repo parent dir failed: %w", err)
	}

	auth, err := authFromKey(sshKey)
	if err != nil {
		return err
	}

	opts := &git.CloneOptions{
		URL:  url,
		Auth: auth,
	}
	if branch != "" {
		opts.ReferenceName = plumbing.NewBranchReferenceName(branch)
		opts.SingleBranch = true
	}

	_, err = git.PlainClone(dest, false, opts)
	if err != nil && branch == "" {
		_ = os.RemoveAll(dest)
		opts.ReferenceName = plumbing.NewBranchReferenceName("main")
		opts.SingleBranch = true
		_, err = git.PlainClone(dest, false, opts)
		if err != nil {
			_ = os.RemoveAll(dest)
			opts.ReferenceName = plumbing.NewBranchReferenceName("master")
			_, err = git.PlainClone(dest, false, opts)
		}
	}
	if err != nil {
		_ = os.RemoveAll(dest)
		return fmt.Errorf("git clone failed: %w", err)
	}
	return nil
}

// Pull 在已克隆目录执行 git pull。
func (c *GitClient) Pull(dest, sshKey string) error {
	auth, err := authFromKey(sshKey)
	if err != nil {
		return err
	}

	r, err := git.PlainOpen(dest)
	if err != nil {
		return fmt.Errorf("open repo failed: %w", err)
	}

	w, err := r.Worktree()
	if err != nil {
		return fmt.Errorf("get worktree failed: %w", err)
	}

	if err := w.Pull(&git.PullOptions{Auth: auth}); err != nil {
		if err == git.NoErrAlreadyUpToDate {
			return nil
		}
		return fmt.Errorf("git pull failed: %w", err)
	}
	return nil
}

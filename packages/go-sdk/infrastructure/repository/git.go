package repository

import (
	"bufio"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/transport"
	githttp "github.com/go-git/go-git/v5/plumbing/transport/http"
	gitssh "github.com/go-git/go-git/v5/plumbing/transport/ssh"
	"golang.org/x/crypto/ssh"

	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/safego"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
)

// SanitizePathSegment 移除路径段中的穿越和分隔符，避免路径穿越。
func SanitizePathSegment(s string) string {
	s = strings.ReplaceAll(s, "..", "")
	s = strings.ReplaceAll(s, "/", "-")
	s = strings.ReplaceAll(s, "\\", "-")
	return strings.TrimSpace(s)
}

// buildLocalPath 在 root 下生成安全的本地路径，并校验不逃出 root。
// 路径结构：{root}/{userID}/{workspaceID}/dev-jobs/{repoName}，与 resolveWorkspacePath 保持一致。
func buildLocalPath(root, userID, workspaceID, repoName string) (string, error) {
	safeUser := SanitizePathSegment(userID)
	safeWS := SanitizePathSegment(workspaceID)
	safeName := SanitizePathSegment(repoName)
	if safeUser == "" || safeWS == "" || safeName == "" {
		return "", fmt.Errorf("user id, workspace id and repo name are required")
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve root path failed: %w", err)
	}

	p := filepath.Join(absRoot, safeUser, safeWS, workspacepath.DirDevJobs, safeName)
	if !strings.HasPrefix(p, absRoot+string(filepath.Separator)) {
		return "", fmt.Errorf("invalid local path: %s", p)
	}
	return p, nil
}

// GitClient 封装基于 go-git 的克隆/拉取能力。
type GitClient struct {
	root string
}

// NewGitClient 创建 GitClient，root 为空时返回错误（fail-fast），
// 避免静默使用错误的默认路径。
func NewGitClient(root string) (*GitClient, error) {
	if root == "" {
		return nil, fmt.Errorf("workspace root must not be empty")
	}
	return &GitClient{root: root}, nil
}

// DefaultLocalPath 生成仓库默认本地路径。
// 路径结构：{root}/{userID}/{workspaceID}/dev-jobs/{repoName}，与 resolveWorkspacePath 保持一致。
func (c *GitClient) DefaultLocalPath(userID, workspaceID, repoName string) string {
	p, err := buildLocalPath(c.root, userID, workspaceID, repoName)
	if err != nil {
		return ""
	}
	return p
}

// Root 返回仓库根目录路径。
func (c *GitClient) Root() string {
	return c.root
}

// DEFAULT_GIT_USER 是 git 操作的默认用户名。
const DEFAULT_GIT_USER = "git"

// resolveAuth 根据仓库 URL scheme 选择合适的认证方式。
// credential 在 SSH 场景下为私钥文本，HTTPS 场景下为密码或个人访问令牌。
// git:// 协议无需认证，返回 nil。
func resolveAuth(rawURL, credential string) (transport.AuthMethod, error) {
	scheme := detectGitScheme(rawURL)
	switch scheme {
	case "ssh":
		return authSSH(credential)
	case "https":
		return authHTTPS(rawURL, credential)
	case "git":
		return nil, nil
	default:
		return nil, fmt.Errorf("unsupported git URL scheme: %s", scheme)
	}
}

// detectGitScheme 识别 git URL 的协议类型：
//   - ssh:// 或 git@host:path → "ssh"
//   - https:// 或 http://    → "https"
//   - git://                  → "git"
func detectGitScheme(rawURL string) string {
	if strings.HasPrefix(rawURL, "https://") || strings.HasPrefix(rawURL, "http://") {
		return "https"
	}
	if strings.HasPrefix(rawURL, "ssh://") {
		return "ssh"
	}
	if strings.HasPrefix(rawURL, "git://") {
		return "git"
	}
	if strings.Contains(rawURL, "@") && strings.Contains(rawURL, ":") {
		return "ssh"
	}
	return ""
}

// IsSSHURL 判断 URL 是否为 SSH 格式（需要 SSH 私钥）。
func IsSSHURL(rawURL string) bool {
	return detectGitScheme(rawURL) == "ssh"
}

// IsValidGitURL 判断给定的 URL 是否为受支持的 git 地址格式（SSH、HTTPS、git://）。
func IsValidGitURL(rawURL string) bool {
	return detectGitScheme(rawURL) != ""
}

// authSSH 从 SSH 私钥文本构造 go-git SSH 认证器。
func authSSH(privateKey string) (transport.AuthMethod, error) {
	if privateKey == "" {
		return nil, fmt.Errorf("ssh private key is empty")
	}
	if !strings.HasSuffix(privateKey, "\n") {
		privateKey += "\n"
	}
	signer, err := ssh.ParsePrivateKey([]byte(privateKey))
	if err != nil {
		return nil, fmt.Errorf("parse private key failed: %w", err)
	}
	return &gitssh.PublicKeys{User: DEFAULT_GIT_USER, Signer: signer}, nil
}

// authHTTPS 从 URL 和凭证构造 HTTP Basic 认证器。
// 优先使用 URL 中嵌入的用户名，否则使用 DEFAULT_GIT_USER。
// 若凭证为空，返回 nil（匿名访问公开仓库）。
func authHTTPS(rawURL, credential string) (transport.AuthMethod, error) {
	if credential == "" {
		return nil, nil
	}
	username := extractUserFromURL(rawURL)
	if username == "" {
		username = DEFAULT_GIT_USER
	}
	return &githttp.BasicAuth{Username: username, Password: credential}, nil
}

// extractUserFromURL 从 URL 解析用户名（https://user@host/...）。
func extractUserFromURL(rawURL string) string {
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return u.User.Username()
}

// parseProgress 从 git clone 进度输出行中提取百分比并回调。
func parseProgress(line string, fn func(int)) {
	pos := strings.Index(line, "%")
	if pos <= 0 {
		return
	}
	start := pos - 1
	for start > 0 && line[start] >= '0' && line[start] <= '9' {
		start--
	}
	start++
	if start >= pos {
		return
	}
	if v, err := strconv.Atoi(line[start:pos]); err == nil && v >= 0 && v <= 100 {
		fn(v)
	}
}

// Clone 将远程仓库克隆到 dest。branch 为空时依次尝试 main、master。
// progressFn 可选，用于接收克隆进度百分比（0-100）。提供 progressFn 时使用 os/exec
// 执行原生 git clone --progress 以获取可靠的进度输出。
func (c *GitClient) Clone(url, dest, sshKey, branch string, progressFn func(int)) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return fmt.Errorf("create repo parent dir failed: %w", err)
	}

	if progressFn != nil {
		return c.cloneWithExec(url, dest, sshKey, branch, progressFn)
	}
	return c.cloneWithGoGit(url, dest, sshKey, branch)
}

// cloneWithGoGit 使用 go-git 库执行克隆，适用于不需要进度回调的场景。
func (c *GitClient) cloneWithGoGit(rawURL, dest, sshKey, branch string) error {
	auth, err := resolveAuth(rawURL, sshKey)
	if err != nil {
		return err
	}

	opts := &git.CloneOptions{
		URL:  rawURL,
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

// cloneWithExec 使用原生 git clone --progress 获取可靠的进度输出。
func (c *GitClient) cloneWithExec(rawURL, dest, sshKey, branch string, progressFn func(int)) error {
	scheme := detectGitScheme(rawURL)
	var env []string
	var cleanup func()

	switch scheme {
	case "ssh":
		keyFile, err := writeTempSSHKey(sshKey)
		if err != nil {
			return err
		}
		cleanup = func() { os.Remove(keyFile) }
		env = append(os.Environ(),
			fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null", keyFile))
	case "https":
		cloneURL, err := embedCredentials(rawURL, sshKey)
		if err != nil {
			return err
		}
		rawURL = cloneURL
	}

	if cleanup != nil {
		defer cleanup()
	}

	args := []string{"clone", "--progress"}
	if branch != "" {
		args = append(args, "-b", branch, "--single-branch")
	}
	args = append(args, rawURL, dest)

	cmd := exec.Command("git", args...)
	if env != nil {
		cmd.Env = env
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	scannerDone := make(chan struct{})
	var stderrLines []string
	safego.Go("git-stderr-scanner", func() {
		defer close(scannerDone)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			parseProgress(line, progressFn)
			stderrLines = append(stderrLines, line)
		}
	})

	err = cmd.Wait()
	<-scannerDone
	if err != nil {
		return fmt.Errorf("git clone failed: %w (stderr: %s)", err, strings.Join(stderrLines, "; "))
	}
	progressFn(100)
	return nil
}

// writeTempSSHKey 将 SSH 私钥写入临时文件并设置 0600 权限。
func writeTempSSHKey(sshKey string) (string, error) {
	if sshKey == "" {
		return "", fmt.Errorf("ssh private key is empty")
	}
	f, err := os.CreateTemp("", "dh-ssh-key-*")
	if err != nil {
		return "", fmt.Errorf("create temp ssh key file failed: %w", err)
	}
	name := f.Name()
	if !strings.HasSuffix(sshKey, "\n") {
		sshKey += "\n"
	}
	if _, err := f.WriteString(sshKey); err != nil {
		f.Close()
		os.Remove(name)
		return "", err
	}
	if err := f.Chmod(0600); err != nil {
		f.Close()
		os.Remove(name)
		return "", err
	}
	if err := f.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}

// embedCredentials 将 HTTPS 凭证嵌入到 clone URL 中。
func embedCredentials(rawURL, credential string) (string, error) {
	if credential == "" {
		return rawURL, nil
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return rawURL, err
	}
	username := u.User.Username()
	if username == "" {
		username = DEFAULT_GIT_USER
	}
	u.User = url.UserPassword(username, credential)
	return u.String(), nil
}

// Pull 在已克隆目录执行 git pull。
func (c *GitClient) Pull(dest, url, sshKey string) error {
	auth, err := resolveAuth(url, sshKey)
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

// SetRemoteURL 在已克隆目录设置（或创建）origin 远程地址。
func (c *GitClient) SetRemoteURL(dest, rawURL string) error {
	r, err := git.PlainOpen(dest)
	if err != nil {
		return fmt.Errorf("open repo failed: %w", err)
	}

	cfg, err := r.Config()
	if err != nil {
		return fmt.Errorf("load repo config failed: %w", err)
	}

	remoteCfg := cfg.Remotes["origin"]
	if remoteCfg == nil {
		remoteCfg = &config.RemoteConfig{
			Name: "origin",
			URLs: []string{rawURL},
		}
		cfg.Remotes["origin"] = remoteCfg
	} else {
		remoteCfg.URLs = []string{rawURL}
	}

	if err := r.SetConfig(cfg); err != nil {
		return fmt.Errorf("set remote url failed: %w", err)
	}
	return nil
}

// Push 在已克隆目录执行 git push origin。
func (c *GitClient) Push(dest, url, sshKey string) error {
	auth, err := resolveAuth(url, sshKey)
	if err != nil {
		return err
	}

	r, err := git.PlainOpen(dest)
	if err != nil {
		return fmt.Errorf("open repo failed: %w", err)
	}

	if err := r.Push(&git.PushOptions{Auth: auth, RemoteName: "origin"}); err != nil {
		if err == git.NoErrAlreadyUpToDate {
			return nil
		}
		return fmt.Errorf("git push failed: %w", err)
	}
	return nil
}

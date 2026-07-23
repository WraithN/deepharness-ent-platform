package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strings"
)

// GitExecRequest 是通用 git 命令执行请求。
type GitExecRequest struct {
	Path string   `json:"path"`
	Args []string `json:"args"`
}

// GitExecResponse 是通用 git 命令执行响应。
type GitExecResponse struct {
	Output string `json:"output"`
	Error  string `json:"error,omitempty"`
}

// gitShellUnsafeChars 是 git args 中禁止出现的 shell 注入字符。
const gitShellUnsafeChars = ";|&$\n`"

// ProjectGitExec 在指定目录下执行任意 git 命令并返回输出。
// POST /api/v1/projects/git-exec  body: {"path": "...", "args": ["log", "-1"]}
//
// 架构职责：personal-stub 负责在共享目录中执行 git 命令，
// dh-backend 通过此端点代理执行，不直接 exec git。
func ProjectGitExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req GitExecRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	if err := validateGitExecRequest(req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, err.Error())
		return
	}

	absPath := resolveAllowedPath(req.Path)
	if absPath == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	out, err := projectGitExec(absPath, req.Args...)
	logGitExecResult(absPath, req.Args, out, err)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(buildGitExecResponse(out, err))
}

// ProjectClone 克隆远程仓库到指定路径。
// POST /api/v1/projects/clone  body: {"url": "...", "path": "...", "sshKey": "...", "branch": "..."}
func ProjectClone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	var req struct {
		URL    string `json:"url"`
		Path   string `json:"path"`
		SSHKey string `json:"sshKey"`
		Branch string `json:"branch"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSONError(w, http.StatusBadRequest, 1, "invalid request body")
		return
	}
	if req.URL == "" || req.Path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "url and path are required")
		return
	}

	absPath := resolveAllowedPath(req.Path)
	if absPath == "" {
		WriteJSONError(w, http.StatusForbidden, 1, "path outside allowed root")
		return
	}

	args := []string{"clone"}
	if req.Branch != "" {
		args = append(args, "-b", req.Branch, "--single-branch")
	}
	args = append(args, req.URL, absPath)

	cmd := exec.Command("git", args...)
	if req.SSHKey != "" {
		keyFile, err := writeTempSSHKeyFile(req.SSHKey)
		if err != nil {
			WriteJSONError(w, http.StatusInternalServerError, 1, "failed to setup ssh key")
			return
		}
		defer os.Remove(keyFile)
		cmd.Env = append(os.Environ(),
			fmt.Sprintf("GIT_SSH_COMMAND=ssh -i %s -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null", keyFile))
	}

	out, err := cmd.CombinedOutput()
	logGitExecResult(absPath, args, string(out), err)
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(buildGitExecResponse(string(out), err))
}

// validateGitExecRequest 校验 git 执行请求的参数合法性。
func validateGitExecRequest(req GitExecRequest) error {
	if req.Path == "" {
		return fmt.Errorf("path is required")
	}
	if len(req.Args) == 0 {
		return fmt.Errorf("args is required")
	}
	for _, arg := range req.Args {
		if strings.ContainsAny(arg, gitShellUnsafeChars) {
			return fmt.Errorf("invalid character in git args")
		}
	}
	return nil
}

// logGitExecResult 记录 git 执行结果日志。
func logGitExecResult(dir string, args []string, out string, err error) {
	cmdStr := strings.Join(args, " ")
	if err != nil {
		log.Printf("[Projects] git exec failed in %s: git %s: %v (output: %s)", dir, cmdStr, err, out)
		return
	}
	log.Printf("[Projects] git exec ok in %s: git %s", dir, cmdStr)
}

// buildGitExecResponse 根据执行结果构建响应。
func buildGitExecResponse(out string, err error) GitExecResponse {
	if err != nil {
		return GitExecResponse{Output: out, Error: err.Error()}
	}
	return GitExecResponse{Output: out}
}

// writeTempSSHKeyFile 将 SSH 私钥写入临时文件并设置 0600 权限。
func writeTempSSHKeyFile(sshKey string) (string, error) {
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
	if err := f.Chmod(0o600); err != nil {
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

package handler

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"path/filepath"
)

// npmInstallRequest 是 npm install 请求体。
type npmInstallRequest struct {
	Path string `json:"path"`
}

// npmInstallResponse 是 npm install 响应体。
type npmInstallResponse struct {
	Success bool   `json:"success"`
	Output  string `json:"output"`
}

// NpmInstall 处理 POST /api/v1/projects/npm-install。
// 在指定目录执行 npm install（或 pnpm/yarn install），返回执行日志。
// 架构合规：dh-backend 通过 stubclient 委托 personal-stub 执行 npm 命令，
// 不直接 exec npm。
func NpmInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}
	var req npmInstallRequest
	if !DecodeJSONBody(w, r, &req) {
		return
	}
	if req.Path == "" {
		WriteJSONError(w, http.StatusBadRequest, 1, "path is required")
		return
	}
	if !filepath.IsAbs(req.Path) {
		WriteJSONError(w, http.StatusBadRequest, 1, "path must be absolute")
		return
	}

	// 复用 devserver_manager.go 中的 packageManager 判断包管理器
	pm := packageManager(req.Path)
	cmd := exec.Command(pm, "install")
	cmd.Dir = req.Path
	out, err := cmd.CombinedOutput()
	output := string(out)
	if err != nil {
		output = output + "\n" + err.Error()
		SetJSONHeader(w)
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(npmInstallResponse{Success: false, Output: output})
		return
	}
	SetJSONHeader(w)
	json.NewEncoder(w).Encode(npmInstallResponse{Success: true, Output: output})
}

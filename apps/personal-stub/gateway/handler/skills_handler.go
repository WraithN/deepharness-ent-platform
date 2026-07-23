package handler

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// 技能部署目标: shares/skills (与 shares/prototypes-templates 同级)。
const skillsSubdir = "skills"

var skillsFS embed.FS

// SetSkillsFS 设置内嵌的技能文件系统，供 handlers 使用。
func SetSkillsFS(efs embed.FS) {
	skillsFS = efs
}

// SkillMeta 对应 SKILL.md 的 YAML frontmatter。
type SkillMeta struct {
	Name        string   `yaml:"name"`
	ZhName      string   `yaml:"zh_name"`
	EnName      string   `yaml:"en_name"`
	Emoji       string   `yaml:"emoji"`
	Description string   `yaml:"description"`
	Category    string   `yaml:"category"`
	Scenario    string   `yaml:"scenario"`
	AspectHint  string   `yaml:"aspect_hint"`
	Tags        []string `yaml:"tags"`
}

// SkillInfo 是列表 API 返回的技能摘要。
type SkillInfo struct {
	SkillMeta
	SkillName string `json:"skill_name"`
}

// DeploySkills 将内嵌的全部 SKILL.md 部署到共享工作区目录。
func DeploySkills(workspaceRoot string) error {
	destDir := filepath.Join(workspaceRoot, "shares", skillsSubdir)

	entries, err := fs.ReadDir(skillsFS, skillsSubdir)
	if err != nil {
		return err
	}

	deployedCount := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillName := entry.Name()
		content, readErr := fs.ReadFile(skillsFS, path.Join(skillsSubdir, skillName, "SKILL.md"))
		if readErr != nil {
			log.Printf("[Skills] skip %s: %v", skillName, readErr)
			continue
		}

		skillDestDir := filepath.Join(destDir, skillName)
		if mkdirErr := os.MkdirAll(skillDestDir, 0755); mkdirErr != nil {
			return mkdirErr
		}
		if writeErr := os.WriteFile(filepath.Join(skillDestDir, "SKILL.md"), content, 0644); writeErr != nil {
			return writeErr
		}
		deployedCount++
	}

	log.Printf("[Skills] deployed %d skills to %s", deployedCount, destDir)
	return nil
}

// parseFrontmatter 从 SKILL.md 内容中提取 YAML frontmatter。
func parseFrontmatter(content string) (SkillMeta, string, error) {
	lines := strings.Split(content, "\n")
	var yamlLines []string
	inFrontmatter := false
	frontmatterDone := false
	bodyIndex := 0

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if i == 0 && trimmed == "---" {
			inFrontmatter = true
			continue
		}
		if inFrontmatter && trimmed == "---" {
			inFrontmatter = false
			frontmatterDone = true
			bodyIndex = i + 1
			break
		}
		if inFrontmatter {
			yamlLines = append(yamlLines, line)
		}
	}

	if !frontmatterDone {
		return SkillMeta{}, content, nil
	}

	var meta SkillMeta
	err := yaml.Unmarshal([]byte(strings.Join(yamlLines, "\n")), &meta)

	body := strings.Join(lines[bodyIndex:], "\n")
	return meta, body, err
}

// SkillsList 返回全部技能列表（含分类、标签等元信息）。
func SkillsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	entries, err := fs.ReadDir(skillsFS, skillsSubdir)
	if err != nil {
		WriteJSONError(w, http.StatusInternalServerError, 1, "failed to read skills")
		return
	}

	var skills []SkillInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillName := entry.Name()
		content, readErr := fs.ReadFile(skillsFS, path.Join(skillsSubdir, skillName, "SKILL.md"))
		if readErr != nil {
			continue
		}

		meta, _, parseErr := parseFrontmatter(string(content))
		if parseErr != nil {
			meta = SkillMeta{Name: skillName}
		}

		skills = append(skills, SkillInfo{
			SkillMeta: meta,
			SkillName: skillName,
		})
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(skills)
}

// SkillsContent 返回指定技能的 SKILL.md 完整内容。
func SkillsContent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		WriteJSONError(w, http.StatusMethodNotAllowed, 1, "method not allowed")
		return
	}

	name, ok := PathValueOr404(w, r, "name")
	if !ok {
		return
	}

	content, err := fs.ReadFile(skillsFS, path.Join(skillsSubdir, name, "SKILL.md"))
	if err != nil {
		WriteJSONError(w, http.StatusNotFound, 1, "skill not found: "+name)
		return
	}

	SetJSONHeader(w)
	json.NewEncoder(w).Encode(map[string]string{
		"name":    name,
		"content": string(content),
	})
}

package prompts

import (
	"bytes"
	"embed"
	"fmt"
	"strings"
	"text/template"

	"gopkg.in/yaml.v3"
)

//go:embed *.yaml
var promptFiles embed.FS

// promptTemplates 存储所有从 YAML 加载的提示词模板，按 key 索引。
var promptTemplates map[string]*template.Template

func init() {
	promptTemplates = make(map[string]*template.Template)

	entries, err := promptFiles.ReadDir(".")
	if err != nil {
		panic(fmt.Sprintf("prompts: failed to read embedded YAML files: %v", err))
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}
		raw, err := promptFiles.ReadFile(entry.Name())
		if err != nil {
			panic(fmt.Sprintf("prompts: failed to read %s: %v", entry.Name(), err))
		}

		var prompts map[string]string
		if err := yaml.Unmarshal(raw, &prompts); err != nil {
			panic(fmt.Sprintf("prompts: failed to parse %s: %v", entry.Name(), err))
		}

		for key, text := range prompts {
			tmpl, err := template.New(key).Parse(text)
			if err != nil {
				panic(fmt.Sprintf("prompts: failed to parse template %q in %s: %v", key, entry.Name(), err))
			}
			promptTemplates[key] = tmpl
		}
	}
}

// Render 根据 key 和参数渲染提示词模板。
// 参数通过 data map 传入，模板中使用 {{.Key}} 引用。
func Render(key string, data map[string]string) string {
	tmpl, ok := promptTemplates[key]
	if !ok {
		panic(fmt.Sprintf("prompts: template %q not found", key))
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		panic(fmt.Sprintf("prompts: failed to render template %q: %v", key, err))
	}
	return buf.String()
}

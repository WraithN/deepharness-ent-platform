package main

import "embed"

// SkillsFS 内嵌 html-anything 的全部 92 个 SKILL.md 设计模板。
//
//go:embed skills/*/SKILL.md
var SkillsFS embed.FS

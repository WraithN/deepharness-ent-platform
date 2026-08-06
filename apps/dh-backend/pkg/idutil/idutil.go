// Package idutil 提供统一的 ID 生成工具。
//
// 所有业务 ID 统一使用 NanoID（21 字符，URL 安全，122 位熵），
// 比 UUID 更短且无横线，适用于 URL、数据库主键等场景。
package idutil

import "github.com/aidarkhanov/nanoid/v2"

// GenerateID 生成 21 字符 NanoID，用作所有业务实体的主键。
// crypto/rand 失败时 panic（极少发生，通常意味着系统级故障）。
func GenerateID() string {
	id, err := nanoid.New()
	if err != nil {
		panic("idutil: failed to generate id: " + err.Error())
	}
	return id
}

// GenerateShortID 生成 8 字符 NanoID，用于需要短标识符的场景（如 pod 名称、消息 ID 前缀）。
func GenerateShortID() string {
	id, err := nanoid.GenerateString(nanoid.DefaultAlphabet, 8)
	if err != nil {
		panic("idutil: failed to generate short id: " + err.Error())
	}
	return id
}

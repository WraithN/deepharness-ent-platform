// Package crypto 提供 AES-GCM 对称加密工具，用于保护存储在数据库中的敏感数据（如 SSH 私钥）。
//
// 设计要点：
//   - 加密后的密文以 "enc:" 前缀标识，便于区分加密数据与历史明文数据
//   - key 为空时，Encrypt 返回原文、Decrypt 也返回原文（开发环境兼容）
//   - 使用 AES-256-GCM，每次加密生成随机 nonce，nonce 拼接在密文前部
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	// encPrefix 标识加密后的密文，便于 Decrypt 区分加密数据与历史明文数据。
	encPrefix = "enc:"
	// aesKeyLen AES-256 密钥长度（32 字节）。
	aesKeyLen = 32
)

// Encrypt 使用 AES-GCM 加密明文，返回带 "enc:" 前缀的 base64 编码密文。
// key 必须为 32 字节（AES-256）。若 key 为空，返回原文（开发环境兼容）。
func Encrypt(plaintext string, key []byte) (string, error) {
	if len(key) == 0 {
		return plaintext, nil
	}
	if len(key) != aesKeyLen {
		return "", fmt.Errorf("invalid key length: expected %d bytes, got %d", aesKeyLen, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create aes cipher failed: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create gcm failed: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce failed: %w", err)
	}

	// Seal 将 nonce 作为 dst 前缀，最终输出 = nonce + ciphertext + tag
	encrypted := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	encoded := base64.StdEncoding.EncodeToString(encrypted)
	return encPrefix + encoded, nil
}

// Decrypt 解密带 "enc:" 前缀的 base64 编码 AES-GCM 密文。
// 若密文不是加密格式（无 "enc:" 前缀），返回原文（兼容历史明文数据）。
// 若 key 为空，直接返回原文（开发环境兼容）。
func Decrypt(ciphertext string, key []byte) (string, error) {
	// key 为空时，开发环境兼容，直接返回原文
	if len(key) == 0 {
		return ciphertext, nil
	}
	// 无 "enc:" 前缀，兼容历史明文数据
	if !strings.HasPrefix(ciphertext, encPrefix) {
		return ciphertext, nil
	}

	if len(key) != aesKeyLen {
		return "", fmt.Errorf("invalid key length: expected %d bytes, got %d", aesKeyLen, len(key))
	}

	encoded := strings.TrimPrefix(ciphertext, encPrefix)
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("base64 decode failed: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create aes cipher failed: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create gcm failed: %w", err)
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, encrypted := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", fmt.Errorf("gcm decrypt failed: %w", err)
	}

	return string(plaintext), nil
}

// ParseKey 将 hex 编码的字符串解析为 AES-256 密钥（32 字节）。
// 若输入为空，返回 nil（开发环境兼容，不加密）。
func ParseKey(hexKey string) ([]byte, error) {
	if hexKey == "" {
		return nil, nil
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode hex key failed: %w", err)
	}
	if len(key) != aesKeyLen {
		return nil, fmt.Errorf("invalid key length: expected %d bytes, got %d", aesKeyLen, len(key))
	}
	return key, nil
}

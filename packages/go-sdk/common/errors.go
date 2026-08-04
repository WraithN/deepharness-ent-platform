package common

import (
	"errors"
	"fmt"
)

// 共享哨兵错误，用于 handler 层通过 errors.Is 识别错误类型，避免字符串匹配。
var (
	// ErrNotFound 表示资源不存在。
	ErrNotFound = errors.New("not found")
	// ErrAlreadyExists 表示资源已存在。
	ErrAlreadyExists = errors.New("already exists")
	// ErrForbidden 表示权限不足。
	ErrForbidden = errors.New("forbidden")
	// ErrInvalidInput 表示输入参数非法。
	ErrInvalidInput = errors.New("invalid input")
)

// ErrMemberNotFound 表示指定用户不是该工作空间的成员。
// 用于区分“成员不存在”与“成员存在但无权限”，避免统一返回 403 造成信息泄露。
var ErrMemberNotFound = NotFoundErrorf("workspace member not found")

// notFoundError 是一个包装了 ErrNotFound 但保留自定义消息的错误类型。
// 用于需要保持原有错误文本透传给调用方，同时又可被 errors.Is(err, common.ErrNotFound) 识别的场景。
type notFoundError struct {
	msg string
}

func (e *notFoundError) Error() string { return e.msg }
func (e *notFoundError) Unwrap() error  { return ErrNotFound }

// NotFoundErrorf 返回一个消息为格式化后文本、且可解包为 ErrNotFound 的错误。
// 与 fmt.Errorf("%w: ...", common.ErrNotFound, ...) 不同，它不会把 "not found:" 前缀强制附加到消息文本中，
// 适合服务层错误需要原样透传给前端或日志的场景。
func NotFoundErrorf(format string, a ...any) error {
	return &notFoundError{msg: fmt.Sprintf(format, a...)}
}

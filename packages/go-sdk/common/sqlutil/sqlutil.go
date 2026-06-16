package sqlutil

import (
	"database/sql"
	"encoding/json"
)

// NullString 将空字符串转换为数据库 NULL。
func NullString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// ScanNullString 读取 Nullable 字符串字段。
func ScanNullString(ns sql.NullString) string {
	return ns.String
}

// MarshalConfig 将任意对象序列化为 JSON 字符串，nil 时返回 NULL。
func MarshalConfig(v any) (sql.NullString, error) {
	if v == nil {
		return sql.NullString{}, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return sql.NullString{}, err
	}
	return sql.NullString{String: string(b), Valid: true}, nil
}

// UnmarshalConfig 将数据库 JSON 字符串反序列化为任意对象。
func UnmarshalConfig(ns sql.NullString) (any, error) {
	if !ns.Valid || ns.String == "" {
		return nil, nil
	}
	var v any
	if err := json.Unmarshal([]byte(ns.String), &v); err != nil {
		return nil, err
	}
	return v, nil
}

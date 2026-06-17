package workitemtracker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Common timestamp layouts used when parsing external date strings.
const (
	timestampLayoutRFC3339     = time.RFC3339
	timestampLayoutRFC3339Nano = time.RFC3339Nano
	timestampLayoutDateTimeT   = "2006-01-02T15:04:05"
	timestampLayoutDateTime    = "2006-01-02 15:04:05"
)

// HTTP header and endpoint placeholder constants.
const (
	authorizationHeader = "Authorization"
	bearerPrefix        = "Bearer "
	endpointPlaceholder = "{%s}"
)

// JSON wrapper constants.
const (
	wrapperDataFieldName = "data"
)

// Generic format and separator constants.
const (
	defaultFormatVerb   = "%v"
	fieldPathSeparator  = "."
)

// Error message format constants.
const (
	errFmtExpectedArrayOrDataField = "expected top-level array or %q field"
	errFmtDataFieldNotArray        = "%q field is not an array"
	errFmtDataItemNotObject        = "%q[%d] is not an object"
	errFmtUnparseableTimestamp     = "unparseable timestamp: %s"
)

// substituteEndpoint replaces {key} placeholders in endpoint templates.
func substituteEndpoint(tpl string, vars map[string]string) string {
	if tpl == "" {
		return ""
	}
	for k, v := range vars {
		tpl = strings.ReplaceAll(tpl, fmt.Sprintf(endpointPlaceholder, k), v)
	}
	return tpl
}

// setAuthHeader applies bearer-token auth when configured.
func setAuthHeader(req *http.Request, auth AuthConfig) {
	if req == nil || req.Header == nil {
		return
	}
	if auth.Type == AuthTypeBearer && auth.Token != "" {
		req.Header.Set(authorizationHeader, bearerPrefix+auth.Token)
	}
}

// getFieldString extracts a dot-path value from a JSON-decoded object.
func getFieldString(data map[string]any, path string) string {
	if data == nil || path == "" {
		return ""
	}
	parts := strings.Split(path, fieldPathSeparator)
	cur := data
	for i, p := range parts {
		v, ok := cur[p]
		if !ok {
			return ""
		}
		if i == len(parts)-1 {
			return formatFieldValue(v)
		}
		next, ok := v.(map[string]any)
		if !ok {
			return ""
		}
		cur = next
	}
	return ""
}

// formatFieldValue converts a decoded JSON value into its string representation.
func formatFieldValue(v any) string {
	if v == nil {
		return ""
	}
	switch s := v.(type) {
	case string:
		return s
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(s)
	default:
		return fmt.Sprintf(defaultFormatVerb, v)
	}
}

// mapValue translates a value using a mapping; returns the key if absent.
func mapValue(m map[string]string, key string) string {
	if m == nil {
		return key
	}
	if v, ok := m[key]; ok {
		return v
	}
	return key
}

// reverseMap inverts a map[external->internal] to map[internal->external].
// Keys are processed in sorted order so collisions are deterministic:
// for duplicate values, the lexicographically largest external key wins.
func reverseMap(m map[string]string) map[string]string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	r := make(map[string]string, len(m))
	for _, k := range keys {
		r[m[k]] = k
	}
	return r
}

// parseTimeString parses common timestamp formats into time.Time.
// An empty input returns a zero time and no error.
func parseTimeString(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	for _, layout := range []string{
		timestampLayoutRFC3339,
		timestampLayoutRFC3339Nano,
		timestampLayoutDateTimeT,
		timestampLayoutDateTime,
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf(errFmtUnparseableTimestamp, s)
}

// tryUnmarshalArray attempts to decode a JSON array, falling back to {data: [...]}.
func tryUnmarshalArray(body []byte) ([]map[string]any, error) {
	if len(body) == 0 {
		return nil, nil
	}
	var rows []map[string]any
	if err := json.Unmarshal(body, &rows); err == nil {
		return rows, nil
	}
	var wrapper map[string]any
	if err := json.Unmarshal(body, &wrapper); err != nil {
		return nil, err
	}
	raw, ok := wrapper[wrapperDataFieldName]
	if !ok {
		return nil, fmt.Errorf(errFmtExpectedArrayOrDataField, wrapperDataFieldName)
	}
	items, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf(errFmtDataFieldNotArray, wrapperDataFieldName)
	}
	out := make([]map[string]any, len(items))
	for i, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf(errFmtDataItemNotObject, wrapperDataFieldName, i)
		}
		out[i] = m
	}
	return out, nil
}

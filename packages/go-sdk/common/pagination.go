package common

// PaginatedList 是统一的分页列表响应结构。
type PaginatedList[T any] struct {
	List     []T `json:"list"`
	Total    int `json:"total"`
	Page     int `json:"page"`
	PageSize int `json:"pageSize"`
}

// NormalizePage 将页码规范化，小于 1 时返回 1。
func NormalizePage(page int) int {
	if page < 1 {
		return 1
	}
	return page
}

// NormalizePageSize 将每页条数规范化，小于 1 时使用默认值。
func NormalizePageSize(pageSize, defaultSize, maxSize int) int {
	if pageSize < 1 {
		return defaultSize
	}
	if maxSize > 0 && pageSize > maxSize {
		return maxSize
	}
	return pageSize
}

// Offset 计算 SQL OFFSET。
func Offset(page, pageSize int) int {
	return (NormalizePage(page) - 1) * pageSize
}

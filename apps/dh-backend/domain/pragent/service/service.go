package service

import (
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/pragent/object"
)

// ReviewService 定义 PR-Agent 模块的服务接口。
type ReviewService interface {
	ListReviews() ([]object.ReviewResult, error)
}

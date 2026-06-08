package git

import "context"

// Repository 表示 Git 仓库抽象
type Repository interface {
	Clone(ctx context.Context, url string) error
	Checkout(ctx context.Context, branch string) error
	Commit(ctx context.Context, message string) error
	Push(ctx context.Context) error
	PullRequest(ctx context.Context, title, body, head, base string) error
}

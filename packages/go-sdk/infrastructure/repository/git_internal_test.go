package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/go-git/go-git/v5/plumbing/transport"
)

func TestIsEmptyRemoteError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error", nil, false},
		{"sentinel error", transport.ErrEmptyRemoteRepository, true},
		{"wrapped sentinel", fmt.Errorf("git clone failed: %w", transport.ErrEmptyRemoteRepository), true},
		// 真实场景中远程服务器（Gitea/GitLab）经协议层返回的错误只携带文本，
		// 不会被 errors.Is 识别，必须走文本兜底匹配。
		{"server text error", errors.New("ssh: command failed: remote repository is empty"), true},
		{"unrelated error", errors.New("authentication failed"), false},
	}

	for _, tc := range cases {
		if got := isEmptyRemoteError(tc.err); got != tc.want {
			t.Errorf("isEmptyRemoteError(%s) = %v, want %v", tc.name, got, tc.want)
		}
	}
}

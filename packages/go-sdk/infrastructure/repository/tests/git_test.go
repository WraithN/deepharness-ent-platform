package tests

import (
	"path/filepath"
	"strings"
	"testing"

	repository "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/infrastructure/repository"
)

func TestDefaultLocalPath(t *testing.T) {
	c := repository.NewGitClient("")
	got := c.DefaultLocalPath("user-1", "ws-1", "backend/api")
	want := filepath.Join(repository.DEFAULT_WORKSPACE_ROOT, "user-1", "ws-1", "backend-api")
	if got != want {
		t.Errorf("DefaultLocalPath = %q, want %q", got, want)
	}
}

func TestDefaultLocalPathPreventsTraversal(t *testing.T) {
	c := repository.NewGitClient("")

	cases := []struct {
		user string
		ws   string
		name string
	}{
		{"user-1", "ws-1", "../../etc"},
		{"user-1", "../../etc", "repo"},
		{"../../etc", "ws-1", "repo"},
		{"user-1", "ws-1", ".../etc"},
	}

	for _, tc := range cases {
		got := c.DefaultLocalPath(tc.user, tc.ws, tc.name)
		if strings.Contains(got, "..") {
			t.Errorf("DefaultLocalPath(%q,%q,%q) should not contain traversal: %q", tc.user, tc.ws, tc.name, got)
		}
		if got != "" && !strings.HasPrefix(got, repository.DEFAULT_WORKSPACE_ROOT+string(filepath.Separator)) {
			t.Errorf("DefaultLocalPath(%q,%q,%q) escaped root: %q", tc.user, tc.ws, tc.name, got)
		}
	}
}

func TestCloneWithInvalidSSHKey(t *testing.T) {
	c := repository.NewGitClient("")
	tmp := t.TempDir()
	err := c.Clone("git@example.com:foo/bar.git", filepath.Join(tmp, "bar"), "not-a-key", "", nil)
	if err == nil {
		t.Fatal("expected error for invalid ssh key")
	}
	if !strings.Contains(err.Error(), "parse private key") && !strings.Contains(err.Error(), "ssh private key") {
		t.Errorf("unexpected error: %v", err)
	}
}

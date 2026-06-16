package repository

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultLocalPath(t *testing.T) {
	c := NewGitClient("")
	got := c.DefaultLocalPath("ws-1", "backend/api")
	want := filepath.Join(DEFAULT_WORKSPACE_ROOT, "ws-1", "backend-api")
	if got != want {
		t.Errorf("DefaultLocalPath = %q, want %q", got, want)
	}
}

func TestDefaultLocalPathPreventsTraversal(t *testing.T) {
	c := NewGitClient("")

	cases := []struct {
		ws   string
		name string
	}{
		{"ws-1", "../../etc"},
		{"../../etc", "repo"},
		{"ws-1", ".../etc"},
	}

	for _, tc := range cases {
		got := c.DefaultLocalPath(tc.ws, tc.name)
		if strings.Contains(got, "..") {
			t.Errorf("DefaultLocalPath(%q,%q) should not contain traversal: %q", tc.ws, tc.name, got)
		}
		if got != "" && !strings.HasPrefix(got, DEFAULT_WORKSPACE_ROOT+string(filepath.Separator)) {
			t.Errorf("DefaultLocalPath(%q,%q) escaped root: %q", tc.ws, tc.name, got)
		}
	}
}

func TestCloneWithInvalidSSHKey(t *testing.T) {
	c := NewGitClient("")
	tmp := t.TempDir()
	err := c.Clone("git@example.com:foo/bar.git", filepath.Join(tmp, "bar"), "not-a-key", "")
	if err == nil {
		t.Fatal("expected error for invalid ssh key")
	}
	if !strings.Contains(err.Error(), "parse private key") && !strings.Contains(err.Error(), "ssh private key") {
		t.Errorf("unexpected error: %v", err)
	}
}

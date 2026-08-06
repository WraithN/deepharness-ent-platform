package service

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/repository/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/gitutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/idutil"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/pathutil"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/common/workspacepath"
	"github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/repository"
	"github.com/go-enry/go-enry/v2"
)

// Scan 扫描指定用户工作空间下的本地 Git 仓库并自动导入到数据库。
// 目录结构：WORKSPACE_ROOT/{userID}/{workspaceID}/dev-jobs/{repoName}
func (s *DBRepositoryService) Scan(workspaceID, userID string) ([]object.ScannedRepository, error) {
	base, err := pathutil.ResolveWorkspaceRoot(s.workspaceRoot, userID, workspaceID)
	if err != nil {
		return nil, fmt.Errorf("resolve workspace root failed: %w", err)
	}
	devJobsDir := filepath.Join(base, workspacepath.DirDevJobs)
	sc := stubclient.FromContext(context.Background())
	if sc == nil {
		return nil, fmt.Errorf("stubclient not initialized")
	}

	existingRepos, err := s.List(workspaceID)
	if err != nil {
		return nil, err
	}
	existingPaths := make(map[string]repository.Repository)
	for _, r := range existingRepos {
		if r.LocalPath != "" {
			existingPaths[r.LocalPath] = r
		}
	}

	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()
	entries, err := sc.ListDir(ctx, devJobsDir)
	if err != nil {
		return nil, fmt.Errorf("list dev-jobs dir failed: %w", err)
	}

	result := []object.ScannedRepository{}

	for _, entry := range entries {
		if !entry.IsDir || strings.HasPrefix(entry.Name, ".") {
			continue
		}
		repoDir := filepath.Join(devJobsDir, entry.Name)
		gitDir := filepath.Join(repoDir, ".git")
		exists, err := sc.FileExists(ctx, gitDir)
		if err != nil || !exists {
			continue
		}

		repoName := entry.Name
		scanned := object.ScannedRepository{
			Name:     repoName,
			Path:     repoDir,
			IsCloned: true,
		}

		if url, err := gitutil.Exec(ctx, repoDir, "config", "--get", "remote.origin.url"); err == nil {
			scanned.URL = strings.TrimSpace(url)
		}

		if branch, err := gitutil.Exec(ctx, repoDir, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
			scanned.CurrentBranch = strings.TrimSpace(branch)
		}

		if commit, err := gitutil.Exec(ctx, repoDir, "rev-parse", "HEAD"); err == nil {
			scanned.LastCommit = strings.TrimSpace(commit)
		}

		if msg, err := gitutil.Exec(ctx, repoDir, "log", "-1", "--pretty=%B"); err == nil {
			scanned.LastCommitMessage = strings.TrimSpace(msg)
			if len(scanned.LastCommitMessage) > 200 {
				scanned.LastCommitMessage = scanned.LastCommitMessage[:197] + "..."
			}
		}

		if t, err := gitutil.Exec(ctx, repoDir, "log", "-1", "--pretty=%ci"); err == nil {
			if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
				scanned.LastCommitTime = &pt
			}
		}

		// Auto-import to DB if not exists by local_path
		if existingRepo, exists := existingPaths[repoDir]; !exists {
			now := time.Now().UTC()
			id := idutil.GenerateID()
			_, err := s.db.Exec(`
				INSERT INTO repositories (id, workspace_id, name, url, type, default_branch, local_path, clone_status, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				ON CONFLICT DO NOTHING
			`, id, workspaceID, repoName, scanned.URL, "dev", scanned.CurrentBranch, repoDir, "cloned", now, now)
			if err != nil {
				log.Printf("[Repository] failed to auto-import %s: %v", repoName, err)
			}
		} else if existingRepo.DefaultBranch != scanned.CurrentBranch {
			_, err := s.db.Exec(`
				UPDATE repositories
				SET default_branch = $1, updated_at = $2
				WHERE id = $3
			`, scanned.CurrentBranch, time.Now().UTC(), existingRepo.ID)
			if err != nil {
				log.Printf("[Repository] failed to update %s: %v", repoName, err)
			}
		}

		result = append(result, scanned)
	}

	return result, nil
}

// GetDetails 获取仓库详细信息。
func (s *DBRepositoryService) GetDetails(workspaceID, repoID, userID string) (*object.RepositoryDetails, error) {
	repo, err := s.Get(workspaceID, repoID)
	if err != nil {
		return nil, err
	}

	details := &object.RepositoryDetails{
		Repository: repo,
	}

	if repo.LocalPath == "" {
		return details, nil
	}

	sc := stubclient.FromContext(context.Background())
	if sc == nil {
		return details, nil
	}
	// RepositoryService 接口未定义 ctx 参数，使用 context.Background() 作为根 context。
	ctx := context.Background()

	if exists, err := sc.FileExists(ctx, repo.LocalPath); err != nil || !exists {
		return details, nil
	}

	if total, err := gitExecInt(ctx, repo.LocalPath, "rev-list", "--count", "HEAD"); err == nil {
		details.CommitStats.TotalCommits = total
	}

	if lastWeek, err := gitExecInt(ctx, repo.LocalPath, "rev-list", "--count", "--since=1.week", "HEAD"); err == nil {
		details.CommitStats.LastWeek = lastWeek
	}

	if lastMonth, err := gitExecInt(ctx, repo.LocalPath, "rev-list", "--count", "--since=1.month", "HEAD"); err == nil {
		details.CommitStats.LastMonth = lastMonth
	}

	if t, err := gitutil.Exec(ctx, repo.LocalPath, "log", "-1", "--pretty=%ci"); err == nil {
		if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
			details.CommitStats.LastCommit = &pt
		}
	}

	if t, err := gitutil.Exec(ctx, repo.LocalPath, "log", "--reverse", "-1", "--pretty=%ci"); err == nil {
		if pt, err := time.Parse("2006-01-02 15:04:05 -0700", strings.TrimSpace(t)); err == nil {
			details.CommitStats.FirstCommit = &pt
		}
	}

	if branches, err := gitutil.Exec(ctx, repo.LocalPath, "branch", "-v", "--format=%(refname:short);%(objectname);%(committerdate:iso8601)"); err == nil {
		currentBranch, _ := gitutil.Exec(ctx, repo.LocalPath, "rev-parse", "--abbrev-ref", "HEAD")
		currentBranch = strings.TrimSpace(currentBranch)

		for _, line := range strings.Split(branches, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.Split(line, ";")
			if len(parts) >= 2 {
				bi := object.BranchInfo{
					Name:       parts[0],
					IsCurrent:  parts[0] == currentBranch,
					LastCommit: parts[1],
				}
				if len(parts) >= 3 && parts[2] != "" {
					if t, err := time.Parse("2006-01-02 15:04:05 -0700", parts[2]); err == nil {
						bi.LastCommitTime = &t
					}
				}
				details.Branches = append(details.Branches, bi)
			}
		}
	}

	if contributors, err := gitutil.Exec(ctx, repo.LocalPath, "shortlog", "-sn", "HEAD"); err == nil {
		for _, line := range strings.Split(contributors, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			if parts := strings.SplitN(line, "\t", 2); len(parts) == 2 {
				details.Contributors = append(details.Contributors, strings.TrimSpace(parts[1]))
			}
		}
	}

	if out, err := gitutil.Exec(ctx, repo.LocalPath, "ls-files", "-z"); err == nil {
		details.FileCount = strings.Count(out, "\000")
	}

	// Calculate total file size from git ls-files
	if fileList, err := gitutil.Exec(ctx, repo.LocalPath, "ls-files"); err == nil {
		var totalSize int64 = 0
		for _, file := range strings.Split(fileList, "\n") {
			file = strings.TrimSpace(file)
			if file == "" {
				continue
			}
			fullPath := filepath.Join(repo.LocalPath, file)
			if fi, err := sc.FileInfo(ctx, fullPath); err == nil {
				totalSize += fi.Size
			}
		}
		details.SizeBytes = totalSize
	}

	// 使用 go-enry 统计语言分布，并计算有效代码行数（均基于 git ls-files，天然尊重 .gitignore）。
	languageStats, effectiveLines := analyzeRepoLanguagesAndLines(ctx, repo.LocalPath)
	details.LanguageStats = languageStats
	details.EffectiveLinesOfCode = effectiveLines
	if len(languageStats) > 0 {
		details.Language = languageStats[0].Name
	}

	details.CommitterStats = loadCommitterStats(ctx, repo.LocalPath)
	details.WeeklyCommits = loadWeeklyCommits(ctx, repo.LocalPath)

	return details, nil
}

func gitExecInt(ctx context.Context, dir string, args ...string) (int, error) {
	out, err := gitutil.Exec(ctx, dir, args...)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(out))
}

func strconvParseInt(s string, base int, bitSize int) (int64, error) {
	return strconv.ParseInt(s, base, bitSize)
}

func walkDir(ctx context.Context, sc *stubclient.Client, dir string, fn func(path string, entry stubclient.DirEntry) error) error {
	entries, err := sc.ListDir(ctx, dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name, ".") {
			continue
		}
		path := filepath.Join(dir, entry.Name)
		if err := fn(path, entry); err != nil {
			if err == filepath.SkipDir {
				continue
			}
			return err
		}
		if entry.IsDir {
			if err := walkDir(ctx, sc, path, fn); err != nil {
				return err
			}
		}
	}
	return nil
}

func detectLanguage(ctx context.Context, repoDir string) string {
	extCounts := make(map[string]int)
	sc := stubclient.FromContext(ctx)
	if sc == nil {
		return ""
	}
	_ = walkDir(ctx, sc, repoDir, func(path string, entry stubclient.DirEntry) error {
		if entry.IsDir || strings.Contains(path, ".git") {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != "" {
			extCounts[ext]++
		}
		return nil
	})

	langMap := map[string]string{
		".go":    "Go",
		".js":    "JavaScript",
		".ts":    "TypeScript",
		".jsx":   "React",
		".tsx":   "React",
		".py":    "Python",
		".java":  "Java",
		".rb":    "Ruby",
		".php":   "PHP",
		".rs":    "Rust",
		".cpp":   "C++",
		".c":     "C",
		".h":     "C/C++ Header",
		".cs":    "C#",
		".swift": "Swift",
		".kt":    "Kotlin",
		".scala": "Scala",
		".vue":   "Vue",
		".html":  "HTML",
		".css":   "CSS",
		".scss":  "SCSS",
		".sql":   "SQL",
		".sh":    "Shell",
		".md":    "Markdown",
	}

	maxCount := 0
	maxExt := ""
	for ext, count := range extCounts {
		if count > maxCount {
			maxCount = count
			maxExt = ext
		}
	}

	if lang, ok := langMap[maxExt]; ok {
		return lang
	}
	return "Other"
}

// languageColorMap 为常见语言提供近似 GitHub 配色，便于前端展示。
var languageColorMap = map[string]string{
	"Go":         "#00ADD8",
	"TypeScript": "#3178C6",
	"JavaScript": "#F1E05A",
	"Python":     "#3572A5",
	"Java":       "#B07219",
	"Rust":       "#DEA584",
	"C++":        "#F34B7D",
	"C":          "#555555",
	"C#":         "#178600",
	"Vue":        "#41B883",
	"HTML":       "#E34C26",
	"CSS":        "#563D7C",
	"Shell":      "#89E051",
	"Markdown":   "#083FA1",
	"JSON":       "#292929",
	"YAML":       "#CB171E",
	"SQL":        "#E38C00",
	"Ruby":       "#701516",
	"PHP":        "#4F5D95",
	"Swift":      "#F05138",
	"Kotlin":     "#A97BFF",
	"Scala":      "#C22D40",
}

// ignoredLanguages 是不希望出现在语言统计中的语言黑名单。
// 例如 go-enry 常把 Markdown 文件误判为 GCC Machine Description，需过滤掉。
var ignoredLanguages = map[string]bool{
	"GCC Machine Description": true,
}

// analyzeRepoLanguagesAndLines 遍历 git 跟踪的文件，统计语言分布与有效代码行数。
// 使用 git ls-files 获取文件列表，天然尊重 .gitignore。
func analyzeRepoLanguagesAndLines(ctx context.Context, repoDir string) ([]object.LanguageStat, int) {
	out, err := gitutil.Exec(ctx, repoDir, "ls-files")
	if err != nil {
		return nil, 0
	}
	files := strings.Split(out, "\n")

	langAgg := make(map[string]*object.LanguageStat)
	totalLines := 0
	// 单个文件大小上限 1MB，避免读取超大文件拖慢统计。
	const maxFileSize = 1024 * 1024

	sc := stubclient.FromContext(ctx)
	for _, f := range files {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		fullPath := filepath.Join(repoDir, f)
		fi, err := sc.FileInfo(ctx, fullPath)
		if err != nil || fi.IsDir {
			continue
		}
		if fi.Size > maxFileSize {
			continue
		}
		data, err := sc.ReadFile(ctx, fullPath)
		if err != nil {
			continue
		}
		if strings.Contains(data, "\x00") {
			continue
		}
		lang := detectFileLanguage(f, []byte(data))
		if lang == "" || lang == "Unknown" || ignoredLanguages[lang] {
			continue
		}

		lines := countEffectiveLines([]byte(data))
		totalLines += lines

		if stat, ok := langAgg[lang]; ok {
			stat.Files++
			stat.Bytes += fi.Size
		} else {
			langAgg[lang] = &object.LanguageStat{
				Name:  lang,
				Files: 1,
				Bytes: fi.Size,
			}
		}
	}

	if len(langAgg) == 0 {
		return nil, 0
	}

	var totalBytes int64
	result := make([]object.LanguageStat, 0, len(langAgg))
	for _, stat := range langAgg {
		totalBytes += stat.Bytes
		if c, ok := languageColorMap[stat.Name]; ok {
			stat.Color = c
		}
		result = append(result, *stat)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Bytes > result[j].Bytes
	})
	for i := range result {
		if totalBytes > 0 {
			result[i].Percentage = float64(result[i].Bytes) / float64(totalBytes) * 100
		}
	}
	return result, totalLines
}

// detectFileLanguage 使用 go-enry 识别文件语言，失败时返回空。
func detectFileLanguage(path string, data []byte) string {
	if lang, _ := enry.GetLanguageByExtension(path); lang != "" {
		return lang
	}
	if lang, _ := enry.GetLanguageByContent(path, data); lang != "" {
		return lang
	}
	if lang, _ := enry.GetLanguageByFilename(path); lang != "" {
		return lang
	}
	return ""
}

// countEffectiveLines 统计有效代码行数：非空且不是简单注释行。
func countEffectiveLines(data []byte) int {
	count := 0
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		// 简单过滤常见单行/多行注释标记，跨多行注释不精确剔除。
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") ||
			strings.HasPrefix(trimmed, "/*") || strings.HasPrefix(trimmed, "*") ||
			strings.HasPrefix(trimmed, "<!--") || strings.HasPrefix(trimmed, "--") {
			continue
		}
		count++
	}
	return count
}

// loadCommitterStats 解析 git shortlog 输出，返回贡献者提交分布。
func loadCommitterStats(ctx context.Context, repoDir string) []object.CommitterStat {
	out, err := gitutil.Exec(ctx, repoDir, "shortlog", "-sn", "--email", "HEAD")
	if err != nil {
		return nil
	}
	var stats []object.CommitterStat
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.SplitN(line, "\t", 2)
		if len(parts) != 2 {
			continue
		}
		commits, err := strconv.Atoi(strings.TrimSpace(parts[0]))
		if err != nil {
			continue
		}
		name, email := parseCommitterNameEmail(parts[1])
		stats = append(stats, object.CommitterStat{Name: name, Email: email, Commits: commits})
	}
	return stats
}

// parseCommitterNameEmail 从 "Name <email>" 格式中解析姓名与邮箱。
func parseCommitterNameEmail(s string) (string, string) {
	s = strings.TrimSpace(s)
	if idx := strings.LastIndex(s, "<"); idx != -1 {
		name := strings.TrimSpace(s[:idx])
		email := strings.Trim(s[idx:], "<>")
		return name, email
	}
	return s, ""
}

// loadWeeklyCommits 统计最近 7 天每日提交数量。
func loadWeeklyCommits(ctx context.Context, repoDir string) []object.DailyCommit {
	out, err := gitutil.Exec(ctx, repoDir, "log", "--since=7.days", "--pretty=%ad", "--date=short", "HEAD")
	if err != nil {
		return nil
	}
	counts := make(map[string]int)
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		counts[line]++
	}
	today := time.Now().UTC().Truncate(24 * time.Hour)
	result := make([]object.DailyCommit, 7)
	for i := 6; i >= 0; i-- {
		d := today.AddDate(0, 0, i-6)
		dateStr := d.Format("2006-01-02")
		result[6-i] = object.DailyCommit{Date: dateStr, Count: counts[dateStr]}
	}
	return result
}

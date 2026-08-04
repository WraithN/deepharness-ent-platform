package service

import (
	"context"
	"log"
	"path/filepath"
	"time"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/domain/productspace/object"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/gateway/stubclient"
	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/pkg/safego"
)

// StartDocAdoptionCleanupTask 启动文档采纳源文件清理定时任务。
// 任务按 interval 周期扫描 product_docs.source_path，删除超过 retentionDays 未修改的源草稿文件。
// 返回的 stop 函数用于停止定时器；本方法不依赖 ProductSpace 其它接口状态。
func (s *DBProductSpaceService) StartDocAdoptionCleanupTask(ctx context.Context, interval time.Duration, retentionDays int) func() {
	if interval <= 0 || retentionDays <= 0 {
		log.Printf("[ProductSpace] doc adoption cleanup disabled (interval=%v, retentionDays=%d)", interval, retentionDays)
		return func() {}
	}

	ticker := time.NewTicker(interval)
	stop := make(chan struct{})
	safego.Go("productspace-doc-cleanup", func() {
		// 启动后立即执行一次清理，缩短配置生效的等待时间。
		s.runDocAdoptionCleanup(ctx, retentionDays)
		for {
			select {
			case <-ticker.C:
				s.runDocAdoptionCleanup(ctx, retentionDays)
			case <-stop:
				ticker.Stop()
				return
			case <-ctx.Done():
				ticker.Stop()
				return
			}
		}
	})

	log.Printf("[ProductSpace] doc adoption cleanup started: interval=%v, retentionDays=%d", interval, retentionDays)
	return func() { close(stop) }
}

// runDocAdoptionCleanup 执行一次源文件清理。
// 查询所有已记录 source_path 的文档条目，对超过 retentionDays 未修改的源文件调用 personal-stub 删除。
// 源文件删除失败不会影响产品空间中的正式文档内容。
func (s *DBProductSpaceService) runDocAdoptionCleanup(ctx context.Context, retentionDays int) {
	cutoff := time.Now().AddDate(0, 0, -retentionDays)

	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT source_path
		FROM product_docs
		WHERE type = $1 AND source_path IS NOT NULL AND source_path != ''
	`, object.ItemTypeDoc)
	if err != nil {
		log.Printf("[ProductSpace] cleanup query failed: %v", err)
		return
	}
	defer rows.Close()

	sc := stubclient.FromContext(ctx)
	if sc == nil {
		log.Printf("[ProductSpace] cleanup skipped: personal-stub client not initialized")
		return
	}

	for rows.Next() {
		var sourcePath string
		if err := rows.Scan(&sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup scan source_path failed: %v", err)
			continue
		}

		if err := validateRelativePath(sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup skip invalid source_path %q: %v", sourcePath, err)
			continue
		}

		absPath := filepath.Join(s.workspaceRoot, sourcePath)
		if !isPathUnderWorkspaceRoot(absPath, s.workspaceRoot) {
			log.Printf("[ProductSpace] cleanup skip path outside workspace root: %s", sourcePath)
			continue
		}

		fi, err := stubFileInfo(ctx, absPath)
		if err != nil {
			log.Printf("[ProductSpace] cleanup stat %s failed: %v", absPath, err)
			continue
		}
		if !fi.Exists {
			continue
		}
		if fi.IsDir {
			continue
		}
		modTime, _ := time.Parse(time.RFC3339, fi.ModTime)
		if modTime.After(cutoff) {
			continue
		}

		if err := sc.DeleteFile(ctx, sourcePath); err != nil {
			log.Printf("[ProductSpace] cleanup delete %s failed: %v", sourcePath, err)
		} else {
			log.Printf("[ProductSpace] cleanup deleted adopted source file %s (modified %s)", sourcePath, fi.ModTime)
		}
	}

	if err := rows.Err(); err != nil {
		log.Printf("[ProductSpace] cleanup rows iteration failed: %v", err)
	}
}

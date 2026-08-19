import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_DIR = path.join(os.tmpdir(), "crawler-files-test");
const TTL_MS = 1000;

// config.ts 的 loadConfig() 在模块加载时执行，会固化当时的 process.env.TEMP_DIR。
// ESM 静态 import 会被提升到文件顶部，无法保证先执行本行的环境变量赋值，
// 故在设置 TEMP_DIR 后用动态 import 加载 temp-files，使其读到的 tempDir 指向 TEST_DIR。
process.env.TEMP_DIR = TEST_DIR;

const { saveTempFile, getTempFilePath, cleanupExpiredTempFiles } = await import("./temp-files.js");

describe("temp-files", () => {
  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("saveTempFile 写文件并返回 id，getTempFilePath 可读回", async () => {
    const id = await saveTempFile(Buffer.from("hello"), ".txt");
    expect(id).toBeTruthy();
    const p = getTempFilePath(id);
    expect(p).not.toBeNull();
    expect(fs.readFileSync(p!, "utf8")).toBe("hello");
  });

  it("saveTempFile 对含路径穿越的 ext 抛错", async () => {
    await expect(saveTempFile(Buffer.from("x"), "../evil")).rejects.toThrow();
    await expect(saveTempFile(Buffer.from("x"), "a/b")).rejects.toThrow();
  });

  it("getTempFilePath 对非法 id 返回 null（防路径穿越）", () => {
    expect(getTempFilePath("../etc/passwd")).toBeNull();
    expect(getTempFilePath("a/b")).toBeNull();
    expect(getTempFilePath("..")).toBeNull();
  });

  it("cleanupExpiredTempFiles 删除过期文件，保留新文件", async () => {
    const id = await saveTempFile(Buffer.from("x"), ".bin");
    // 等待超过 TTL 后触发清理，确保 mtime 早于清理阈值。
    await new Promise((r) => setTimeout(r, TTL_MS + 100));
    await cleanupExpiredTempFiles(TTL_MS);
    expect(getTempFilePath(id)).toBeNull();
  });
});

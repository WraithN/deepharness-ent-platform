import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

// 临时文件目录（截图/附件下载后暂存，供 agent curl 下载）。
// 惰性读取 config.tempDir 而非模块顶层缓存：config 在 import 时已由 loadConfig()
// 按当时的 process.env.TEMP_DIR 固化，惰性读取可避免与测试等场景的加载顺序耦合。
function tempDir(): string {
  return config.tempDir;
}

// id 只允许 UUID 形态（含扩展名），拒绝含路径分隔符/.. 的输入，防路径穿越。
// randomUUID() 生成 36 位小写十六进制+连字符（32 hex + 4 个 -）。
const SAFE_ID_REGEX = /^[0-9a-f-]{36}(\.[a-z0-9]+)?$/i;

/** 保存 buffer 到临时目录，返回带扩展名的 id（UUID.ext）。 */
export async function saveTempFile(buffer: Buffer, ext: string): Promise<string> {
  await fsp.mkdir(tempDir(), { recursive: true });
  const id = `${randomUUID()}${ext}`;
  await fsp.writeFile(path.join(tempDir(), id), buffer);
  return id;
}

/** 返回临时文件的绝对路径；id 非法或文件不存在返回 null。 */
export function getTempFilePath(id: string): string | null {
  if (!SAFE_ID_REGEX.test(id)) return null;
  const p = path.join(tempDir(), id);
  if (!fs.existsSync(p)) return null;
  return p;
}

/** 删除最后修改时间早于 ttlMs 的临时文件（LRU 清理）。 */
export async function cleanupExpiredTempFiles(ttlMs: number): Promise<void> {
  const now = Date.now();
  let entries: string[];
  try {
    entries = await fsp.readdir(tempDir());
  } catch {
    return;
  }
  for (const name of entries) {
    const p = path.join(tempDir(), name);
    try {
      const stat = await fsp.stat(p);
      if (now - stat.mtimeMs > ttlMs) await fsp.unlink(p);
    } catch {
      // 文件可能已被并发清理，忽略。
    }
  }
}

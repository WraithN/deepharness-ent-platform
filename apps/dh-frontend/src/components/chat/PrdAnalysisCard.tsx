import { useEffect, useMemo, useState } from "react";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileApi } from "@/lib/file-api";

interface SourceItem { type: string; url?: string; path?: string; markdown?: string; }
interface Row { website: string; company: string; finding: string; sources: SourceItem[]; }
interface PrdAnalysisData { topic?: string; rows: Row[]; }

// 主题缺失时的表头兜底。
const FINDING_HEADER_FALLBACK = "提示词提及的信息";
const EXCEL_SHEET_NAME = "竞品信息分析";
const EXCEL_FILENAME_PREFIX = "竞品信息分析";
const HEADER_FILL_ARGB = "FFE2E8F0";
const SOURCE_LABEL_PAGE = "页面";
const SOURCE_LABEL_SCREENSHOT = "截图";
const SOURCE_LABEL_FILE = "附件";
const SOURCE_SEPARATOR = "；";
// 文件名中不允许的字符（Windows/Excel 限制），用于 topic 清洗。
const FILENAME_FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

// 来源项转为单行文本：页面/截图/附件分别加前缀标注，多值用「；」拼接。
function sourcesToText(sources: SourceItem[]): string {
  return (sources ?? []).map((s) => {
    if (s.type === "page") return `${SOURCE_LABEL_PAGE}:${s.url ?? ""}`;
    if (s.type === "screenshot") return `${SOURCE_LABEL_SCREENSHOT}:${s.path ?? s.url ?? ""}`;
    if (s.type === "file") return `${SOURCE_LABEL_FILE}:${s.path ?? s.url ?? ""}`;
    return s.url ?? "";
  }).join(SOURCE_SEPARATOR);
}

// 收集需要打包进 xlsx 的本地文件（附件 + 截图），page 仅为外链不打包。
// zipPath 用 source 原始相对路径，保留目录结构、避免重名。
interface BundleFile { zipPath: string; absPath: string; }
function collectBundleFiles(rows: Row[], taskDir: string): BundleFile[] {
  const files: BundleFile[] = [];
  for (const r of rows) {
    for (const s of r.sources ?? []) {
      const isLocal = s.type === "file" || s.type === "screenshot";
      if (isLocal && s.path) {
        files.push({ zipPath: s.path, absPath: `${taskDir}/${s.path}` });
      }
    }
  }
  return files;
}

// 单个附件下载（带鉴权），失败返回 null（不中断整体打包）。
async function fetchAttachmentBytes(absPath: string): Promise<ArrayBuffer | null> {
  try {
    const bytes = await fileApi.downloadBytes(absPath);
    // 诊断日志：定位附件打包失败时用。完成后可移除。
    console.log("[PrdAnalysis] bundled attachment ok:", absPath, "size=", bytes.byteLength);
    return bytes;
  } catch (e) {
    console.warn("[PrdAnalysis] bundled attachment fail:", absPath, (e as Error)?.message ?? e);
    return null;
  }
}

// topic 清洗为合法文件名片段；空则返回空串。
function sanitizeTopicForFilename(topic: string | undefined): string {
  const t = (topic ?? "").trim().replace(FILENAME_FORBIDDEN_CHARS, "");
  return t.length > 60 ? t.slice(0, 60) : t;
}

// 用 exceljs 构建带样式的 .xlsx，再用 jszip 把本地附件文件打包进同一压缩包。
async function buildExcel(rows: Row[], findingHeader: string, taskDir: string): Promise<ArrayBuffer> {
  const columns = [
    { header: "网站", key: "website", width: 32 },
    { header: "公司", key: "company", width: 18 },
    { header: findingHeader, key: "finding", width: 60 },
    { header: "信息来源", key: "sources", width: 40 },
  ];
  const FINDING_COL_IDX = 3;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(EXCEL_SHEET_NAME);
  sheet.columns = columns;

  for (const r of rows) {
    sheet.addRow({
      website: r.website,
      company: r.company,
      finding: r.finding,
      sources: sourcesToText(r.sources),
    });
  }

  // 表头行：加粗、居中、填充底色。
  const headerRow = sheet.getRow(1);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
  });

  // 数据行：长文本列自动换行、全部顶端对齐，提升可读性。
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    row.eachCell((cell, colNumber) => {
      cell.alignment = { vertical: "top", wrapText: colNumber === FINDING_COL_IDX };
    });
  }

  // 冻结首行，便于长表滚动查看。
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const xlsxBuffer = await workbook.xlsx.writeBuffer();

  // 将本地附件文件（附件/截图）打包进 xlsx 压缩包；用户改后缀 .zip 解压即可取出原文件。
  const bundleFiles = collectBundleFiles(rows, taskDir);
  console.log("[PrdAnalysis] buildExcel: rows=", rows.length, "bundleFiles=", bundleFiles.length, "taskDir=", taskDir);
  if (bundleFiles.length === 0) {
    console.log("[PrdAnalysis] no local files to bundle, xlsx only");
    return xlsxBuffer as ArrayBuffer;
  }

  const zip = await JSZip.loadAsync(xlsxBuffer);
  console.log("[PrdAnalysis] jszip loaded xlsx, adding files...");
  let added = 0;
  await Promise.all(bundleFiles.map(async (f) => {
    const bytes = await fetchAttachmentBytes(f.absPath);
    // 单个附件下载失败时跳过，不影响其余文件与主表。
    if (bytes) { zip.file(f.zipPath, bytes); added++; }
  }));
  console.log("[PrdAnalysis] bundled files added:", added, "/", bundleFiles.length);
  const out = await zip.generateAsync({ type: "arraybuffer" });
  console.log("[PrdAnalysis] final xlsx size=", out.byteLength);
  return out;
}

export function PrdAnalysisCard({ jsonPath }: { jsonPath: string }) {
  const [data, setData] = useState<PrdAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string>("");

  // 任务目录 = analysis.json 所在目录；附件相对路径以此为基准拼绝对路径。
  const taskDir = useMemo(() => jsonPath.substring(0, jsonPath.lastIndexOf("/")), [jsonPath]);
  const findingHeader = data?.topic?.trim() || FINDING_HEADER_FALLBACK;

  useEffect(() => {
    let cancelled = false;
    fileApi.content(jsonPath)
      .then((f) => {
        if (cancelled) return;
        const parsed = JSON.parse(f.content) as PrdAnalysisData;
        setData(parsed);
        // 诊断日志：确认卡片已渲染并读到数据。完成后可移除。
        console.log("[PrdAnalysis] card mounted & data loaded", {
          topic: parsed.topic,
          rows: parsed.rows?.length,
          bundleFiles: collectBundleFiles(parsed.rows ?? [], taskDir).length,
          taskDir,
        });
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jsonPath, taskDir]);

  const downloadExcel = async () => {
    if (!data) return;
    setDownloading(true);
    try {
      const buffer = await buildExcel(data.rows, findingHeader, taskDir);
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const topicPart = sanitizeTopicForFilename(data.topic);
      a.download = topicPart ? `${EXCEL_FILENAME_PREFIX}-${topicPart}.xlsx` : `${EXCEL_FILENAME_PREFIX}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[PrdAnalysis] downloadExcel failed:", e);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-3"><Loader2 className="h-4 w-4 animate-spin" />加载表格中...</div>;
  if (error) return <div className="text-sm text-destructive p-3">表格加载失败：{error}</div>;
  if (!data || data.rows.length === 0) return null;

  return (
    <div className="border rounded-md overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <span className="text-sm font-medium">竞品信息分析</span>
        <Button size="sm" variant="outline" className="h-7" onClick={downloadExcel} disabled={downloading}>
          <Download className="h-3.5 w-3.5 mr-1" />{downloading ? "生成中..." : "下载 Excel"}
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-left">
              <th className="px-3 py-2 font-medium">网站</th>
              <th className="px-3 py-2 font-medium">公司</th>
              <th className="px-3 py-2 font-medium">{findingHeader}</th>
              <th className="px-3 py-2 font-medium">信息来源</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r, i) => (
              <tr key={i} className="border-b align-top">
                <td className="px-3 py-2"><a href={r.website} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{r.website}</a></td>
                <td className="px-3 py-2">{r.company}</td>
                <td className="px-3 py-2 whitespace-pre-wrap">{r.finding}</td>
                <td className="px-3 py-2">
                  {r.sources.map((s, j) => (
                    <div key={j} className="text-xs text-muted-foreground">
                      {s.type === "page" && s.url && <a href={s.url} target="_blank" rel="noreferrer" className="hover:underline break-all">{s.url}</a>}
                      {s.type === "screenshot" && <span>截图：{s.path ?? s.url}</span>}
                      {s.type === "file" && <span>附件：{s.path ?? s.url}</span>}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

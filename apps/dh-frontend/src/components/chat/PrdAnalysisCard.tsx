import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fileApi } from "@/lib/file-api";

interface SourceItem { type: string; url?: string; path?: string; markdown?: string; }
interface Row { website: string; company: string; finding: string; sources: SourceItem[]; }
interface PrdAnalysisData { rows: Row[]; }

// CSV 字段与表格列对应；来源列多值用 "；" 拼接。
const CSV_HEADERS = ["网站", "公司", "提示词提及的信息", "信息来源"];

function escapeCsvCell(v: string): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sourcesToText(sources: SourceItem[]): string {
  return (sources ?? []).map((s) => {
    if (s.type === "page") return `页面:${s.url ?? ""}`;
    if (s.type === "screenshot") return `截图:${s.path ?? s.url ?? ""}`;
    if (s.type === "file") return `附件:${s.path ?? s.url ?? ""}`;
    return s.url ?? "";
  }).join("；");
}

function buildCsv(rows: Row[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([r.website, r.company, r.finding, sourcesToText(r.sources)].map(escapeCsvCell).join(","));
  }
  return lines.join("\n");
}

export function PrdAnalysisCard({ jsonPath }: { jsonPath: string }) {
  const [data, setData] = useState<PrdAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fileApi.content(jsonPath)
      .then((f) => {
        if (cancelled) return;
        const parsed = JSON.parse(f.content) as PrdAnalysisData;
        setData(parsed);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [jsonPath]);

  const downloadCsv = () => {
    if (!data) return;
    const blob = new Blob(["\uFEFF" + buildCsv(data.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "prd-analysis.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground p-3"><Loader2 className="h-4 w-4 animate-spin" />加载表格中...</div>;
  if (error) return <div className="text-sm text-destructive p-3">表格加载失败：{error}</div>;
  if (!data || data.rows.length === 0) return null;

  return (
    <div className="border rounded-md overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/40">
        <span className="text-sm font-medium">竞品信息分析</span>
        <Button size="sm" variant="outline" className="h-7" onClick={downloadCsv}>
          <Download className="h-3.5 w-3.5 mr-1" />下载 CSV
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/20 text-left">
              <th className="px-3 py-2 font-medium">网站</th>
              <th className="px-3 py-2 font-medium">公司</th>
              <th className="px-3 py-2 font-medium">提示词提及的信息</th>
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

import { describe, it, expect } from "vitest";
import { extractImageUrls, extractAttachmentUrls, isPrivateHost } from "./url-extract.js";

describe("extractImageUrls", () => {
  it("绝对化相对 URL，去重保序，过滤 data: URI", () => {
    const srcs = ["img/a.png", "https://x.test/b.jpg", "img/a.png", "data:image/png;base64,xxx"];
    expect(extractImageUrls(srcs, "https://x.test/page")).toEqual([
      "https://x.test/img/a.png",
      "https://x.test/b.jpg",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractImageUrls([], "https://x.test/")).toEqual([]);
  });

  it("非法 URL 跳过不抛错", () => {
    expect(extractImageUrls(["http://[invalid", "img/a.png"], "https://x.test/")).toEqual([
      "https://x.test/img/a.png",
    ]);
  });
});

describe("extractAttachmentUrls", () => {
  it("匹配 .pdf/.docx/.doc 后缀（大小写不敏感），绝对化去重", () => {
    const hrefs = [
      "https://x.test/a.pdf",
      "/files/b.DOCX",
      "https://y.test/c.doc",
      "https://x.test/d.txt",
      "/files/b.docx",
    ];
    expect(extractAttachmentUrls(hrefs, "https://x.test/page")).toEqual([
      "https://x.test/a.pdf",
      "https://x.test/files/b.DOCX",
      "https://y.test/c.doc",
    ]);
  });

  it("空数组返回空", () => {
    expect(extractAttachmentUrls([], "https://x.test/")).toEqual([]);
  });
});

describe("isPrivateHost", () => {
  it("回环地址判定为私网", () => {
    expect(isPrivateHost("http://localhost:3000/x.png")).toBe(true);
    expect(isPrivateHost("http://127.0.0.1/a.pdf")).toBe(true);
    expect(isPrivateHost("http://127.8.8.8/x")).toBe(true);
    expect(isPrivateHost("http://[::1]/x")).toBe(true);
  });

  it("链路本地地址判定为私网", () => {
    expect(isPrivateHost("http://169.254.169.254/latest/meta-data")).toBe(true);
    expect(isPrivateHost("http://[fe80::1]/x")).toBe(true);
  });

  it("私网段判定为私网", () => {
    expect(isPrivateHost("http://10.0.0.1/x")).toBe(true);
    expect(isPrivateHost("http://172.16.0.1/x")).toBe(true);
    expect(isPrivateHost("http://172.31.255.255/x")).toBe(true);
    expect(isPrivateHost("http://192.168.1.1/x")).toBe(true);
  });

  it("0.0.0.0 判定为私网", () => {
    expect(isPrivateHost("http://0.0.0.0/x")).toBe(true);
  });

  it("公网域名与公网 IP 放行", () => {
    expect(isPrivateHost("https://example.com/a.png")).toBe(false);
    expect(isPrivateHost("http://8.8.8.8/x")).toBe(false);
    expect(isPrivateHost("http://172.15.0.1/x")).toBe(false);
    expect(isPrivateHost("http://172.32.0.1/x")).toBe(false);
  });

  it("无法解析的 URL 保守拒绝", () => {
    expect(isPrivateHost("http://[invalid")).toBe(true);
  });

  it("IPv4 映射 IPv6 判定为私网", () => {
    expect(isPrivateHost("http://[::ffff:127.0.0.1]/")).toBe(true);
    expect(isPrivateHost("http://[::ffff:10.0.0.1]/")).toBe(true);
  });

  it("IPv6 ULA（fc00::/7）判定为私网", () => {
    expect(isPrivateHost("http://[fd00::1]/")).toBe(true);
    expect(isPrivateHost("http://[fc00::1]/")).toBe(true);
  });

  it("CGNAT（100.64.0.0/10）判定为私网", () => {
    expect(isPrivateHost("http://100.64.0.1/")).toBe(true);
    expect(isPrivateHost("http://100.127.255.255/")).toBe(true);
    expect(isPrivateHost("http://100.63.0.1/")).toBe(false);
  });

  it("公网域名仍放行（回归）", () => {
    expect(isPrivateHost("https://example.com/")).toBe(false);
  });
});

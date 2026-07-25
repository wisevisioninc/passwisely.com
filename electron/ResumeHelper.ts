import { lookup } from "node:dns/promises";
import fs from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { loadBuffer } from "cheerio";
import { net } from "electron";
import mammoth from "mammoth";

import { ResumeDocument, ResumeSourceType } from "./resumeTypes";

interface ExtractedWordDocument {
  getBody(): string;
  getHeaders(options?: { includeFooters?: boolean }): string;
  getFooters(): string;
  getTextboxes(options?: {
    includeHeadersAndFooters?: boolean;
    includeBody?: boolean;
  }): string;
}

interface WordExtractorInstance {
  extract(input: string | Buffer): Promise<ExtractedWordDocument>;
}

const WordExtractor = require("word-extractor") as new () => WordExtractorInstance;

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_WEB_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACTED_CHARACTERS = 50_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/[\t ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function limitText(value: string): string {
  const normalized = normalizeText(value);
  if (normalized.length <= MAX_EXTRACTED_CHARACTERS) return normalized;
  return `${normalized.slice(0, MAX_EXTRACTED_CHARACTERS)}\n\n[内容过长，已截断]`;
}

function extractHtmlText(buffer: Buffer): { text: string; title: string } {
  const $ = loadBuffer(buffer);
  $("script, style, noscript, svg, canvas, iframe, template").remove();
  $("br").replaceWith("\n");
  $(
    "p, div, section, article, header, footer, li, tr, h1, h2, h3, h4, h5, h6, dt, dd",
  ).each((_index, element) => {
    $(element).prepend("\n").append("\n");
  });
  const title = normalizeText($("title").first().text());
  const bodyText = $("main").text() || $("article").text() || $("body").text();
  return { text: limitText(bodyText), title };
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpv4(normalized.slice("::ffff:".length));
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

async function validatePublicUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的网页简历 URL。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("网页简历仅支持 HTTP 或 HTTPS 地址。");
  }
  if (url.username || url.password) {
    throw new Error("网页地址不能包含用户名或密码。");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("不允许读取本机或内网网页地址。");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("不允许读取本机或内网网页地址。");
  }
  return url;
}

async function readLimitedResponse(response: Response): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEB_BYTES) {
    throw new Error("网页内容超过 5 MB，无法作为简历读取。");
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEB_BYTES) {
      await reader.cancel();
      throw new Error("网页内容超过 5 MB，无法作为简历读取。");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function fetchPublicHtml(inputUrl: string): Promise<{
  buffer: Buffer;
  finalUrl: URL;
}> {
  let currentUrl = await validatePublicUrl(inputUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await net.fetch(currentUrl.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
          "User-Agent": "PassWisely/1.1 Resume Importer",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error("网页重定向缺少目标地址。");
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error("网页重定向次数过多。");
        }
        currentUrl = await validatePublicUrl(
          new URL(location, currentUrl).toString(),
        );
        continue;
      }
      if (!response.ok) {
        throw new Error(`网页返回 HTTP ${response.status}。`);
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() || "";
      if (
        contentType &&
        !contentType.includes("text/html") &&
        !contentType.includes("application/xhtml+xml") &&
        !contentType.includes("text/plain")
      ) {
        throw new Error("该 URL 返回的不是 HTML 或文本网页。");
      }
      return { buffer: await readLimitedResponse(response), finalUrl: currentUrl };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("读取网页简历超时，请稍后重试。");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("无法读取网页简历。");
}

function createDocument(
  name: string,
  sourceType: ResumeSourceType,
  source: string,
  text: string,
): ResumeDocument {
  const normalizedText = limitText(text);
  if (normalizedText.length < 20) {
    throw new Error("没有从简历中提取到足够的文字内容。");
  }
  return {
    name,
    sourceType,
    source,
    text: normalizedText,
    characterCount: normalizedText.length,
  };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => {
          if (!("str" in item)) return "";
          return `${item.str}${item.hasEOL ? "\n" : " "}`;
        })
        .join("");
      pages.push(pageText);
      page.cleanup();
    }
  } finally {
    await document.destroy();
  }
  return pages.join("\n\n");
}

export class ResumeHelper {
  public static async parseFile(filePath: string): Promise<ResumeDocument> {
    const resolvedPath = await fs.promises.realpath(filePath);
    const stats = await fs.promises.stat(resolvedPath);
    if (!stats.isFile()) throw new Error("请选择有效的简历文件。");
    if (stats.size > MAX_FILE_BYTES) {
      throw new Error("简历文件不能超过 15 MB。");
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    const buffer = await fs.promises.readFile(resolvedPath);
    const name = path.basename(resolvedPath);

    if (extension === ".docx") {
      const result = await mammoth.extractRawText({ buffer });
      return createDocument(name, "docx", resolvedPath, result.value);
    }
    if (extension === ".doc") {
      const extractor = new WordExtractor();
      const result = await extractor.extract(buffer);
      const text = [
        result.getHeaders({ includeFooters: false }),
        result.getBody(),
        result.getTextboxes({ includeHeadersAndFooters: false }),
        result.getFooters(),
      ]
        .filter(Boolean)
        .join("\n\n");
      return createDocument(name, "doc", resolvedPath, text);
    }
    if (extension === ".pdf") {
      const text = await extractPdfText(buffer);
      return createDocument(name, "pdf", resolvedPath, text);
    }
    if (extension === ".html" || extension === ".htm") {
      const result = extractHtmlText(buffer);
      return createDocument(name, "html", resolvedPath, result.text);
    }
    throw new Error("仅支持 .doc、.docx、.pdf、.html 和 .htm 简历文件。");
  }

  public static async parseUrl(value: string): Promise<ResumeDocument> {
    const { buffer, finalUrl } = await fetchPublicHtml(value);
    const result = extractHtmlText(buffer);
    return createDocument(
      result.title || finalUrl.hostname,
      "url",
      finalUrl.toString(),
      result.text,
    );
  }
}

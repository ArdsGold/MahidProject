import type { BusinessSocialLink, ProfileAssetRef, SocialPlatform } from "@backlink-autofill/shared";

export function validateLogoFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Choose an image file for the logo.";
  if (file.size > 5 * 1024 * 1024) return "Logo images must be 5 MB or smaller.";
  return null;
}

export function validateBrochureFile(file: File): string | null {
  if (file.type !== "application/pdf") return "Choose a PDF file for the brochure.";
  if (file.size > 20 * 1024 * 1024) return "Brochures must be 20 MB or smaller.";
  return null;
}

export function createAssetRef(file: File, id: string): ProfileAssetRef {
  return { id, fileName: file.name, mimeType: file.type, size: file.size };
}

export function isSupportedSocialUrl(platform: string, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const domains: Record<string, string[]> = {
      facebook: ["facebook.com"], instagram: ["instagram.com"], linkedin: ["linkedin.com"],
      twitter: ["x.com", "twitter.com"], youtube: ["youtube.com", "youtu.be"],
      tiktok: ["tiktok.com"], pinterest: ["pinterest.com"],
    };
    return (domains[platform] ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

export function detectSocialPlatform(value: string): SocialPlatform | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "facebook.com" || host.endsWith(".facebook.com")) return "facebook";
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return "instagram";
    if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
    if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) return "twitter";
    if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be" || host.endsWith(".youtu.be")) return "youtube";
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
    if (host === "pinterest.com" || host.endsWith(".pinterest.com")) return "pinterest";
    return "other";
  } catch {
    return null;
  }
}

export function addSocialLink(existing: BusinessSocialLink[], link: BusinessSocialLink): BusinessSocialLink[] {
  return existing.some((candidate) => candidate.url.trim() === link.url.trim()) ? existing : [...existing, { ...link, url: link.url.trim() }];
}

const CLIPBOARD_BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "pre", "tr", "ul", "ol", "table"]);
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function escapeHtmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function descriptionHtmlForEditor(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!/<[a-z][\s\S]*>/i.test(trimmed)) {
    return trimmed.split(/\n{2,}/).filter(Boolean).map((paragraph) => `<p>${escapeHtmlText(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
  }
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) return trimmed;
  const doc = new Parser().parseFromString(`<div>${trimmed}</div>`, "text/html");
  const root = doc.body?.firstElementChild;
  if (!root) return trimmed;
  let result = "";
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) {
      const text = (child.nodeValue || "").trim();
      if (text) {
        const paragraphs = text.split(/\n{2,}/).filter(Boolean);
        result += paragraphs.map((paragraph) => `<p>${escapeHtmlText(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
      }
    } else if (child.nodeType === 1) {
      result += (child as Element).outerHTML;
    }
  }
  return result;
}

export function descriptionPlainText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/<a\s+[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function descriptionHtmlFromClipboard(html: string): string {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser || !html.trim()) return "";
  const body = new Parser().parseFromString(html, "text/html").body;
  const blocks: string[] = [];
  let inline = "";
  const flush = () => { const text = inline.trim(); if (text) blocks.push(`<p>${text}</p>`); inline = ""; };
  const walk = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) { inline += escapeHtmlText((child.nodeValue || "").replace(/\s+/g, " ")); continue; }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (tag === "br") { inline += "<br>"; continue; }
      if (tag === "a") {
        const href = element.getAttribute("href") || "";
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        inline += text && /^https?:\/\//i.test(href)
          ? `<a href="${escapeHtmlAttribute(href)}">${escapeHtmlText(text)}</a>`
          : escapeHtmlText(text);
        continue;
      }
      if (CLIPBOARD_BLOCK_TAGS.has(tag)) { flush(); walk(element); flush(); continue; }
      walk(element);
    }
  };
  walk(body);
  flush();
  return blocks.join("");
}

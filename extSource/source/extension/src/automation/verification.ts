export type SubmissionStatus = "success" | "pending" | "failed" | "needs-human" | "in-progress";
import { isGroup1Url } from './adapters';

export interface ArticleExpectation { title: string; bodyExcerpt: string; bodyText?: string; links?: string[]; images?: string[]; linkedText?: Array<{ href: string; text: string }> }
export interface PublicArticleCheck {
  status: "verified" | "unverified" | "failed";
  reason: string;
  canonicalUrl?: string;
  verifiedUrl?: string;
}

// Cross-origin publishing is opt-in per known publisher, never a registrable-domain guess.
export function publicArticleUrl(value: string, publisherUrl: string): string | undefined {
  try {
    if (!value || /^\s*#/.test(value)) return undefined;
    const publisher = new URL(publisherUrl);
    const target = new URL(value, publisher);
    const publicDomain = /^(?:www\.)?(blogocial\.com|bloguetechno\.com|thezenweb\.com)$/.exec(publisher.hostname)?.[1]
      || /^[a-z0-9-]+\.(blogocial\.com|bloguetechno\.com|thezenweb\.com)$/.exec(publisher.hostname)?.[1];
    const publisherSubdomain = publicDomain && target.hostname.endsWith('.' + publicDomain)
      && /^[a-z0-9-]+$/.test(target.hostname.slice(0, -(publicDomain.length + 1)));
    if (target.protocol !== "https:" || target.username || target.password || target.port || target.search) return undefined;
    if (target.origin !== publisher.origin && !publisherSubdomain) return undefined;
    const path = decodeURIComponent(target.pathname).toLowerCase();
    if (path.replace(/\//g, "").length < 5
      || /^\/(?:posts|articles|blog|news)\/?$/.test(path)
      || /(?:^|\/)(?:login|signin|sign-in|signup|register|auth|oauth|account|dashboard|admin|edit|new|preview|draft|logout)(?:\/|$)/.test(path)
      || /\.(?:js|css|json|xml|pdf|png|jpe?g|gif|svg|webp)$/i.test(path)) return undefined;
    target.hash = "";
    return target.href;
  } catch { return undefined; }
}

function articleText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function readableArticleText(root: ParentNode): string {
  root.querySelectorAll("p,div,br,li,td,th,section").forEach((element) => element.append(" "));
  return articleText(Array.from(root.childNodes).map((node) => node.textContent || "").join(" "));
}

// Template contents stay detached and inert; fetched resources never reach the live page.
export function articleExpectation(title: string, html: string, documentRef: Document): ArticleExpectation {
  const template = documentRef.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script,style,template,noscript").forEach((element) => element.remove());
  const links = Array.from(template.content.querySelectorAll('a[href]')).map(e => e.getAttribute('href')!).filter(Boolean);
  const images = Array.from(template.content.querySelectorAll('img[src]')).map(e => e.getAttribute('src')!).filter(Boolean);
  const linkedText = isGroup1Url(documentRef.location?.href || '') ? Array.from(template.content.querySelectorAll('a[href]')).map(e => ({ href: e.getAttribute('href')!, text: articleText(e.textContent || '') })) : undefined;
  const bodyText = readableArticleText(template.content);
  return { title: articleText(title), bodyExcerpt: bodyText.split(" ").slice(0, 24).join(" "), bodyText, links, images, ...(linkedText ? { linkedText } : {}) };
}

export function verifyPublicArticleHtml(html: string, expected: ArticleExpectation, documentRef: Document, responseUrl?: string): PublicArticleCheck {
  if (expected.title.length < 3 || expected.bodyExcerpt.length < 40 || expected.bodyExcerpt.split(" ").length < 8) {
    return { status: "unverified", reason: "Expected article title/body evidence is insufficient." };
  }
  const template = documentRef.createElement("template");
  template.innerHTML = html;
  const canonicalLinks = Array.from(template.content.querySelectorAll('link[rel~="canonical" i]'));
  const canonicalUrl = canonicalLinks.length === 1 && responseUrl
    ? publicArticleUrl(canonicalLinks[0].getAttribute('href') || '', responseUrl) : undefined;
  if (responseUrl && canonicalLinks.length && !canonicalUrl)
    return { status: "failed", reason: "Canonical article URL is unsafe or ambiguous." };
  if (template.content.querySelector('input[type="password"], form[action*="login" i], meta[http-equiv="refresh" i]')) {
    return { status: "failed", reason: "Public response is an authentication or redirect page." };
  }
  const suspended = Array.from(template.content.querySelectorAll('title, h1, h2, [role=alert], .alert'))
    .some(element => /\b(?:account|site|website|blog)\s+(?:(?:is|was|has been)\s+)?(?:suspended|disabled|terminated)\b|\bthis\s+(?:site|website|blog)\s+is\s+unavailable\b/i.test(element.textContent || ""));
  if (suspended) return { status: "failed", reason: "Public response reports that the publisher account or site is suspended/unavailable." };
  template.content.querySelectorAll("script,style,template,noscript,nav,header,footer,aside,form,[hidden],[aria-hidden=true]").forEach((element) => element.remove());
  template.content.querySelectorAll("[style]").forEach((element) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(element.getAttribute("style") || "")) element.remove();
  });
  const articles = Array.from(template.content.querySelectorAll("article,main,[role=main]"));
  for (const article of articles) {
    const headings = Array.from(article.querySelectorAll("h1,h2"));
    if (!headings.some((heading) => articleText(heading.textContent || "") === expected.title)) continue;
    const body = article.cloneNode(true) as Element;
    body.querySelectorAll("h1,h2").forEach((heading) => heading.remove());
    const resolvesTo = (value: string) => { try { return new URL(value, responseUrl).href; } catch { return value; } };
    const urlsPresent = (selector: string, attribute: string, values: string[]) => {
      const actual = Array.from(article.querySelectorAll(selector)).map(e => resolvesTo(e.getAttribute(attribute) || ''));
      return values.every(value => actual.includes(resolvesTo(value)));
    };
    if (readableArticleText(body).includes(expected.bodyText || expected.bodyExcerpt)
      && urlsPresent('a[href]', 'href', expected.links || []) && urlsPresent('img[src]', 'src', expected.images || [])
      && (expected.linkedText || []).every(link => Array.from(article.querySelectorAll('a[href]')).some(e => resolvesTo(e.getAttribute('href') || '') === resolvesTo(link.href) && articleText(e.textContent || '') === link.text))) {
      return { status: "verified", reason: expected.bodyText ? "Anonymous article matches the approved heading, complete body, links and images." : "Anonymous article response matches the expected heading and body excerpt.", ...(canonicalUrl ? { canonicalUrl } : {}) };
    }
  }
  return { status: "failed", reason: "Public response does not establish the expected article heading and body." };
}

export interface SubmissionResult {
  status: SubmissionStatus;
  liveUrl?: string;
  site: string;
  business: string;
  category?: string;
  subcategory?: string;
  confidence: number;
  submissionEmail?: string;
  username?: string;
  password?: string;
  notes?: string;
}

export function detectSubmissionResult(input: { url: string; text: string; links?: Array<{ text: string; href: string }> }, config: { successIndicators?: string[]; failureIndicators?: string[]; liveUrlHints?: string[] }): SubmissionResult["status"] {
  const text = input.text.toLowerCase();
  if ((config.failureIndicators || []).some((indicator) => text.includes(indicator.toLowerCase()))) return "failed";
  if ((config.successIndicators || []).some((indicator) => text.includes(indicator.toLowerCase()))) return "success";
  return "in-progress";
}

export function extractLiveUrl(input: { url: string; links?: Array<{ text: string; href: string }> }, config: { liveUrlHints?: string[] }): string | undefined {
  const hints = (config.liveUrlHints || []).map((hint) => hint.toLowerCase());
  const link = (input.links || []).find((candidate) => hints.some((hint) => candidate.text.toLowerCase().includes(hint)) && /^https?:/i.test(candidate.href));
  return link?.href || undefined;
}

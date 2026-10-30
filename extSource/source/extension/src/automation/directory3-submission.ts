import type { BusinessProfile } from "@backlink-autofill/shared";

export type Directory3Outcome = "uncertain" | "accepted" | "pending" | "duplicate" | "validation-error" | "rejected" | "public-verified";
export interface Directory3Review {
  digest: string; profileDigest: string; identityKey: string; url: string;
  termsUrl: string; termsNotice: string; name: string; website: string; description: string;
}
export interface Directory3Submission {
  review: Directory3Review;
  phase: "review" | "authorized" | "attempted" | "observing";
  observation?: {
    documentKey: string; textDigest: string;
    submittedAt?: string; resultAt?: string; resultUrl?: string;
    evidence?: string[]; discoveryAttempted?: boolean;
  };
  reviewedAt: number;
  expiresAt?: number;
  authorizationId?: string;
  termsAcceptedAt?: number;
  intentId?: string;
  outcome?: Directory3Outcome;
  publicUrl?: string;
  verification?: { url: string; checkedAt: string; status: "verified" };
  verificationAttempted?: boolean;
  sheetPreparation?: { status: "awaiting-original-sheet-validation"; column: "B"; domain: "directory3.org"; url: string };
}
export interface Directory3Receipt {
  runId: string; intentId: string; digest: string; claimed: boolean; outcome: Directory3Outcome;
}
export const DIRECTORY3_AUTH_MS = 5 * 60_000;
export function freshDirectory3Authorization(state: Directory3Submission, now = Date.now()): boolean {
  return !!state.authorizationId && Number.isFinite(state.termsAcceptedAt) && !!state.expiresAt
    && state.reviewedAt <= state.termsAcceptedAt! && state.termsAcceptedAt! <= now
    && now < state.expiresAt && state.expiresAt <= state.termsAcceptedAt! + DIRECTORY3_AUTH_MS;
}
export const directory3ReceiptKey = (identityKey: string) => `ba2.directory3.receipt:${identityKey}`;
export async function directory3Digest(value: unknown): Promise<string> {
  const material = JSON.stringify(value);
  // HTTP content worlds have no SubtleCrypto. Keep SHA-256 in the trusted
  // extension worker instead of weakening the digest or requiring HTTPS.
  if (!crypto.subtle) {
    const response = await chrome.runtime.sendMessage({ type: "BA2_D3_DIGEST", material }) as { ok?: boolean; digest?: string };
    if (!response?.ok || !/^[a-f0-9]{64}$/.test(response.digest || "")) throw Error("Directory3 secure digest unavailable");
    return response.digest!;
  }
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function directory3ProfileDigest(profile: BusinessProfile): Promise<string> {
  const { id, updatedAt, businessName, website, description, contactName, firstName, lastName, email, category, services } = profile;
  return directory3Digest({ id, updatedAt, businessName, website, description, contactName, firstName, lastName, email, category, services });
}
export const directory3Text = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
export function directory3PublicUrl(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || !/^https?:$/.test(url.protocol) || url.username || url.password || url.port || url.hash
      || !["directory3.org", "www.directory3.org"].includes(url.hostname)) return null;
    if (url.pathname === "/" || /(?:^|\/)(?:index|submit|rules|latest|login|register|search|contact|delete|remove|activate|verify|edit|checkout)(?:[./_-]|$)/i.test(url.pathname)
      || /(?:token|nonce|delete|action|activate|session|password|email)=/i.test(url.search)) return null;
    return url.href;
  } catch { return null; }
}

function resultRoot(doc: Document): Element { return doc.querySelector(".mainContent,main,article") || doc.body; }
export function directory3ResultText(doc: Document): string {
  const root = resultRoot(doc)?.cloneNode(true) as Element | undefined;
  if (!root) return "";
  root.querySelectorAll("script,style,iframe,nav,header,footer,aside,input,select,textarea,button,.g-recaptcha").forEach(el => el.remove());
  return directory3Text(root.textContent || "");
}
// Read rendered evidence regardless of message CSS. Completion is tracked
// independently by the coordinator; unknown text never proves publication.
// Actual POST wording remains unverified until a human supplies/captures it.
export function classifyDirectory3Response(doc: Document, origin: string): { outcome: Directory3Outcome; candidate?: string; evidence: string[] } {
  const text = directory3ResultText(doc);
  const duplicate = /(?:url|link|website).{0,45}already (?:exists|listed)|already (?:exists|listed).{0,30}(?:database|directory)/.exec(text);
  const validation = /(?:invalid|incorrect|missing) (?:url|email|category|title|captcha)|(?:url|email|category|title|captcha).{0,30}(?:is required|is invalid|incorrect|failed|expired)|validation (?:failed|error)/.exec(text);
  const rejected = /(?:submission|link|listing).{0,35}(?:rejected|not accepted|failed)/.exec(text);
  const pending = /(?:link|listing|submission).{0,80}(?:awaiting|pending|submitted for).{0,40}(?:review|approval)|(?:awaiting|pending) (?:review|approval)/.exec(text);
  const accepted = /(?:link|listing|submission).{0,35}(?:successfully (?:added|submitted|accepted)|has been (?:accepted|added))|thank you.{0,60}(?:submission|submitting)/.exec(text);
  const failure = duplicate || validation || rejected;
  const outcome: Directory3Outcome = failure && (pending || accepted) ? "uncertain" : duplicate ? "duplicate" : validation ? "validation-error" : rejected ? "rejected" : pending ? "pending" : accepted ? "accepted" : "uncertain";
  const links = [...new Set([...resultRoot(doc).querySelectorAll<HTMLAnchorElement>('a[href]')]
    .filter(a => !a.closest("nav,header,footer,aside") && /^(?:view (?:your )?(?:listing|link)|(?:listing|link) details)$/i.test(a.textContent?.trim() || ""))
    .map(a => directory3PublicUrl(a.getAttribute("href") || "", origin)).filter((url): url is string => !!url))];
  return { outcome, evidence: [duplicate, validation, rejected, pending, accepted].filter((match): match is RegExpExecArray => !!match).map(match => match[0].slice(0,180)), ...(links.length === 1 ? { candidate: links[0] } : {}) };
}
export function discoverDirectory3Links(doc: Document, url: string, review: Directory3Review): string[] {
  const origin = new URL(review.url).origin;
  if (new URL(url).origin !== origin) return [];
  let expected: string;
  try { expected = new URL(review.website).href.replace(/\/$/, ""); } catch { return []; }
  // td#links + outbound business link + Link Details are observed search markup.
  const candidates = [...doc.querySelectorAll('td[id="links"]')].flatMap(row => {
    const website = [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].some(a => { try { return new URL(a.getAttribute("href")!, url).href.replace(/\/$/, "") === expected; } catch { return false; } });
    if (!website) return [];
    return [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => /^link details$/i.test(a.textContent?.trim() || ""))
      .map(a => directory3PublicUrl(a.getAttribute("href")!, origin)).filter((href): href is string => !!href && /^\/details\.php\?id=\d+$/.test(new URL(href).pathname + new URL(href).search));
  });
  return [...new Set(candidates)].slice(0,4);
}
export function verifyDirectory3PublicHtml(doc: Document, url: string, review: Directory3Review): boolean {
  if (!directory3PublicUrl(url, new URL(review.url).origin)) return false;
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href");
  if (canonical && new URL(canonical, url).href !== url) return false;
  if (/captcha|access denied|sign in|log in/i.test(doc.title)) return false;
  // Verified native details.php pages use labelled table rows, not headings.
  const nativeUrl = new URL(url);
  if (nativeUrl.pathname === "/details.php" && /^\?id=\d+$/.test(nativeUrl.search)) {
    const tables = [...doc.querySelectorAll("table")].filter(table => [...table.rows].some(row => directory3Text(row.cells[0]?.textContent || "") === "listing id:"));
    if (tables.length !== 1) return false;
    const cells = (label: string) => [...tables[0].rows].filter(row => directory3Text(row.cells[0]?.textContent || "") === label).map(row => row.cells[1]);
    const ids = cells("listing id:"), titles = cells("title:"), descriptions = cells("description:");
    if (ids.length !== 1 || titles.length !== 1 || descriptions.length !== 1 || ids[0]?.textContent?.trim() !== nativeUrl.searchParams.get("id")) return false;
    const anchor = titles[0]?.querySelector<HTMLAnchorElement>('a[href]');
    let matches = false;
    try { matches = !!anchor && directory3Text(anchor.textContent || "") === directory3Text(review.name) && new URL(anchor.getAttribute("href")!, url).href.replace(/\/$/, "") === new URL(review.website).href.replace(/\/$/, ""); } catch { return false; }
    const excerpt = directory3Text(review.description).slice(0,160);
    return matches && excerpt.length >= 30 && directory3Text(descriptions[0]?.textContent || "").includes(excerpt);
  }
  const root = doc.querySelector("main,article") || doc.body;
  if (!root) return false;
  const headings = [...root.querySelectorAll("h1,h2,h3,[itemprop=name]")].filter(el => !el.closest("nav,header,footer,aside"));
  const names = headings.filter(el => directory3Text(el.textContent || "") === directory3Text(review.name));
  if (names.length !== 1 || headings.some(el => el !== names[0] && el.querySelector('a[href*="/detail/"],a[href*="/listing/"],a[href*="link.php"]'))) return false;
  const expected = new URL(review.website).href.replace(/\/$/, "");
  const websiteLinks = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(a => {
    if (a.closest("nav,header,footer,aside,form")) return false;
    try { return new URL(a.getAttribute("href") || "", url).href.replace(/\/$/, "") === expected; } catch { return false; }
  });
  const excerpt = directory3Text(review.description).slice(0, 160);
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll("script,style,form,nav,header,footer,aside").forEach(el => el.remove());
  return websiteLinks.length === 1 && excerpt.length >= 30 && directory3Text(clone.textContent || "").includes(excerpt);
}

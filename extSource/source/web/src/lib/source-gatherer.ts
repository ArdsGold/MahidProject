import type { BusinessInternalLink, BusinessProfileInput } from "@backlink-autofill/shared";
import { lookup } from "node:dns/promises";
import { City, Country, State } from "country-state-city";

const MAX_PAGES = 24;
const MAX_DEPTH = 2;
const MAX_BYTES = 1_000_000;
const REQUEST_TIMEOUT = 8_000;
const COMMERCIAL_TERMS = /service|services|product|solution|commercial|residential|repair|installation|removal|survey|quote|pricing|industry|area|construction|inspection|design|maintenance/i;
const JUNK_TERMS = /privacy|terms|login|register|account|cart|author|tag|feed|sitemap|admin/i;

function normalizeLocation(value: Pick<BusinessProfileInput, "country" | "countryCode" | "state" | "stateCode" | "city">): Pick<BusinessProfileInput, "country" | "countryCode" | "state" | "stateCode" | "city"> {
  const comparable = (input: unknown) => String(input ?? "").trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
  const countryValue = value.countryCode || value.country;
  const aliases: Record<string, string> = { us: "US", usa: "US", "u.s.": "US", "u.s.a.": "US", uk: "GB", "u.k.": "GB" };
  const countryCode = aliases[comparable(countryValue)] || Country.getAllCountries().find((country) => comparable(country.name) === comparable(countryValue) || comparable(country.isoCode) === comparable(countryValue))?.isoCode || Country.getAllCountries().find((country) => comparable(country.name) === comparable(value.country))?.isoCode || "";
  const country = Country.getCountryByCode(countryCode);
  if (!country) return { country: value.country || "", countryCode: value.countryCode || "", state: value.state || "", stateCode: value.stateCode || "", city: value.city || "" };
  const stateValue = value.stateCode || value.state;
  const state = State.getStatesOfCountry(countryCode).find((candidate) => comparable(candidate.name) === comparable(stateValue) || comparable(candidate.isoCode) === comparable(stateValue));
  const stateCode = state?.isoCode || "";
  const city = stateCode ? City.getCitiesOfState(countryCode, stateCode).find((candidate) => comparable(candidate.name) === comparable(value.city))?.name || "" : value.city || "";
  return { country: country.name, countryCode, state: state?.name || value.state || "", stateCode, city };
}

export interface GatherSources {
  gmbUrl: string;
  websiteUrl: string;
}

export interface GatherStatus {
  source: "gmb" | "website";
  status: "success" | "partial" | "unavailable" | "browser_capture_required";
  message: string;
}

export interface GatherResult {
  profile: Partial<BusinessProfileInput>;
  internalLinks: BusinessInternalLink[];
  statuses: GatherStatus[];
  warnings: string[];
}

export interface SourceSnapshot {
  facts: Partial<BusinessProfileInput>;
  links: CandidateLink[];
  text: string;
  browserCaptureRequired?: boolean;
}

export interface CandidateLink {
  label: string;
  url: string;
  score: number;
  commercial: boolean;
}

export interface SourceSnapshots {
  gmb: SourceSnapshot | null;
  website: SourceSnapshot | null;
}

export function validateSourceUrl(value: string, kind: "gmb" | "website"): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return `Enter a valid ${kind === "gmb" ? "Google Business Profile" : "website"} URL.`; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http:// or https:// URL.";
  if (kind === "gmb") {
    const host = url.hostname.toLowerCase();
    if (host !== "google.com" && !host.endsWith(".google.com") && host !== "google.co.uk" && !host.endsWith(".google.co.uk")) return "Use a Google Maps or Google Business Profile URL.";
  }
  return null;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function comparableHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function sameSite(left: URL, right: URL): boolean {
  const port = (url: URL) => url.port || (url.protocol === "https:" ? "443" : "80");
  return comparableHost(left.hostname) === comparableHost(right.hostname) && port(left) === port(right);
}

async function assertSafeUrl(value: string, origin?: string): Promise<URL> {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only web URLs can be gathered.");
  if (isPrivateHost(url.hostname)) throw new Error("Private network URLs are not allowed.");
  if (origin && !sameSite(url, new URL(origin))) throw new Error("Crawler links must stay on the source website.");
  const resolved = await lookup(url.hostname);
  if (isPrivateHost(resolved.address)) throw new Error("Private network URLs are not allowed.");
  return url;
}

async function fetchHtml(value: string, origin?: string): Promise<{ url: URL; html: string }> {
  let url = await assertSafeUrl(value, origin);
  const headers = { accept: "text/html,application/xhtml+xml", "user-agent": "BacklinkAutofillSourceReader/1.0" };
  let response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT), headers });
  for (let redirects = 0; response.status >= 300 && response.status < 400 && redirects < 3; redirects += 1) {
    const location = response.headers.get("location");
    if (!location) break;
    url = await assertSafeUrl(new URL(location, url).href, origin);
    response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REQUEST_TIMEOUT), headers });
  }
  if (!response.ok && response.status !== 202) throw new Error(`Source returned ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("Source is not an HTML page.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Source returned no readable content.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const chunk = await reader.read();
    if (chunk.done) break;
    chunks.push(chunk.value);
    size += chunk.value.byteLength;
  }
  await reader.cancel();
  const html = new TextDecoder().decode(concat(chunks, size));
  if (isBrowserChallengeResponse(response.status, html)) throw new SourceChallengeError();
  return { url: new URL(response.url || url.href), html };
}

export function isBrowserChallengeResponse(status: number, html: string): boolean {
  const challengeEvidence = /Robot Challenge Screen|sgcaptcha|\.well-known\/captcha|captcha|verify you are human|security check/i.test(html);
  const challengeMarkup = html.replace(/\s+/g, " ").trim().length < 30_000 && !/<(?:h1|h2|main|article|address)\b/i.test(html);
  const interstitialHeading = /<h[1-3][^>]*>\s*(?:verify you are human|security check|captcha)\b/i.test(html);
  return challengeEvidence && (status === 202 || challengeMarkup || interstitialHeading);
}

class SourceChallengeError extends Error {
  browserCaptureRequired = true;
  constructor() { super("Source presented a robot challenge; browser capture is required."); }
}

function concat(chunks: Uint8Array[], size: number): Uint8Array {
  const output = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) { const next = Math.min(chunk.byteLength, output.length - offset); output.set(chunk.subarray(0, next), offset); offset += next; if (offset >= output.length) break; }
  return output;
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string): string {
  return value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function visibleLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(?:p|div|section|article|li|address|h[1-6]|br|tr|footer|header)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const pattern of patterns) { const match = text.match(pattern); if (match?.[1]) return match[1].trim(); }
  return "";
}

function firstLineMatch(lines: string[], patterns: RegExp[]): string {
  for (const line of lines) {
    const value = firstMatch(line, patterns);
    if (value) return value;
  }
  return "";
}

function parseJsonLd(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => {
    try {
      const value = JSON.parse(match[1]);
      const values = Array.isArray(value) ? value : [value];
      return values.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        const raw = entry as Record<string, unknown>;
        return Array.isArray(raw["@graph"]) ? [raw, ...raw["@graph"].filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)] : [raw];
      });
    } catch { return []; }
  }).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
}

function jsonAddress(value: unknown): { address: string; city: string; state: string; postalCode: string; country: string } {
  if (typeof value !== "object" || value === null) return { address: "", city: "", state: "", postalCode: "", country: "" };
  const raw = value as Record<string, unknown>;
  return { address: String(raw.streetAddress ?? ""), city: String(raw.addressLocality ?? ""), state: String(raw.addressRegion ?? ""), postalCode: String(raw.postalCode ?? ""), country: typeof raw.addressCountry === "string" ? raw.addressCountry : String((raw.addressCountry as Record<string, unknown> | undefined)?.name ?? "") };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? cleanText(value) : "";
}

function isNoiseName(value: string): boolean {
  return /^(google(?: maps)?|maps|google business profile|untitled|home|welcome|menu|navigation|services?|about|contact)$/i.test(value.trim());
}

function jsonTypes(entry: Record<string, unknown>): string[] {
  const value = entry["@type"];
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
}

function isBusinessEntity(entry: Record<string, unknown>): boolean {
  return jsonTypes(entry).some((type) => type === "organization" || type === "localbusiness" || type.endsWith("business") || type === "professionalservice");
}

function firstNonNoise(values: unknown[]): string {
  return values.map(textValue).find((value) => value && !isNoiseName(value)) || "";
}

function jsonHours(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => jsonHours(entry));
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (typeof value !== "object" || value === null) return [];
  const raw = value as Record<string, unknown>;
  const days = Array.isArray(raw.dayOfWeek) ? raw.dayOfWeek : [raw.dayOfWeek];
  const names = days.filter((day): day is string => typeof day === "string").map((day) => day.split("/").pop() || day);
  const opens = textValue(raw.opens);
  const closes = textValue(raw.closes);
  if (!names.length || !opens || !closes) return [];
  return names.map((day) => `${day}: ${opens} - ${closes}`);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function visibleHours(lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const open = line.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*[-–]\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?\s*:\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
    if (open) {
      const start = WEEKDAYS.findIndex((day) => day.toLowerCase() === open[1].toLowerCase());
      const end = WEEKDAYS.findIndex((day) => day.toLowerCase() === (open[2] || open[1]).toLowerCase());
      for (const day of WEEKDAYS.slice(Math.max(0, start), end >= start ? end + 1 : start + 1)) result.push(`${day}: ${open[3]} - ${open[4]}`);
    }
    const closed = line.match(/\bClosed\s+(?:on\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*(?:and|&)\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?/i);
    if (closed) {
      const start = WEEKDAYS.findIndex((day) => day.toLowerCase() === closed[1].toLowerCase());
      const end = WEEKDAYS.findIndex((day) => day.toLowerCase() === (closed[2] || closed[1]).toLowerCase());
      for (const day of WEEKDAYS.slice(Math.max(0, start), end >= start ? end + 1 : start + 1)) result.push(`${day}: Closed`);
    }
  }
  return result;
}

function visibleLocation(lines: string[]): Pick<BusinessProfileInput, "city" | "state" | "stateCode" | "country" | "countryCode"> {
  const states = State.getAllStates();
  const statePattern = states.map((state) => state.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = lines.join(" ").match(new RegExp(`\\b([A-Za-z .'-]{2,}),\\s*(${statePattern}|[A-Z]{2})\\s+(\\d{5}(?:-\\d{4})?)\\b`, "i"));
  if (!match) return { city: "", state: "", stateCode: "", country: "", countryCode: "" };
  const state = states.find((item) => item.name.toLowerCase() === match[2].toLowerCase()) || (match[2].length === 2 ? states.find((item) => item.countryCode === "US" && item.isoCode.toLowerCase() === match[2].toLowerCase()) : undefined);
  return { city: match[1].trim(), state: state?.name || match[2], stateCode: state?.isoCode || "", country: state?.countryCode === "US" ? "United States" : "", countryCode: state?.countryCode || "" };
}

function visibleServiceHeadings(html: string): string[] {
  const headings = [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((match) => ({ level: Number(match[1]), text: cleanText(match[2]) }));
  let inServices = false;
  const result: string[] = [];
  for (const heading of headings) {
    if (/^services?$/i.test(heading.text)) { inServices = true; continue; }
    if (inServices && heading.level <= 2) inServices = false;
    if ((inServices && heading.level >= 3) || /construction staking|as[- ]?built|811|surveying|data center|connect vdc/i.test(heading.text)) result.push(heading.text);
  }
  return result.filter(usefulServiceLabel);
}

function extractLinks(html: string, baseUrl: URL): CandidateLink[] {
  return [...html.matchAll(/<a\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))([^>]*)>([\s\S]*?)<\/a>/gi)].flatMap((match) => {
    const href = match[2] || match[3] || match[4] || "";
    const attributes = `${match[1]} ${match[5]}`;
    const label = cleanText(match[6]) || firstMatch(attributes, [/(?:aria-label|title)=['"]([^'"]+)/i]) || decodeURIComponent(href).split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || "Useful page";
    let url: URL;
    try { url = new URL(href, baseUrl); } catch { return []; }
    if (!sameSite(url, baseUrl) || !/^https?:$/.test(url.protocol)) return [];
    url.hash = "";
    const normalized = url.href.replace(/\/$/, "") || url.origin;
    const score = (COMMERCIAL_TERMS.test(`${label} ${url.pathname}`) ? 5 : 0) - (JUNK_TERMS.test(`${label} ${url.pathname}`) ? 8 : 0) + Math.min(label.length / 30, 1);
    return [{ label, url: normalized, score, commercial: score >= 4 }];
  });
}

function jsonServices(entries: Record<string, unknown>[]): string[] {
  const values = entries.flatMap((entry) => {
    const candidates = [jsonTypes(entry).includes("service") ? entry.name : undefined, entry.serviceType, entry.category, entry.hasOfferCatalog, entry.makesOffer];
    return candidates.flatMap((value) => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.flatMap((item) => typeof item === "string" ? [item] : typeof item === "object" && item !== null ? [textValue((item as Record<string, unknown>).name)] : []);
      if (typeof value === "object" && value !== null) return [textValue((value as Record<string, unknown>).name)];
      return [];
    });
  });
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value && !isNoiseName(value));
}

function normalizeServices(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values.flatMap((item) => item.split(/[,;|]/)).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean)) {
    if (!result.some((existing) => existing.toLowerCase() === value.toLowerCase())) result.push(value);
    if (result.length === 10) break;
  }
  return result;
}

function entityScore(entry: Record<string, unknown>): number {
  if (!isBusinessEntity(entry)) return -1;
  const name = textValue(entry.name);
  if (!name || isNoiseName(name)) return -1;
  return 4 + (entry.telephone || entry.email ? 2 : 0) + (entry.address ? 2 : 0) + (entry.url ? 1 : 0) + (entry.description ? 1 : 0);
}

function pickBusinessEntity(entries: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return entries
    .map((entry) => ({ entry, score: entityScore(entry) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.entry;
}

function usefulServiceLabel(value: string): boolean {
  return Boolean(value && !isNoiseName(value) && !/^(learn more|read more|get started|request a quote|view all|home)$/i.test(value) && value.length >= 3);
}

function usableFacts(facts: Partial<BusinessProfileInput>, source: "gmb" | "website"): Partial<BusinessProfileInput> {
  const result = { ...facts };
  if (result.businessName && isNoiseName(result.businessName)) result.businessName = "";
  if (result.category && isNoiseName(result.category)) result.category = "";
  if (source === "gmb" && result.description && /google maps|search directions|google business profile/i.test(result.description)) result.description = "";
  return result;
}

export function extractSnapshot(html: string, baseUrl: URL, source: "gmb" | "website" = "website"): SourceSnapshot {
  const json = parseJsonLd(html);
  const business = pickBusinessEntity(json);
  const address = jsonAddress(business?.address);
  const lines = visibleLines(html);
  const text = cleanText(html);
  const title = firstMatch(html, [/<title[^>]*>([^<]+)/i]);
  const metaDescription = firstMatch(html, [/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i, /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i]);
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((match) => cleanText(match[1])).filter((value) => value.length > 2 && !isNoiseName(value));
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => cleanText(match[1])).filter((value) => value.length >= 40 && !/cookie|privacy|terms|subscribe|javascript/i.test(value));
  const titleName = title.replace(/\s*[|–-]\s*(?:home|welcome|official site|official website).*$/i, "").trim();
  const location = visibleLocation(lines);
  const entityName = firstNonNoise([business?.name, source === "website" ? titleName : "", headings.find((heading) => !/^services?|about|contact|home$/i.test(heading))]);
  const contactPoint = typeof business?.contactPoint === "object" && business.contactPoint !== null ? business.contactPoint as Record<string, unknown> : {};
  const hours = json.flatMap((entry) => jsonHours(entry.openingHoursSpecification ?? entry.openingHours));
  const serviceEntries = json.filter((entry) => jsonTypes(entry).includes("service") || jsonTypes(entry).includes("offer"));
  const facts: Partial<BusinessProfileInput> = {
    businessName: entityName,
    email: firstNonNoise([business?.email, contactPoint.email, firstLineMatch(lines, [/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i])]),
    phone: firstNonNoise([business?.telephone, contactPoint.telephone, firstLineMatch(lines, [/(\+?\(?\d[\d().\s-]{7,}\d)/])]),
    website: firstNonNoise([business?.url, source === "website" ? baseUrl.href : ""]),
    address: address.address || firstLineMatch(lines, [/(\d{1,6}\s+[\w .'-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Lane|Ln|Parkway|Pkwy)\b(?:\s+(?:Suite|Ste|Unit|#)\s*[\w-]+)?)/i]),
    city: address.city || location.city,
    state: address.state || location.state,
    stateCode: location.stateCode,
    postalCode: address.postalCode || firstMatch(text, [/\b(\d{5}(?:-\d{4})?)\b/]),
    country: address.country || location.country,
    countryCode: location.countryCode,
    category: firstNonNoise([business?.additionalType, business?.category, business?.serviceType]),
    description: firstNonNoise([business?.description, metaDescription, paragraphs.slice(0, 2).join(" "), headings.slice(0, 3).join(". ")]),
    businessHours: [...new Set([...hours, ...visibleHours(lines)])],
  };
  const socials = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map((match) => match[1]).filter((url) => /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest/i.test(url));
  for (const url of socials) { const key = /facebook/i.test(url) ? "facebook" : /instagram/i.test(url) ? "instagram" : /linkedin/i.test(url) ? "linkedin" : /youtube/i.test(url) ? "youtube" : /tiktok/i.test(url) ? "tiktok" : /pinterest/i.test(url) ? "pinterest" : "twitter"; if (!facts[key]) facts[key] = url; }
  const links = extractLinks(html, baseUrl);
  facts.services = normalizeServices([
    ...jsonServices(serviceEntries),
    ...links.filter((link) => link.commercial).map((link) => link.label).filter(usefulServiceLabel),
    ...visibleServiceHeadings(html),
  ].filter((service) => service.toLowerCase() !== entityName.toLowerCase()));
  return { facts, links, text };
}

async function gatherWebsite(url: string): Promise<SourceSnapshot> {
  const first = await fetchHtml(url);
  const origin = first.url.origin;
  const snapshots = [extractSnapshot(first.html, first.url, "website")];
  const queue = snapshots[0].links.map((link) => ({ url: link.url, depth: 1 }));
  const seen = new Set([first.url.href.replace(/#.*$/, "")]);
  while (queue.length && seen.size < MAX_PAGES) {
    const next = queue.shift();
    if (!next || next.depth > MAX_DEPTH || seen.has(next.url)) continue;
    seen.add(next.url);
    try {
      const page = await fetchHtml(next.url, origin);
      const snapshot = extractSnapshot(page.html, page.url, "website");
      snapshots.push(snapshot);
      if (next.depth < MAX_DEPTH) for (const link of snapshot.links) if (!seen.has(link.url)) queue.push({ url: link.url, depth: next.depth + 1 });
    } catch { /* one inaccessible page must not stop the crawl */ }
  }
  return { facts: mergeFacts(snapshots.map((item) => item.facts)), links: snapshots.flatMap((item) => item.links), text: snapshots.map((item) => item.text).join(" ") };
}

function mergeFacts(facts: Partial<BusinessProfileInput>[]): Partial<BusinessProfileInput> {
  const result: Partial<BusinessProfileInput> = {};
  for (const fact of facts) for (const [key, value] of Object.entries(fact)) if (value && (!Array.isArray(value) || value.length) && !result[key as keyof BusinessProfileInput]) result[key as keyof BusinessProfileInput] = value as never;
  result.services = facts.flatMap((fact) => fact.services ?? []);
  return result;
}

export function rankInternalLinks(links: CandidateLink[], origin: string): BusinessInternalLink[] {
  const unique = new Map<string, CandidateLink>();
  for (const link of links) {
    try {
      const url = new URL(link.url);
       if (!sameSite(url, new URL(origin)) || link.score <= 0) continue;
      url.hash = "";
      const normalized = url.href.replace(/\/$/, "") || url.origin;
      const current = unique.get(normalized);
      if (!current || link.score > current.score) unique.set(normalized, { ...link, url: normalized });
    } catch { continue; }
  }
  const ranked = [...unique.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return ranked.slice(0, 12).map((link) => ({ label: link.label, url: link.url, type: link.commercial ? "commercial" : "fallback" }));
}

export function generateShortDescription(facts: Partial<BusinessProfileInput>, links: BusinessInternalLink[]): string {
  const name = facts.businessName?.trim();
  if (!name) return "";
  const category = [facts.category?.trim(), facts.services?.[0]?.trim(), links.find((link) => link.type === "commercial")?.label]
    .find((value) => value && usefulServiceLabel(value)) || "";
  const location = [facts.city, facts.state].filter(Boolean).join(", ");
  const suffix = location ? ` serving ${location}` : "";
  const description = category ? `${name} provides ${category.toLowerCase()}${suffix}.` : facts.description?.trim().split(/(?<=[.!?])\s+/)[0] || "";
  if (description.length <= 160) return description;
  const compact = category ? `${name} provides ${category.split(/\s+/).slice(0, 8).join(" ").toLowerCase()}.` : "";
  return compact.length <= 160 ? compact : "";
}

function hasMeaningfulFacts(snapshot: SourceSnapshot | null): boolean {
  if (!snapshot) return false;
  const facts = snapshot.facts;
  const values = Object.entries(facts).filter(([key, value]) => key !== "website" && Boolean(value && (!Array.isArray(value) || value.length)));
  return values.length >= 2 && (!facts.businessName || !isNoiseName(facts.businessName) || values.some(([key]) => key !== "businessName"));
}

export function composeGatherResult(snapshots: SourceSnapshots, sources: GatherSources): GatherResult {
  const gmb = snapshots.gmb ? { ...snapshots.gmb, facts: usableFacts(snapshots.gmb.facts, "gmb") } : null;
  const website = snapshots.website ? { ...snapshots.website, facts: usableFacts(snapshots.website.facts, "website") } : null;
  const sourceStatus = (snapshot: SourceSnapshot | null, source: "gmb" | "website"): GatherStatus => {
    const hasData = Boolean(snapshot && Object.values(snapshot.facts).some((value) => value && (!Array.isArray(value) || value.length)));
    const usable = hasMeaningfulFacts(snapshot);
    return {
      source,
      status: usable ? "success" : hasData ? "partial" : "unavailable",
      message: source === "gmb"
        ? usable ? "Google Business Profile analyzed." : hasData ? "Google Business Profile partially analyzed; verify the extracted facts." : "Google Business Profile unavailable or incomplete; website data used where possible."
        : usable ? "Website analyzed successfully." : hasData ? "Website partially analyzed; review the extracted facts." : "Website unavailable; check the URL and try again.",
    };
  };
  const statuses: GatherStatus[] = [
    sourceStatus(gmb, "gmb"),
    sourceStatus(website, "website"),
  ];
  const warnings = statuses.filter((status) => status.status !== "success").map((status) => status.message);
  const { email: _websitePublicEmail, ...websiteFacts } = website?.facts ?? {};
  const merged: Partial<BusinessProfileInput> = { ...websiteFacts };
  const gmbFacts = gmb?.facts ?? {};
  for (const key of ["businessName", "phone", "address", "country", "countryCode", "state", "stateCode", "city", "postalCode", "category", "businessHours"]) {
    const value = gmbFacts[key as keyof BusinessProfileInput];
    if (value && (!Array.isArray(value) || value.length)) merged[key as keyof BusinessProfileInput] = value as never;
  }
  for (const key of ["description", "facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest", "services"]) {
    const value = website?.facts[key as keyof BusinessProfileInput] || gmbFacts[key as keyof BusinessProfileInput];
    if (value && (!Array.isArray(value) || value.length)) merged[key as keyof BusinessProfileInput] = (key === "services" ? normalizeServices(value as string[]) : value) as never;
  }
  Object.assign(merged, normalizeLocation(merged as Pick<BusinessProfileInput, "country" | "countryCode" | "state" | "stateCode" | "city">));
  const links = rankInternalLinks(website?.links ?? [], new URL(sources.websiteUrl).origin);
  return { profile: { ...merged, sourceGmbUrl: sources.gmbUrl, sourceWebsiteUrl: sources.websiteUrl, shortDescription: generateShortDescription(merged, links) }, internalLinks: links, statuses, warnings };
}

export async function gatherBusinessSources(sources: GatherSources): Promise<GatherResult> {
  const gmbError = validateSourceUrl(sources.gmbUrl, "gmb");
  const websiteError = validateSourceUrl(sources.websiteUrl, "website");
  if (gmbError || websiteError) throw new Error([gmbError, websiteError].filter(Boolean).join(" "));
  const results = await Promise.allSettled([fetchHtml(sources.gmbUrl).then(({ html, url }) => extractSnapshot(html, url, "gmb")), gatherWebsite(sources.websiteUrl)]);
  const gmb = results[0].status === "fulfilled" ? results[0].value : null;
  const website = results[1].status === "fulfilled" ? results[1].value : null;
  const result = composeGatherResult({ gmb, website }, sources);
  const challenges: Array<[number, "gmb" | "website", string]> = [[0, "gmb", "Google Business Profile"], [1, "website", "Website"]];
  for (const [index, source, label] of challenges) if (results[index].status === "rejected" && results[index].reason instanceof SourceChallengeError) {
    const status = result.statuses.find((item) => item.source === source);
    if (status) { status.status = "browser_capture_required"; status.message = `${label} protected from automated access. Open it normally in Chrome, then capture the page.`; }
  }
  result.warnings = result.statuses.filter((item) => item.status !== "success").map((item) => item.message);
  return result;
}

import { normalizeSourceSnapshot, type SourceSnapshot } from "@backlink-autofill/shared";

const SERVICE_TERMS = /service|solution|repair|installation|survey|construction|inspection|design|maintenance|pricing|quote/i;
const JUNK_TERMS = /privacy|terms|login|account|cart|sitemap|admin/i;

export function isLikelyChallengeContent(title: string, body: string): boolean {
  const combined = `${title} ${body}`;
  return /sgcaptcha|robot challenge|verify you are human|security check|captcha|checking your browser/i.test(combined) && body.replace(/\s+/g, " ").trim().length < 30_000;
}

function text(value: string | null | undefined): string { return (value || "").replace(/\s+/g, " ").trim(); }
function first(values: unknown[]): string { return values.find((value): value is string => typeof value === "string" && Boolean(text(value)))?.toString().trim() || ""; }
function jsonLd(): Record<string, unknown>[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((node) => {
    try {
      const value = JSON.parse(node.textContent || "");
      return (Array.isArray(value) ? value : [value]).flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const raw = entry as Record<string, unknown>;
        return [raw, ...(Array.isArray(raw["@graph"]) ? raw["@graph"].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [])];
      });
    } catch { return []; }
  });
}
function entity(entries: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return entries.find((entry) => {
    const type = Array.isArray(entry["@type"]) ? entry["@type"] : [entry["@type"]];
    return type.some((item) => typeof item === "string" && /organization|localbusiness|professionalservice|business/i.test(item)) && typeof entry.name === "string" && !/^(google|maps|home|menu|welcome)$/i.test(entry.name.trim());
  });
}
function address(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  return { address: first([raw.streetAddress]), city: first([raw.addressLocality]), state: first([raw.addressRegion]), postalCode: first([raw.postalCode]), country: typeof raw.addressCountry === "string" ? raw.addressCountry : first([(raw.addressCountry as Record<string, unknown> | undefined)?.name]) };
}
function linkScore(label: string, url: URL): number {
  return (SERVICE_TERMS.test(`${label} ${url.pathname}`) ? 5 : 1) - (JUNK_TERMS.test(`${label} ${url.pathname}`) ? 8 : 0);
}
function links(base: URL) {
  const unique = new Map<string, { label: string; url: string; score: number; type: "commercial" | "fallback" }>();
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    let url: URL;
    try { url = new URL(anchor.href, base); } catch { continue; }
    const comparable = (value: URL) => `${value.protocol}//${value.hostname.toLowerCase().replace(/^www\./, "")}:${value.port || (value.protocol === "https:" ? "443" : "80")}`;
    if (comparable(url) !== comparable(base) || !/^https?:$/.test(url.protocol)) continue;
    url.hash = "";
    const normalized = url.href.replace(/\/$/, "") || url.origin;
    const label = text(anchor.getAttribute("aria-label") || anchor.textContent) || decodeURIComponent(url.pathname).split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || "Useful page";
    const score = linkScore(label, url);
    if (score <= 0 || unique.has(normalized)) continue;
    unique.set(normalized, { label, url: normalized, score, type: score >= 4 ? "commercial" : "fallback" });
  }
  return [...unique.values()].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, 12).map(({ label, url, type }) => ({ label, url, type }));
}

export function captureCurrentSource(): SourceSnapshot | null {
  const sourceUrl = location.href;
  const base = new URL(sourceUrl); base.hash = "";
  const sourceType = /(^|\.)google\.(com|[a-z.]+)$/i.test(base.hostname) ? "gmb" : "website";
  const entries = jsonLd();
  const business = entity(entries);
  const place = address(business?.address);
  const bodyText = text(document.body?.innerText);
  const visibleLines = (document.body?.innerText || "").split(/\n+/).map((line) => text(line)).filter(Boolean);
  const contact = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a) => a.href).filter(Boolean);
  const headings = [...document.querySelectorAll("h1,h2,h3")].map((node) => text(node.textContent)).filter(Boolean);
  const paragraphs = [...document.querySelectorAll("p")].map((node) => text(node.textContent)).filter((value) => value.length >= 40);
  const title = text(document.title);
  const metaDescription = document.querySelector<HTMLMetaElement>('meta[name="description"],meta[property="og:description"]')?.content || "";
  const email = first([business?.email, bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0], contact.find((url) => url.startsWith("mailto:"))?.slice(7)]);
  const phone = first([business?.telephone, bodyText.match(/\+?\(?\d[\d().\s-]{7,}\d/)?.[0]]);
  const social = contact.filter((url) => /facebook|instagram|linkedin|twitter|x\.com|youtube|tiktok|pinterest/i.test(url));
  const locationMatch = bodyText.match(/\b([A-Za-z .'-]{2,}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/);
  const stateCodes: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const visibleHours = visibleLines.flatMap((line) => {
    const match = line.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*[-–]\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?\s*:\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
    if (match) {
      const start = weekdays.findIndex((day) => day.toLowerCase() === match[1].toLowerCase());
      const end = weekdays.findIndex((day) => day.toLowerCase() === (match[2] || match[1]).toLowerCase());
      return weekdays.slice(start, end >= start ? end + 1 : start + 1).map((day) => `${day}: ${match[3]} - ${match[4]}`);
    }
    const closed = line.match(/\bClosed\s+(?:on\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s*(?:and|&)\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?/i);
    if (!closed) return [];
    const start = weekdays.findIndex((day) => day.toLowerCase() === closed[1].toLowerCase());
    const end = weekdays.findIndex((day) => day.toLowerCase() === (closed[2] || closed[1]).toLowerCase());
    return weekdays.slice(start, end >= start ? end + 1 : start + 1).map((day) => `${day}: Closed`);
  });
  const addressLine = first(visibleLines.filter((line) => /\b\d{1,6}\s+.+\b(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Way|Court|Ct|Lane|Ln|Parkway|Pkwy)\b/i.test(line)));
  const serviceHeadings = headings.filter((heading) => SERVICE_TERMS.test(heading) && !/^(services?|about|contact|home)$/i.test(heading) && !heading.toLowerCase().includes(title.replace(/\s*[|–-]\s*(home|welcome|official site).*$/i, "").trim().toLowerCase()));
  const facts: SourceSnapshot["facts"] = {
    businessName: first([business?.name, sourceType === "website" ? title.replace(/\s*[|–-]\s*(home|welcome|official site).*$/i, "") : "", headings[0]]),
    email, phone, website: first([business?.url, sourceType === "website" ? base.href : ""]),
    ...place,
    address: first([place.address, addressLine]),
    city: first([place.city, locationMatch?.[1]]),
    state: first([place.state, locationMatch?.[2] ? stateCodes[locationMatch[2]] : ""]),
    stateCode: first([locationMatch?.[2]]),
    postalCode: first([place.postalCode, locationMatch?.[3]]),
    country: first([place.country, locationMatch?.[2] ? "United States" : ""]),
    countryCode: first([locationMatch?.[2] ? "US" : ""]),
    description: first([business?.description, metaDescription, paragraphs.slice(0, 2).join(" ")]),
    category: first([business?.category, business?.additionalType]),
    services: [...new Set([...entries.filter((entry) => /service|offer/i.test(String(entry["@type"]))).map((entry) => first([entry.name, entry.serviceType])), ...serviceHeadings, ...links(base).filter((link) => link.type === "commercial").map((link) => link.label)])].filter(Boolean).slice(0, 10),
    businessHours: [...entries.flatMap((entry) => Array.isArray(entry.openingHours) ? entry.openingHours.filter((item): item is string => typeof item === "string") : typeof entry.openingHours === "string" ? [entry.openingHours] : []), ...visibleHours],
  };
  for (const url of social) {
    const key = /facebook/i.test(url) ? "facebook" : /instagram/i.test(url) ? "instagram" : /linkedin/i.test(url) ? "linkedin" : /youtube/i.test(url) ? "youtube" : /tiktok/i.test(url) ? "tiktok" : /pinterest/i.test(url) ? "pinterest" : "twitter";
    if (!facts[key]) facts[key] = url;
  }
  return normalizeSourceSnapshot({ sourceType, sourceUrl: base.href, capturedAt: new Date().toISOString(), facts, internalLinks: sourceType === "website" ? links(base) : [], evidence: { title, visibleTextLength: bodyText.length, structuredData: Boolean(business) } });
}

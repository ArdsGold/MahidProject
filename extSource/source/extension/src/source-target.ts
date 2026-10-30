export type CaptureSourceType = "website" | "gmb";

export function isDashboardUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000";
  } catch { return false; }
}

export function sourceOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.hostname === "maps.google.com") url.hostname = "google.com";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch { return null; }
}

export function matchesSourceOrigin(tabUrl: string, requestedUrl: string): boolean {
  const tabOrigin = sourceOrigin(tabUrl);
  const requestedOrigin = sourceOrigin(requestedUrl);
  return Boolean(tabOrigin && requestedOrigin && tabOrigin === requestedOrigin && !isDashboardUrl(tabUrl));
}

export function isAllowedCaptureUrl(value: string, sourceType: CaptureSourceType): boolean {
  if (isDashboardUrl(value)) return false;
  const origin = sourceOrigin(value);
  if (!origin) return false;
  if (sourceType === "gmb") {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === "google.com" || host.endsWith(".google.com") || host === "google.co.uk" || host.endsWith(".google.co.uk");
    } catch { return false; }
  }
  return true;
}

import type { ControlledAction } from "./action-system";

export interface SiteAdapterConfig {
  id: string;
  domains: string[];
  startingUrl?: string;
  entryLabels: string[];
  navigationHints?: string[];
  fieldHints?: Record<string, string[]>;
  uploadHints?: string[];
  manualGates?: string[];
  successIndicators?: string[];
  failureIndicators?: string[];
  liveUrlHints?: string[];
  publication?: { messageSelector: string; visitLabels: string[]; successLinkSelector?: string };
  editor?: { titleSelector: string; frameSelector: string; instanceName: string; publishSelector: string };
}

export interface SiteAdapter {
  config: SiteAdapterConfig;
  matches(url: string): boolean;
  discoverEntry(pageText: string, links: Array<{ text: string; href: string }>): ControlledAction | null;
}

function host(url: string): string {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function createSiteAdapter(config: SiteAdapterConfig): SiteAdapter {
  const domains = config.domains.map((value) => value.toLowerCase().replace(/^www\./, ""));
  return {
    config,
    matches: (url) => domains.includes(host(url)),
    discoverEntry: (_pageText, links) => {
      const hints = [...config.entryLabels, ...(config.navigationHints || [])].map((value) => value.toLowerCase());
      const match = links.find((link) => hints.some((hint) => link.text.toLowerCase().includes(hint)));
      return match ? { action: "CLICK", target: match.href, confidence: 0.9, reason: `Entry link matches configured site hint: ${match.text}` } : null;
    },
  };
}

export function normalizeDomain(url: string): string { return host(url); }

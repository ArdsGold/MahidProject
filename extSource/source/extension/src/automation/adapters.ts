import { isAutomationExcluded } from "@backlink-autofill/shared";
import { advancedSeoDirectoryAdapter } from "./advanced-seo-directory";
import { toptendirAdapter } from "./toptendir";
import { smartdirAdapter } from "./smartdir";
import { ifidirAdapter } from "./ifidir";
import { efdirAdapter } from "./efdir";
import { relevantDirectoriesAdapter } from "./relevant-directories";
import { relevantDirectoryAdapter } from "./relevant-directory";
import { relatedDirectoryAdapter } from "./related-directory";
import { linkedinDirectoryAdapter } from "./linkedin-directory";
import { fireDirectoryAdapter } from "./fire-directory";
import { uniqueListingAdapter } from "./unique-listing";
import { directory3Adapter } from "./directory3";
import { groovyDirectoryAdapter } from "./groovy-directory";
import { redditDirectoryAdapter } from "./reddit-directory";
import { expansionDirectoryAdapter } from "./expansion-directory";
import { bizzDirectoryAdapter } from "./bizz-directory";
import { f03Directories } from "./f03-directory";
import { jetLinksAdapter } from "./jet-links";
import { adbriteDirectoryAdapter } from "./adbrite-directory";
import { bluebookDirectoryAdapter } from "./bluebook-directory";
import { auroraDirectoryAdapter } from "./aurora-directory";
import { fruityDirectoryAdapter } from "./fruity-directory";
import { greenyDirectoryAdapter } from "./greeny-directory";
import { familydirAdapter } from "./familydir";
import { searchDomainHereAdapter } from "./search-domain-here";
export { directory3Adapter } from "./directory3";

import { createSiteAdapter, type SiteAdapter, type SiteAdapterConfig } from "./site-adapter";

// Individually audited public-forms-1 sites. Membership does not establish
// authenticated editor/success selectors or cross-origin publication policy.
export const GROUP_1_DOMAINS = ['pages10.com', 'ampblogs.com', 'blogocial.com', 'onesmablog.com', 'blogolize.com', 'bloguetechno.com', 'ampedpages.com', 'pointblog.net', 'full-design.com', 'thezenweb.com', 'tinyblogging.com'] as const;
export function isGroup1Url(value: string): boolean {
  try { return (GROUP_1_DOMAINS as readonly string[]).includes(new URL(value).hostname.toLowerCase()); } catch { return false; }
}

// Structural default shared by supported article publishers. Sites may override
// selectors/labels through their existing adapter; URL safety remains mandatory.
export const DEFAULT_PUBLICATION_ADAPTER: NonNullable<SiteAdapterConfig['publication']> = {
  messageSelector: '[role=status], [role=alert], .alert, .success, h1, h2, p, div, span',
  visitLabels: ['visit', 'view article', 'view post', 'permalink', 'public', 'public article', 'public post'],
};

export const freeWebAdsAdapter: SiteAdapter = createSiteAdapter({
  id: "freewebads",
  domains: ["freewebads.biz"],
  startingUrl: "https://freewebads.biz/",
  entryLabels: ["post free ad", "post an ad", "post ad", "free ad"],
  navigationHints: ["add listing", "submit listing"],
  fieldHints: {
    businessName: ["title", "business", "company", "ad title"],
    website: ["website", "url", "homepage"],
    description: ["description", "details", "about"],
    email: ["email", "contact email"],
    phone: ["phone", "telephone"],
    logo: ["image", "photo", "logo"],
  },
  uploadHints: ["image", "photo", "logo"],
  manualGates: ["CAPTCHA", "Terms/Agreement", "Payment", "Account verification"],
  successIndicators: ["ad posted", "listing submitted", "submission successful", "view listing"],
  failureIndicators: ["required field", "duplicate", "captcha failed", "rate limit", "error"],
  liveUrlHints: ["view listing", "view ad", "permalink", "canonical"],
});



const bloguetechnoAdapter = createSiteAdapter({
  id: 'bloguetechno', domains: ['bloguetechno.com'], entryLabels: [],
  publication: { ...DEFAULT_PUBLICATION_ADAPTER, successLinkSelector: 'a#successfully_posted[href]' },
});

const thezenwebAdapter = createSiteAdapter({
  id: 'thezenweb', domains: ['thezenweb.com'], entryLabels: [],
  fieldHints: { businessName: ['title'] },
  publication: { ...DEFAULT_PUBLICATION_ADAPTER, successLinkSelector: 'a#successfully_posted[href]' },
  // Authenticated editor and post-publication marker confirmed by the operator.
  editor: {
    titleSelector: 'input[name="title"]',
    frameSelector: 'iframe[title="Rich Text Editor, editor1"]',
    instanceName: 'editor1',
    publishSelector: 'input[name="publish"][type="submit"]',
  },
});

export const FAMILY3_ADAPTERS: SiteAdapter[] = [directory3Adapter, uniqueListingAdapter, groovyDirectoryAdapter, redditDirectoryAdapter, expansionDirectoryAdapter, bizzDirectoryAdapter, ...f03Directories.map(({ adapter }) => adapter), jetLinksAdapter, adbriteDirectoryAdapter, bluebookDirectoryAdapter, auroraDirectoryAdapter, fruityDirectoryAdapter, greenyDirectoryAdapter, familydirAdapter, searchDomainHereAdapter, fireDirectoryAdapter, linkedinDirectoryAdapter, relatedDirectoryAdapter, relevantDirectoryAdapter, relevantDirectoriesAdapter, efdirAdapter, ifidirAdapter, smartdirAdapter, toptendirAdapter, advancedSeoDirectoryAdapter];
export function getFamily3Adapter(url: string): SiteAdapter | null { return FAMILY3_ADAPTERS.find(adapter => adapter.matches(url)) || null; }
export function isFamily3Host(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return FAMILY3_ADAPTERS.some(adapter => adapter.config.domains.includes(host));
  } catch { return false; }
}
export const SITE_ADAPTERS: SiteAdapter[] = [freeWebAdsAdapter, ...FAMILY3_ADAPTERS, bloguetechnoAdapter, thezenwebAdapter];

export function getSiteAdapter(url: string): SiteAdapter | null {
  if (isAutomationExcluded(url)) return null;
  return SITE_ADAPTERS.find((adapter) => adapter.matches(url)) || null;
}

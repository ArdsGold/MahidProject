// Membership from existing Family 1 audited inventory and Family 2 read-only roster.
// Legacy automation is retained for historical regression tests, never production.
import { getSiteAdapter } from './automation/adapters';
declare const __BA2_LEGACY_AUTOMATION_TEST__: boolean;
// Historical engine fixtures opt into their old workflow; production never does.
export const SMART_AUTOFILL_ENABLED = typeof __BA2_LEGACY_AUTOMATION_TEST__ === 'undefined' || !__BA2_LEGACY_AUTOMATION_TEST__;
export function smartAutofillOnly(value: string | undefined): boolean {
  try { return SMART_AUTOFILL_ENABLED && /^https?:$/.test(new URL(value || '').protocol) && !manualAutofillFamily(value) && !getSiteAdapter(value!); }
  catch { return false; }
}
export function currentPageAutofillOnly(value: string | undefined): boolean { return !!manualAutofillFamily(value) || smartAutofillOnly(value); }
export const FAMILY1_HOSTS = ["pages10.com","ampblogs.com","blogocial.com","onesmablog.com","blogolize.com","bloguetechno.com","ampedpages.com","shotblogs.com","tribunablog.com","blogzet.com","canariblogs.com","theobloggers.com","blogoscience.com","daneblogger.com","vidublog.com","nizarblog.com","develop-blog.com","spintheblog.com","theideasblog.com","blog-gold.com","worldblogged.com","bleepblogs.com","shoutmyblog.com","blog2freedom.com","collectblogs.com","smblogsites.com","eedblog.com","goabroadblog.com","bloggadores.com","blogtov.com","blogminds.com","suomiblog.com","pointblog.net","full-design.com","thezenweb.com","tinyblogging.com","blog5.net","designertoblog.com","affiliatblogger.com","diowebhost.com","fitnell.com","dbblog.net","ezblogz.com","blogs-service.com","bluxeblog.com","bloggin-ads.com","mybjjblog.com","tblogz.com","uzblog.net","blog-ezine.com"];
export const FAMILY2_HOSTS = ["localsdaily.com","postingzz.com","dailyizze.com","usacategories.com","nationpromoted.com","usapromoted.com","citypromoted.com","citycategories.com","citiezz.com","businessizze.com","cityizze.com","postizze.com","localstorefronts.com","cityadvertised.com","localdisplayed.com","featureizze.com","featurezz.com","localfeatured.com","advertisingceo.com","localcategories.com","usafeatured.com"];
export function manualAutofillFamily(value: string | undefined): 1 | 2 | null {
  if (typeof __BA2_LEGACY_AUTOMATION_TEST__ !== 'undefined' && __BA2_LEGACY_AUTOMATION_TEST__) return null;
  try {
    const host = new URL(value || '').hostname.toLowerCase().replace(/^www\./, '');
    const matches = (domains: string[]) => domains.some(domain => host === domain || host.endsWith('.' + domain));
    return matches(FAMILY1_HOSTS) ? 1 : matches(FAMILY2_HOSTS) ? 2 : null;
  } catch { return null; }
}

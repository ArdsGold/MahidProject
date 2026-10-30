import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Recorded HTTP homepage/submit.php and native fields verified read-only.
// HTTP availability is intermittent; Chrome error pages are navigation failures,
// never a Reload step. Existing same-origin/document guards remain unchanged.
const site = { id: "advanced-seo-directory", domain: "advancedseodirectory.com", name: "Advanced SEO Directory", startingUrl: "http://advancedseodirectory.com/", protocols: ["http:", "https:"], entryLabels: ["Add Site"] };
export const advancedSeoDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isAdvancedSeoDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectAdvancedSeoDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

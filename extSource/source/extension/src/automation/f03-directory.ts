import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Each exact domain's Add Site -> POST form contract was independently GET-verified.
// Category dictionaries remain per-site; a group match never supplies option IDs.
const sites = [
  { id: "ad-links", domain: "ad-links.org", name: "Ad Links" },
  { id: "backpagedir", domain: "backpagedir.com", name: "Backpage Directory" },
  { id: "addgoodsites", domain: "addgoodsites.com", name: "Add Good Sites" },
  { id: "businessfreedirectory", domain: "businessfreedirectory.biz", name: "Business Free Directory" },
].map(site => ({ ...site, startingUrl: `https://${site.domain}/`, protocols: ["https:"], entryLabels: ["Add Site"] }));

export const f03Directories = sites.map(site => ({
  site, adapter: createNativeDirectoryAdapter(site),
  inspect: (doc: Document, value: string) => inspectNativeDirectory(doc, value, site),
}));
export const F03_DIRECTORY_IDS = sites.map(site => site.id);
export function getF03Directory(value: string) {
  // Recognize the exact host even on unsupported protocols, so inspection fails
  // closed instead of falling back to generic autofill.
  return f03Directories.find(({ site }) => isNativeDirectoryHost(value, site.domain)) || null;
}

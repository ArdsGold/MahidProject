import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Recorded HTTP remains supported; actual reused Chrome profile uses verified HTTPS.
// Preserve the current origin and first observed Submit Link without rewriting.
const site = { id: "relevant-directory", domain: "relevantdirectory.biz", name: "Relevant Directory", startingUrl: "http://relevantdirectory.biz/", protocols: ["http:", "https:"], entryLabels: ["Submit Link"] };
export const relevantDirectoryAdapter = createNativeDirectoryAdapter(site);
const discoverNativeEntry = relevantDirectoryAdapter.discoverEntry;
relevantDirectoryAdapter.discoverEntry = (text, links) => {
  // Preserve Codegen .first(): never skip an unsafe first match for a later one.
  const first = links.find(link => link.text.trim() === "Submit Link");
  return discoverNativeEntry(text, first ? [first] : []);
};
export const isRelevantDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectRelevantDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

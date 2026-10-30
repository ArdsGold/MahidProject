import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Recorded HTTP destination; two observed Submit Link entries share this target.
const site = { id: "linkedin-directory", domain: "linkedin-directory.com", name: "LinkedIn Directory", startingUrl: "http://linkedin-directory.com/", protocols: ["http:"], entryLabels: ["Submit Link"] };
export const linkedinDirectoryAdapter = createNativeDirectoryAdapter(site);
const discoverNativeEntry = linkedinDirectoryAdapter.discoverEntry;
linkedinDirectoryAdapter.discoverEntry = (text, links) => {
  // Preserve Codegen .first(): never skip an unsafe first match for a later one.
  const first = links.find(link => link.text.trim() === "Submit Link");
  return discoverNativeEntry(text, first ? [first] : []);
};
export const isLinkedinDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectLinkedinDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

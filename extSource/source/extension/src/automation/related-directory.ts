import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Recorded HTTP/Submit Link route. Form reads currently time out; the existing
// strict native contract must pass at runtime before any values are written.
const site = { id: "related-directory", domain: "relateddirectory.org", name: "Related Directory", startingUrl: "http://relateddirectory.org/", protocols: ["http:"], entryLabels: ["Submit Link"] };
export const relatedDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isRelatedDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectRelatedDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

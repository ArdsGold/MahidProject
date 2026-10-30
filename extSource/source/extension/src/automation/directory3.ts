import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Directory3's HTTP navigation and native POST controls were independently
// verified by the supplied headed recording and a read-only native-form GET.
const site = { id: "directory3", domain: "directory3.org", name: "Directory3", startingUrl: "http://directory3.org/", protocols: ["http:", "https:"] };
export const directory3Adapter = createNativeDirectoryAdapter(site);
export const isDirectory3Host = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectDirectory3 = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

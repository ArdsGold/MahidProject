import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// GET-verified image-link title and footer text resolve to the same native form.
const site = { id: "expansion-directory", domain: "expansiondirectory.com", name: "Expansion Directory", startingUrl: "https://expansiondirectory.com/", protocols: ["https:"], entryLabels: ["Submit your link to the directory", "Submit Link"] };
export const expansionDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isExpansionDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectExpansionDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

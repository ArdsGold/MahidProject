import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Current anonymous GET confirms the F02/Groovy native field contract.
const site = { id: "bizz-directory", domain: "bizz-directory.com", name: "Bizz Directory", startingUrl: "https://bizz-directory.com/", protocols: ["https:"], entryLabels: ["Submit Link"] };
export const bizzDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isBizzDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectBizzDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

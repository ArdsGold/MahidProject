import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Verified HTTPS F04 native form; recorded homepage entry is inside #navigation.
const site = { id: "aurora-directory", domain: "aurora-directory.com", name: "Aurora Directory", startingUrl: "https://aurora-directory.com/", protocols: ["https:"], entryLabels: ["Submit Link"] };
export const auroraDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isAuroraDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectAuroraDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

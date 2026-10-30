import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Current HTTPS/Chrome evidence matches Expansion's F04 native form.
// The Codegen unnamed description cell contains textarea[name="DESCRIPTION"].
const site = { id: "bluebook-directory", domain: "bluebook-directory.com", name: "Bluebook Directory", startingUrl: "https://bluebook-directory.com/", protocols: ["https:"], entryLabels: ["Submit"] };
export const bluebookDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isBluebookDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectBluebookDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

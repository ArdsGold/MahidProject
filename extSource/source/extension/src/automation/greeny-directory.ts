import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Recorded Submit Link and current anonymous HTTPS GET match the native F04 form.
// Chrome403/error documents remain unsupported; no access/TLS workaround.
const site = { id: "greeny-directory", domain: "greenydirectory.com", name: "Greeny Directory", startingUrl: "https://greenydirectory.com/", protocols: ["https:"], entryLabels: ["Submit Link"] };
export const greenyDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isGreenyDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectGreenyDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

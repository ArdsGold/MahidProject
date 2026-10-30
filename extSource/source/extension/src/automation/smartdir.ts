import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Read-only HTTP/HTTPS homepage and Add Site form verified on 2026-10-19.
const site = { id: "smartdir", domain: "smartdir.org", name: "Smartdir", startingUrl: "https://smartdir.org/", protocols: ["http:", "https:"], entryLabels: ["Add Site"] };
export const smartdirAdapter = createNativeDirectoryAdapter(site);
export const isSmartdirHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectSmartdir = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

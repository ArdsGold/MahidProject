import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Read-only HTTP/HTTPS homepage and Add Site form verified on 2026-10-19.
const site = { id: "toptendir", domain: "toptendir.net", name: "Toptendir", startingUrl: "https://toptendir.net/", protocols: ["http:", "https:"], entryLabels: ["Add Site"] };
export const toptendirAdapter = createNativeDirectoryAdapter(site);
export const isToptendirHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectToptendir = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

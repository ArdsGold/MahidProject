import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// User-recorded Add Site / HTTP submit.php route. Both live schemes timed out.
// Provisional reuse: the strict native contract must pass before any fill;
// current category options and final controls are not verified live evidence.
const site = { id: "ifidir", domain: "ifidir.com", name: "Ifidir", startingUrl: "http://ifidir.com/", protocols: ["http:", "https:"], entryLabels: ["Add Site"] };
export const ifidirAdapter = createNativeDirectoryAdapter(site);
export const isIfidirHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectIfidir = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Actual GET: Add Site -> /submit.php; one untouched free-listing radio.
const site = { id: "reddit-directory", domain: "reddit-directory.com", name: "Reddit Directory", startingUrl: "https://reddit-directory.com/", protocols: ["https:"], entryLabels: ["Add Site"], manualRadio: { name: "LINK_TYPE", value: "normal" } };
export const redditDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isRedditDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectRedditDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

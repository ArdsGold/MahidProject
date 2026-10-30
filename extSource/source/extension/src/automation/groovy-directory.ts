import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Anonymous GET verified HTTPS redirect, singular entry label and native form.
const site = { id: "groovy-directory", domain: "groovy-directory.com", name: "Groovy Directory", startingUrl: "https://groovy-directory.com/", protocols: ["https:"], entryLabels: ["Submit Link"] };
export const groovyDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isGroovyDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectGroovyDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

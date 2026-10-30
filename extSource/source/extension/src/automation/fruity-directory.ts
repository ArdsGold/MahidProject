import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Codegen path and current anonymous HTTPS GET match Expansion's native F04 form.
// Actual Chrome access may return403; an error document cannot pass inspection.
const site = { id: "fruity-directory", domain: "fruity-directory.com", name: "Fruity Directory", startingUrl: "https://fruity-directory.com/", protocols: ["https:"], entryLabels: ["Submit Link"] };
export const fruityDirectoryAdapter = createNativeDirectoryAdapter(site);
export const isFruityDirectoryHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectFruityDirectory = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

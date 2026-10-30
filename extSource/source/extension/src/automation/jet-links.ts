import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Verified Jet F07 contract; Adbrite reuses it in its separately authorized adapter.
export const jetLinksSite = { id: "jet-links", domain: "jet-links.com", name: "Jet Links", startingUrl: "https://jet-links.com/", protocols: ["https:"], entryLabels: ["Add Site"],
  manualTerms: { name: "agree", value: "0", label: "Accept Terms of Agreement", rulesPath: "/rules.php", exitValue: "Exit" } };
export const jetLinksAdapter = createNativeDirectoryAdapter(jetLinksSite);
export const isJetLinksHost = (value: string) => isNativeDirectoryHost(value, jetLinksSite.domain);
export const inspectJetLinks = (doc: Document, value: string) => inspectNativeDirectory(doc, value, jetLinksSite);

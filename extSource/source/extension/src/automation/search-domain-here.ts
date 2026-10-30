import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// User's recorded HTTP URL and audited F06 Submit input, not a Continue form.
export const searchDomainHereSite = { id: "search-domain-here", domain: "searchdomainhere.com", name: "Search Domain Here", startingUrl: "http://searchdomainhere.com/", protocols: ["http:"], entryLabels: ["Add Site"], submitValue: "Submit" as const };
export const searchDomainHereAdapter = createNativeDirectoryAdapter(searchDomainHereSite);
export const isSearchDomainHereHost = (value: string) => isNativeDirectoryHost(value, searchDomainHereSite.domain);
export const inspectSearchDomainHere = (doc: Document, value: string) => inspectNativeDirectory(doc, value, searchDomainHereSite);

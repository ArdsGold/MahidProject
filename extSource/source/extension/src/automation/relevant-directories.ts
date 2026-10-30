import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";

// Verified HTTP/HTTPS Add Site and native Submit; preserve current origin.
export const relevantDirectoriesSite = { id: "relevant-directories", domain: "relevantdirectories.com", name: "Relevant Directories", startingUrl: "http://relevantdirectories.com/", protocols: ["http:", "https:"], entryLabels: ["Add Site"], submitValue: "Submit" as const };
export const relevantDirectoriesAdapter = createNativeDirectoryAdapter(relevantDirectoriesSite);
export const isRelevantDirectoriesHost = (value: string) => isNativeDirectoryHost(value, relevantDirectoriesSite.domain);
export const inspectRelevantDirectories = (doc: Document, value: string) => inspectNativeDirectory(doc, value, relevantDirectoriesSite);

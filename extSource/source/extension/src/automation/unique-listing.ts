import { createNativeDirectoryAdapter, inspectNativeDirectory, isNativeDirectoryHost } from "./native-directory";
export { NATIVE_DIRECTORY_FIELDS as UNIQUE_LISTING_FIELDS } from "./native-directory";

const site = { id: "unique-listing", domain: "unique-listing.com", name: "Unique Listing", startingUrl: "https://unique-listing.com/", protocols: ["https:"] };
export const uniqueListingAdapter = createNativeDirectoryAdapter(site);
export const isUniqueListingHost = (value: string) => isNativeDirectoryHost(value, site.domain);
export const inspectUniqueListing = (doc: Document, value: string) => inspectNativeDirectory(doc, value, site);

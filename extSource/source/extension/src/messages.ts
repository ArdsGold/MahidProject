import type { AutofillField, SourceSnapshot } from "@backlink-autofill/shared";
import type { CaptureSourceType } from "./source-target";
import type { AdaptiveStage } from "./automation/adaptive-discovery";
import type { AmpBlogsPreflightResponse } from "./ampblogs-client";
import type { AmpBlogsObservation } from "./ampblogs";
import type { StructuralEvidence } from "./automation/structural-signature";
import type { BlogWorkflowObservation } from "./automation/blog-workflow";

export interface FilledFieldReport {
  field: AutofillField;
  descriptor: string;
  value: string;
}

export interface SkippedFieldReport {
  descriptor: string;
  reason: string;
}

export interface AutofillReport {
  profileName: string;
  filled: FilledFieldReport[];
  skipped: SkippedFieldReport[];
}

export type ListingField = "businessName" | "firstName" | "lastName" | "website" | "description" | "businessHours" | "contactName" | "username" | "email" | "password" | "phone" | "address" | "city" | "state" | "postalCode" | "country" | "category" | "services" | "facebook" | "instagram" | "linkedin" | "twitter" | "youtube" | "tiktok" | "pinterest" | "imageUrl";

export interface ListingFilledFieldReport {
  field: ListingField;
  descriptor: string;
  value: string;
}

export interface ListingAutofillReport {
  smartFallback?: true;
  profileName: string;
  filled: ListingFilledFieldReport[];
  skipped: SkippedFieldReport[];
  navigationUrl?: string;
  entryClick?: boolean;
  entryAction?: { label: string; href?: string };
  location?: { status: "detected" | "selected" | "no-match"; label?: string; href?: string; message?: string };
  category?: { status: "detected" | "selected" | "no-match" | "location-mismatch"; level: "category" | "subcategory"; label?: string; href?: string; message?: string; reason?: string; confidence?: number; recommendations?: { label: string; confidence: number; href?: string }[] };
  learnedEntryUrl?: string;
  manual: string[];
  status?: "success" | "pending" | "failed" | "needs-human" | "in-progress";
  confidence?: number;
  liveUrl?: string;
  reason?: string;
  adaptive?: { stage: AdaptiveStage; diagnostics: string[]; confidence?: number };
  structural?: StructuralEvidence;
  workflow?: BlogWorkflowObservation;
  expectedArticle?: import("./automation/verification").ArticleExpectation;
  form?: {
    location?: { value: string; verified: boolean };
    description?: { verified: boolean };
    contactForm?: { verified: boolean };
    commercialInterests?: { checked: boolean };
    logo?: { requested?: boolean; attached: boolean; message?: string };
    brochure?: { requested: boolean; attached?: boolean; message?: string };
    terms?: { checked: boolean };
  };
}

export interface ListingCategoryMapping {
  profileKey: string;
  value: string;
  label: string;
}

export type ListingStartRequest = { type: "BA2_START_LISTING_AUTOFILL"; continuous?: boolean; ampBlogsAccountStatus?: "existing" | "new"; accountStatus?: "existing" | "new"; autoPublish?: boolean; autoLogin?: boolean; autoRegister?: boolean; freshFromRunId?: string; registrationRecoveryFromRunId?: string; firstRegistrationConfirmed?: boolean; existingAccountRecoveryFromRunId?: string };

export interface ListingDispatchInspection {
  actionType: "BA2_START_LISTING_AUTOFILL" | null;
  recoveryFields: Record<"existingAccount" | "registration" | "freshHomepage", { present: boolean; matchesSavedRun: boolean }>;
  selectedTabId: number | null;
  savedTabId: number | null;
  selectedOrigin: string | null;
  savedOrigin: string | null;
  sameOrigin: boolean | null;
  savedTabUnavailable: boolean;
  workerRoute: "unsupported-action" | "startContinuousListingRun:entry" | "startListingRun:existing-account-recovery" | "startListingRun:registration-recovery" | "startListingRun:saved-tab-unavailable" | "startListingRun:remaining-preflight";
  authorization: { autoRegister: boolean | null; autoLogin: boolean | null; autoPublish: boolean | null };
}

export type ExtensionMessage =
  | { type: "BA2_D3_DIGEST"; material: string }
  | { type: "BA2_D3_PREPARE"; runId: string }
  | { type: "BA2_D3_AUTHORIZE"; runId: string; digest: string; acceptTerms: boolean; authorize: boolean }
  | { type: "BA2_D3_INSPECT" }
  | { type: "BA2_D3_WATCH" }
  | { type: "BA2_D3_CHANGED"; runId: string }
  | { type: "BA2_D3_MANUAL_SUBMIT"; runId: string }
  | { type: "BA2_D3_SUBMIT"; runId: string; intentId: string }
  | { type: "BA2_D3_CLAIM"; runId: string; intentId: string }
  | { type: "BA2_D3_VERIFY_HTML"; html: string; url: string; review: import("./automation/directory3-submission").Directory3Review }
  | { type: "BA2_D3_DISCOVER_HTML"; html: string; url: string; review: import("./automation/directory3-submission").Directory3Review }
  | { type: "BA2_ARCHIVE_STOPPED_LISTING_RUN"; runId: string }
  | { type: "BA2_AUTOFILL"; loginOnly?: { profileId: string; profileUpdatedAt: string; url: string } }
  | { type: "BA2_LISTING_AUTOFILL"; articleImage?: { profileId: string; profileUpdatedAt: string; url: string }; categoryMapping?: ListingCategoryMapping }
  | { type: "BA2_AMPBLOGS_OBSERVE" }
  | { type: "BA2_AMPBLOGS_LOGIN_AUTOFILL" }
  | { type: "BA2_AMPBLOGS_SUBMIT_LOGIN" }
  | { type: "BA2_BLOG_PUBLISH_ONCE"; runId: string; attemptId: string }
  | { type: "BA2_BLOG_VALIDATE"; runId: string }
  | { type: "BA2_BLOG_OBSERVE" }
  | { type: "BA2_WATCH_PUBLICATION"; runId: string; attemptId: string }
  | { type: "BA2_PUBLICATION_CHANGED"; runId: string; attemptId: string }
  | { type: "BA2_LOGIN_PREPARE"; runId: string; fill?: boolean }
  | { type: "BA2_LOGIN_SUBMIT_ONCE"; runId: string; attemptId: string }
  | { type: "BA2_LOGIN_WATCH"; runId: string }
  | { type: "BA2_LOGIN_CHANGED"; runId: string }
  | { type: "BA2_REGISTRATION_PREPARE"; runId: string; fill?: boolean }
  | { type: "BA2_REGISTRATION_SUBMIT_ONCE"; runId: string; attemptId: string }
  | { type: "BA2_REGISTRATION_WATCH"; runId: string }
  | { type: "BA2_REGISTRATION_CHANGED"; runId: string }
  | { type: "BA2_VERIFY_PUBLIC_ARTICLE"; html: string; expected: import("./automation/verification").ArticleExpectation; responseUrl?: string }
  | { type: "BA2_BUILD_ARTICLE_EXPECTATION"; title: string; html: string }
  | { type: "BA2_RECOVER_PUBLICATION"; runId: string; tabId: number }
  | { type: "BA2_SELECT_LOCATION"; label: string; href?: string }
  | { type: "BA2_SELECT_CATEGORY"; label: string; href?: string }
  | { type: "BA2_SELECT_ENTRY"; label: string; href?: string }
  | ListingStartRequest
  | { type: 'BA2_WATCH_PUBLICATION_READY'; runId: string }
  | { type: 'BA2_PUBLICATION_READY'; runId: string }
  | { type: "BA2_INSPECT_LISTING_DISPATCH"; action: ListingStartRequest }
  | { type: "BA2_START_AMPBLOGS_PREFLIGHT" }
  | { type: "BA2_GET_LISTING_STATUS" }
  | { type: "BA2_GET_PUBLICATION_TRACE" }
  | { type: "BA2_SYNC_VERIFIED_LISTING" }
  | { type: "BA2_GET_ACTIVE_PROFILE" }
  | { type: "BA2_SYNC_FROM_DASHBOARD" }
  | { type: "BA2_CAPTURE_SOURCE" }
  | { type: "BA2_CAPTURE_REQUEST"; jobId: string; sourceType: CaptureSourceType; sourceUrl: string }
   | { type: "BA2_GET_PROFILE_LOGO"; profileId: string; assetId: string; fileName: string }
   | { type: "BA2_ATTACH_PROFILE_LOGO"; fileName: string; mimeType: string; data: ArrayBuffer | number[] }
  | { type: "BA2_GET_PROFILE_BROCHURE"; profileId: string; assetId: string; fileName: string }
  | { type: "BA2_ATTACH_PROFILE_BROCHURE"; fileName: string; mimeType: string; data: ArrayBuffer | number[] }
  | { type: "BA2_FIND_BROCHURE_INPUT" }
  | { type: "BA2_DELIVER_SOURCE_CAPTURE"; snapshot: SourceSnapshot };

export type AutofillResponse =
  | { ok: true; report: AutofillReport }
  | { ok: false; error: string };

export type ListingAutofillResponse =
  | { ok: true; report: ListingAutofillReport }
  | { ok: false; error: string };

export type ListingRunAck = { ok: true; runId: string; message?: string; requiresAuthorization?: boolean } | { ok: false; error: string };

export type AmpBlogsPreflightResponseMessage = AmpBlogsPreflightResponse;

export type AmpBlogsObservationResponse = { ok: true; observation: AmpBlogsObservation } | { ok: false; error: string };

export type ActiveProfileResponse =
  | { ok: true; profileName: string; syncedAt: string | null }
  | { ok: false; error: string };

export type SyncResponse =
  | { ok: true; profileName: string | null }
  | { ok: false; error: string };

export type SourceCaptureResponse =
  | { ok: true; snapshot: SourceSnapshot; tabId?: number }
  | { ok: false; error: string; code?: "opened" | "retry" | "wrong_source" | "no_data" | "action_required" | "timeout" | "content_script"; tabId?: number };

export type CaptureRequestAck = { ok: true; jobId: string } | { ok: false; error: string };

export type ProfileLogoResponse =
  | { ok: true; fileName: string; mimeType: string; data: ArrayBuffer | number[]; size: number; diagnostics: string[] }
  | { ok: false; error: string; diagnostics?: string[] };

export type LogoAttachResponse = {
  ok: boolean;
  error?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  diagnostics?: string[];
};

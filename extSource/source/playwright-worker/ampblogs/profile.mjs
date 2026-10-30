export const EXPECTED_AMP_BLOGS_BUSINESS = "Hot Mess Cleanup & Junk Removal";

export function validateAmpBlogsProfile(profile) {
  if (!profile || typeof profile !== "object") return { ok: false, code: "profile-missing", reason: "No Active Business Profile was supplied." };
  if (typeof profile.businessName !== "string" || profile.businessName.trim() !== EXPECTED_AMP_BLOGS_BUSINESS) {
    return { ok: false, code: "profile-mismatch", reason: "Active Business Profile does not match the AmpBlogs pilot business." };
  }
  return { ok: true, identity: { profileId: typeof profile.profileId === "string" ? profile.profileId : "", businessName: EXPECTED_AMP_BLOGS_BUSINESS } };
}

// Retired destinations stay excluded even when a generic form mapper could
// recognize their fields. This list grants no automation capabilities.
export const EXCLUDED_AUTOMATION_HOSTS = ["cargodirectory.co"] as const;
export const AUTOMATION_EXCLUDED_MESSAGE = "This website is excluded from MAHID automation. Historical records are preserved.";
export function isAutomationExcluded(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/\.$/, "");
    return EXCLUDED_AUTOMATION_HOSTS.some(host => hostname === host || hostname.endsWith(`.${host}`));
  } catch { return false; }
}

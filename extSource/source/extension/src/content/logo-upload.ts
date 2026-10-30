// Chrome runtime messages serialize JSON; reconstruct only validated byte arrays.
export function assetBufferFromMessage(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value;
  if (!Array.isArray(value) || !value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return null;
  return Uint8Array.from(value).buffer;
}

export interface LogoUploadDiagnostics {
  ok: boolean;
  steps: string[];
  error?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

function contextText(input: HTMLInputElement): string {
  const label = input.closest("label");
  const labelClone = label?.cloneNode(true) as HTMLElement | undefined;
  labelClone?.querySelectorAll("input, select, textarea").forEach((element) => element.remove());
  const associated = input.labels ? Array.from(input.labels).map((item) => item.textContent || "") : [];
  const labelledBy = (input.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => (id ? input.ownerDocument.getElementById(id)?.textContent || "" : ""));
  const nearby = [input.previousElementSibling?.textContent, input.nextElementSibling?.textContent, labelClone?.textContent];
  const parent = input.parentElement;
  const parentText = parent ? Array.from(parent.childNodes)
    .filter((node) => node.nodeType === 3)
    .map((node) => node.textContent)
    .join(" ") : "";
  const container = input.closest("td, th, .field, .form-group, .upload, .uploader, .upload-button")?.textContent || "";
  return [
    input.getAttribute("name"),
    input.id,
    input.getAttribute("aria-label"),
    input.getAttribute("placeholder"),
    input.getAttribute("accept"),
    ...associated,
    ...labelledBy,
    ...nearby,
    parentText,
    container,
  ].filter(Boolean).join(" ");
}

export function findLogoInputs(documentRef: Document): HTMLInputElement[] {
  return Array.from(documentRef.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .map((input, index) => ({ input, index, text: contextText(input).toLowerCase() }))
    .filter(({ input, text }) => !input.disabled && !/\bcv\b|brochure|document|pdf|resume|attachment|verification\s+document|identity\s+document|your\s+photo|profile\s+photo|avatar|headshot|portrait|personal\s+photo/.test(text))
    .sort((a, b) => {
      const score = (text: string, input: HTMLInputElement) => {
        if (/your\s+logo|business\s+logo|company\s+logo|logo/.test(text)) return 10;
        if (/filetoupload/.test((input.id || input.name || "").toLowerCase())) return 8;
        if (/logo|business\s+(?:image|logo)/.test(text)) return 6;
        if (/upload pictures?|pictures?|photo|image/.test(text) || /image\//.test(input.getAttribute("accept") || "")) return 3;
        return 1;
      };
      return score(b.text, b.input) - score(a.text, a.input) || a.index - b.index;
    })
    .map(({ input }) => input);
}

// Family 2 profile preparation requires explicit logo evidence, never a generic photo fallback.
export function findProfileLogoInput(documentRef: Document): HTMLInputElement | undefined {
  const inputs = findLogoInputs(documentRef).filter(input => {
    if (!/\blogo\b/i.test(contextText(input))) return false;
    const form = input.closest('form');
    return form && Array.from(form.querySelectorAll('button, input[type="submit"], input[type="button"]'))
      .some(control => /update\s+profile/i.test(`${control.textContent || ''} ${control.getAttribute('value') || ''}`));
  });
  return inputs.length === 1 ? inputs[0] : undefined;
}

function limitFromInput(input: HTMLInputElement): number | undefined {
  const raw = ["data-max-size", "data-max-filesize", "data-max-file-size", "data-maxsize", "max-size", "max"]
    .map((name) => input.getAttribute(name)).find(Boolean);
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  const text = [raw, contextText(input), input.ownerDocument.body?.innerText].filter(Boolean).join(" ");
  const match = text.match(/(?:maximum|max)\s*(?:file)?\s*size\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(kb|kib|mb|mib|gb|gib)/i)
    || text.match(/maximum\s*filesize\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(kb|kib|mb|mib|gb|gib)/i);
  if (!match) return undefined;
  const units: Record<string, number> = { kb: 1000, kib: 1024, mb: 1000 ** 2, mib: 1024 ** 2, gb: 1000 ** 3, gib: 1024 ** 3 };
  return Math.floor(Number(match[1]) * units[match[2].toLowerCase()]);
}

export function detectUploadLimit(input: HTMLInputElement): number | undefined { return limitFromInput(input); }

function acceptedMime(input: HTMLInputElement, mimeType: string): boolean {
  const accept = input.getAttribute("accept")?.toLowerCase().split(",").map((item) => item.trim()).filter(Boolean) || [];
  return accept.length === 0 || accept.some((item) => item === "image/*" || item === mimeType.toLowerCase() || item.endsWith("/*") && mimeType.toLowerCase().startsWith(item.slice(0, -1)));
}

async function optimizeImage(file: File, limit: number, input: HTMLInputElement): Promise<File | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    const jpegAllowed = acceptedMime(input, "image/jpeg");
    const mime = jpegAllowed ? "image/jpeg" : file.type;
    for (const scale of [1, 0.8, 0.65, 0.5, 0.35, 0.25]) {
      canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
      canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.86, 0.7, 0.5, 0.35]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
        if (blob && blob.size <= limit) {
          const extension = mime === "image/jpeg" ? "jpg" : (file.name.split(".").pop() || "png");
          const name = file.name.replace(/\.[^.]+$/, `.${extension}`);
          return new File([blob], name, { type: mime, lastModified: file.lastModified });
        }
      }
    }
    return null;
  } finally {
    bitmap.close();
  }
}

export async function attachLogoFile(input: HTMLInputElement, bytes: ArrayBuffer, fileName: string, mimeType: string): Promise<LogoUploadDiagnostics> {
  const steps = ["Logo asset reference found", `Logo Blob loaded: ${(bytes.byteLength / 1024).toFixed(0)} KB ${mimeType || "application/octet-stream"}`];
  if (!bytes.byteLength) return { ok: false, steps, error: "Blob unavailable" };
  const originalType = mimeType || "application/octet-stream";
  if (!/^image\//i.test(originalType)) return { ok: false, steps, error: `Unsupported MIME: ${originalType}` };
  if (!acceptedMime(input, originalType)) return { ok: false, steps, error: `Unsupported MIME for upload field: ${originalType}` };
  let file = new File([bytes], fileName || "business-logo", { type: originalType });
  steps.push(`File created: ${file.name}`);
  const limit = detectUploadLimit(input);
  steps.push(limit === undefined ? "Site limit: not exposed" : `Site limit: ${(limit / 1024).toFixed(0)} KB`);
  if (limit !== undefined && file.size > limit) {
    const optimized = await optimizeImage(file, limit, input).catch(() => null);
    if (!optimized) return { ok: false, steps, error: `File exceeds site limit (${limit} bytes) and could not be optimized in memory` };
    file = optimized;
    steps.push(`Optimized in memory: ${file.name} ${file.size} bytes`);
  }
  steps.push(`Upload input detected: ${input.files?.length || 0} existing file(s)`);
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    steps.push("Change dispatched");
  } catch (error) {
    return { ok: false, steps, error: `Browser rejected file assignment: ${error instanceof Error ? error.message : "File object assignment failed"}` };
  }
  const assigned = input.files?.[0];
  steps.push(`File assigned: ${file.name}`);
  steps.push(`input.files.length = ${input.files?.length || 0}`);
  if (!assigned || input.files?.length !== 1 || assigned.name !== file.name || assigned.size !== file.size || assigned.type !== file.type) {
    return { ok: false, steps, error: "Browser rejected file assignment: input.files verification failed" };
  }
  return { ok: true, steps, fileName: assigned.name, fileSize: assigned.size, fileType: assigned.type };
}

function sameFile(input: HTMLInputElement, result: LogoUploadDiagnostics): boolean {
  const file = input.files?.[0];
  return Boolean(file && input.files?.length === 1 && file.name === result.fileName && file.size === result.fileSize && file.size > 0 && /^image\//i.test(file.type));
}

export async function attachLogoToLiveInput(documentRef: Document, bytes: ArrayBuffer, fileName: string, mimeType: string, waitMs = 500): Promise<LogoUploadDiagnostics> {
  const diagnostics: string[] = [];
  let last: LogoUploadDiagnostics = { ok: false, steps: [], error: "No compatible image input found" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const input = findLogoInputs(documentRef)[0];
    if (!input) return { ok: false, steps: diagnostics, error: `No compatible image input found; found ${documentRef.querySelectorAll('input[type="file"]').length} file input(s)` };
    diagnostics.push(input.id === "FileToUpload" || input.name === "FileToUpload" ? "FileToUpload found" : "Business Logo file input found");
    diagnostics.push(window.top === window ? "Frame detected: top document" : "Frame detected: embedded document");
    last = await attachLogoFile(input, bytes, fileName, mimeType);
    diagnostics.push(...last.steps);
    if (!last.ok) {
      if (!last.error?.includes("input.files verification failed")) return { ...last, steps: diagnostics };
      diagnostics.push(`File assignment was reset immediately; re-finding live input after ${waitMs}ms`);
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    const liveInput = findLogoInputs(documentRef).find((candidate) => sameFile(candidate, last));
    if (liveInput) return { ...last, ok: true, steps: [...diagnostics, `input.files.length = ${liveInput.files?.length || 0}`, `File still present after ${waitMs}ms`, "Site upload reacted: file input retained"] };
    diagnostics.push(`File disappeared or input was replaced after ${waitMs}ms; re-finding live input`);
  }
  return { ...last, ok: false, steps: diagnostics, error: "input.files remained empty after 500ms; site reset or replaced the upload input" };
}

export function findBrochureInputs(documentRef: Document): HTMLInputElement[] {
  return Array.from(documentRef.querySelectorAll<HTMLInputElement>('input[type="file"]'))
    .map((input, index) => ({ input, index, text: contextText(input).toLowerCase() }))
    .filter(({ input, text }) => {
      const own = [input.id, input.name, input.getAttribute("accept")].filter(Boolean).join(" ").toLowerCase();
      const evidence = `${own} ${text}`;
      const ownPdf = /brochure|document|pdf|application\/pdf|\bcv\b|resume/.test(own);
      return !input.disabled && /brochure|document|pdf|attachment|choose\s+pdf|\bcv\b|resume/.test(evidence) && (ownPdf || !/logo|your\s+photo|profile\s+photo|avatar|headshot|portrait/.test(evidence));
    })
    .sort((a, b) => {
      const score = (text: string, input: HTMLInputElement) => {
        if (/attachment|choose\s+pdf|brochure|\bcv\b|resume/.test(text)) return 10;
        if (/pdf|document/.test(text) || /application\/pdf|\.pdf/.test(input.getAttribute("accept") || "")) return 6;
        if (/filetoupload/.test((input.id || input.name || "").toLowerCase())) return 4;
        return 1;
      };
      return score(b.text, b.input) - score(a.text, a.input) || a.index - b.index;
    })
    .map(({ input }) => input);
}

export async function attachBrochureFile(input: HTMLInputElement, bytes: ArrayBuffer, fileName: string, mimeType: string): Promise<LogoUploadDiagnostics> {
  const steps = ["Brochure asset reference found", `Brochure Blob loaded: ${(bytes.byteLength / 1024).toFixed(0)} KB ${mimeType || "application/octet-stream"}`];
  if (!bytes.byteLength) return { ok: false, steps, error: "Brochure Blob unavailable" };
  if (mimeType && mimeType !== "application/pdf") return { ok: false, steps, error: `Unsupported brochure MIME: ${mimeType}` };
  let file: File;
  try {
    file = new File([bytes], fileName || "business-brochure.pdf", { type: "application/pdf" });
  } catch (error) {
    return { ok: false, steps, error: `File creation failed: ${error instanceof Error ? error.message : "PDF File could not be created"}` };
  }
  steps.push(`PDF File created: ${file.name}`);
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    steps.push("FileList assigned");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    steps.push("Change dispatched");
  } catch (error) {
    return { ok: false, steps, error: `FileList assignment failed: ${error instanceof Error ? error.message : "Browser rejected brochure file assignment"}` };
  }
  const assigned = input.files?.[0];
  steps.push(`input.files.length = ${input.files?.length || 0}`);
  if (!assigned || input.files?.length !== 1 || assigned.name !== file.name || assigned.size !== file.size || assigned.type !== "application/pdf") return { ok: false, steps, error: "FileList assignment failed: brochure input.files verification failed" };
  return { ok: true, steps, fileName: assigned.name, fileSize: assigned.size, fileType: assigned.type };
}

export async function attachBrochureToLiveInput(documentRef: Document, bytes: ArrayBuffer, fileName: string, mimeType: string, waitMs = 500): Promise<LogoUploadDiagnostics> {
  const diagnostics: string[] = [];
  const input = findBrochureInputs(documentRef)[0];
  if (!input) return { ok: false, steps: diagnostics, error: "FileToUpload not found: no explicit PDF/document attachment input" };
  diagnostics.push(input.id === "FileToUpload" || input.name === "FileToUpload" ? "FileToUpload found" : "Brochure attachment input found");
  diagnostics.push(window.top === window ? "Frame detected: top document" : "Frame detected: embedded document");
  const result = await attachBrochureFile(input, bytes, fileName, mimeType);
  diagnostics.push(...result.steps);
  if (!result.ok) return { ...result, steps: diagnostics };
  await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  const candidates = findBrochureInputs(documentRef);
  const retained = candidates.find((candidate) => candidate.files?.length === 1 && candidate.files[0]?.name === result.fileName && candidate.files[0]?.type === "application/pdf");
  if (!candidates.some((candidate) => candidate === input)) return { ...result, ok: false, steps: diagnostics, error: "file input replaced after upload" };
  if (!retained) return { ...result, ok: false, steps: diagnostics, error: "change dispatched but site cleared file" };
  const nearbyText = [retained.closest("label")?.textContent, retained.parentElement?.textContent, retained.parentElement?.parentElement?.textContent, documentRef.body?.innerText].filter(Boolean).join(" ");
  if (/no\s+file\s+chosen/i.test(nearbyText) && !nearbyText.includes(result.fileName || "")) return { ...result, ok: false, steps: diagnostics, error: "change dispatched but site cleared file: No file chosen remains visible" };
  if (!nearbyText.includes(result.fileName || "")) return { ...result, ok: false, steps: diagnostics, error: "Brochure filename not visible after upload" };
  return { ...result, steps: [...diagnostics, `File still present after ${waitMs}ms`, `Visible brochure filename: ${result.fileName}`, "Site attachment reacted: PDF retained"] };
}

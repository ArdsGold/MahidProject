"use client";

import { useEffect, useRef, useState } from "react";
import { deriveNameParts, formatBusinessAddress, type BusinessProfile, type BusinessProfileInput, type BusinessSocialLink, type SocialPlatform } from "@backlink-autofill/shared";
import { descriptionHtmlForEditor, descriptionHtmlFromClipboard } from "@/lib/profile-editor-logic";
import { FixedMediaSection } from "./FixedMediaSection";

interface ProfileFormProps { initialValue: BusinessProfile; onSave: (input: BusinessProfileInput) => void | Promise<void>; onCancel: () => void; }
type SocialKey = Exclude<SocialPlatform, "other">;

const SOCIAL_KEYS: SocialKey[] = ["facebook", "instagram", "linkedin", "twitter", "youtube", "tiktok", "pinterest"];

function toInput(profile: BusinessProfile): BusinessProfileInput { const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = profile; return input; }
function initialSocialLinks(profile: BusinessProfile): BusinessSocialLink[] { return profile.socialLinks.length ? profile.socialLinks : SOCIAL_KEYS.flatMap((platform) => profile[platform] ? [{ url: profile[platform], platform }] : []); }

export function ProfileForm({ initialValue, onSave, onCancel }: ProfileFormProps) {
  const [draft, setDraft] = useState<BusinessProfileInput>(() => toInput(initialValue));
  const [services, setServices] = useState(initialValue.services);
  const [hoursText, setHoursText] = useState(initialValue.businessHours.join("\n"));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info" | "ok"; text: string } | null>(null);

  function updateDraft(updater: (current: BusinessProfileInput) => BusinessProfileInput) { setDraft(updater); setDirty(true); }
  function setField(name: keyof BusinessProfileInput, value: string) { updateDraft((current) => { if (name === "businessName") { const derived = deriveNameParts(value); return { ...current, businessName: value, firstName: current.firstName || derived.firstName, lastName: current.lastName || derived.lastName }; } if (name === "completeAddress") return { ...current, completeAddress: value }; if (["address", "city", "state", "postalCode", "country"].includes(name)) { const next = { ...current, [name]: value, ...(name === "country" ? { countryCode: "", stateCode: "" } : {}), ...(name === "state" ? { stateCode: "" } : {}) }; return { ...next, completeAddress: formatBusinessAddress(next.address, next.city, next.state, name === "state" ? "" : next.stateCode, next.postalCode, next.country) }; } return { ...current, [name]: value }; }); }
  function updateSocialLinks(links: BusinessSocialLink[]) { updateDraft((current) => { const next = { ...current, socialLinks: links }; for (const key of SOCIAL_KEYS) next[key] = links.find((link) => link.platform === key)?.url ?? ""; return next; }); }
  function updateServices(value: string) { setServices([...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 10)); setDirty(true); }
  async function handleSubmit(event: React.FormEvent) { event.preventDefault(); if (!draft.businessName.trim()) { setMessage({ kind: "error", text: "Add a Business Name before saving." }); document.getElementById('field-businessName')?.focus(); return; } setSaving(true); try { await onSave({ ...draft, services, businessHours: hoursText.split("\n").map((line) => line.trim()).filter(Boolean) }); setDirty(false); } finally { setSaving(false); } }

  return <form className="profile-editor" onSubmit={handleSubmit}>
    <div className="editor-heading"><div><p className="eyebrow">Business profile workspace</p><h2>{initialValue.id ? "Review and edit profile" : "New business profile"}</h2></div><span className={`save-state ${dirty ? "unsaved" : "saved"}`}>{dirty ? "Unsaved changes" : "Ready to save"}</span></div>
    {message ? <p className={`editor-message ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p> : null}
    <div className="editor-content">
      <section aria-labelledby="basic-heading"><SectionHeading id="basic-heading" title="Basic Information" description="Business identity and contact." /><div className="form-grid"><Field label="Business Name" name="businessName" value={draft.businessName} onChange={setField} autoFocus full /><Field label="Phone" name="phone" type="tel" value={draft.phone} onChange={setField} /><Field label="Category" name="category" value={draft.category} onChange={setField} /><Field label="Website" name="website" type="url" value={draft.website} onChange={setField} full /></div></section>
      <LocationSection draft={draft} setField={setField} />
      <DetailsSection draft={draft} services={services} hoursText={hoursText} setField={setField} updateServices={updateServices} setHoursText={(value) => { setHoursText(value); setDirty(true); }} />
      <SubmissionSection draft={draft} setField={setField} />
      <FixedMediaSection draft={draft} initialLinks={initialSocialLinks(initialValue)} onSocialLinks={updateSocialLinks} onImageUrl={(value) => setField("imageUrl", value)} />
    </div>
    <div className="editor-actions"><div className="editor-actions-left"><button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : "Save Profile"}</button><button type="button" onClick={onCancel} disabled={saving}>Cancel</button></div></div>
  </form>;
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) { const number = { 'basic-heading': '01', 'location-heading': '02', 'details-heading': '03', 'submission-heading': '04' }[id]; return <header className="section-heading"><h3 id={id}><span className="section-index" aria-hidden="true">{number}</span>{title}</h3><p>{description}</p></header>; }
function Field({ label, name, value, onChange, type = "text", full, autoFocus, placeholder, maxLength }: { label: string; name: keyof BusinessProfileInput; value: string; onChange: (name: keyof BusinessProfileInput, value: string) => void; type?: string; full?: boolean; autoFocus?: boolean; placeholder?: string; maxLength?: number }) { return <div className={`field${full ? " full" : ""}`}><label htmlFor={`field-${name}`}>{label}</label><input id={`field-${name}`} name={name} type={type} value={value} autoFocus={autoFocus} placeholder={placeholder} maxLength={maxLength} autoComplete="off" onChange={(event) => onChange(name, event.target.value)} /></div>; }
function LocationSection({ draft, setField }: { draft: BusinessProfileInput; setField: (name: keyof BusinessProfileInput, value: string) => void }) { return <section aria-labelledby="location-heading"><SectionHeading id="location-heading" title="Location" description="Business address and location." /><div className="form-grid"><Field label="Country" name="country" value={draft.country} onChange={setField} /><Field label="State / Province" name="state" value={draft.state} onChange={setField} /><Field label="City" name="city" value={draft.city} onChange={setField} /><Field label="Postal Code" name="postalCode" value={draft.postalCode} onChange={setField} /><Field label="Street Address" name="address" value={draft.address} onChange={setField} full /><Field label="Complete Address" name="completeAddress" value={draft.completeAddress} onChange={setField} full placeholder="5907 W 63rd St, Chicago, IL 60638, United States" /></div></section>; }
function RichDescription({ value, onChange, labelledBy }: { value: string; onChange: (html: string) => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string | null>(null);
  const lastRendered = useRef('');
  useEffect(() => {
    const element = ref.current;
    if (element && value !== lastEmitted.current) { element.innerHTML = descriptionHtmlForEditor(value); lastRendered.current = element.innerHTML; }
    lastEmitted.current = value;
  }, [value]);
  function emit() {
    const element = ref.current;
    if (!element) return;
    if (element.innerHTML === lastRendered.current) return;
    const html = element.innerHTML.trim();
    lastRendered.current = element.innerHTML;
    lastEmitted.current = html;
    onChange(html);
  }
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    const clipboardHtml = event.clipboardData.getData("text/html");
    if (!clipboardHtml.trim()) return;
    const converted = descriptionHtmlFromClipboard(clipboardHtml);
    if (!converted) return;
    event.preventDefault();
    document.execCommand("insertHTML", false, converted);
    emit();
  }
  return <div ref={ref} className="description-editor" contentEditable role="textbox" aria-multiline="true" aria-labelledby={labelledBy} suppressContentEditableWarning onInput={emit} onBlur={emit} onPaste={handlePaste} />;
}

function DetailsSection({ draft, services, hoursText, setField, updateServices, setHoursText }: { draft: BusinessProfileInput; services: string[]; hoursText: string; setField: (name: keyof BusinessProfileInput, value: string) => void; updateServices: (value: string) => void; setHoursText: (value: string) => void }) { return <section aria-labelledby="details-heading"><SectionHeading id="details-heading" title="Business Details" description="Descriptions, services and opening hours." /><div className="field full"><Field label="Short Description" name="shortDescription" value={draft.shortDescription} onChange={setField} maxLength={160} /><small className="counter">{draft.shortDescription.length} / 160 characters</small></div><div className="field full"><label id="field-description-label">Long Description</label><RichDescription value={draft.description} onChange={(html) => setField("description", html)} labelledBy="field-description-label" /><small>Paste formatted text from Google Docs; links stay linked.</small></div><div className="field full"><label htmlFor="service-input">Services</label><textarea id="service-input" rows={3} value={services.join(", ")} placeholder="Land Surveying, Boundary Survey, Construction Staking" onChange={(event) => updateServices(event.target.value)} /><small>Use one comma-separated line. Up to 10 services are retained.</small></div><div className="field full"><label htmlFor="field-hours">Business Hours</label><textarea id="field-hours" rows={6} value={hoursText} placeholder={'Monday: 8:00 AM - 5:00 PM\nTuesday: 8:00 AM - 5:00 PM…'} onChange={(event) => setHoursText(event.target.value)} /></div></section>; }
function SubmissionSection({ draft, setField }: { draft: BusinessProfileInput; setField: (name: keyof BusinessProfileInput, value: string) => void }) { const [showPassword, setShowPassword] = useState(false); return <section aria-labelledby="submission-heading"><SectionHeading id="submission-heading" title="Submission Fields" description="Identity used for listing submissions." /><div className="form-grid"><Field label="First Name" name="firstName" value={draft.firstName} onChange={setField} /><Field label="Last Name" name="lastName" value={draft.lastName} onChange={setField} /><Field label="Contact Name" name="contactName" value={draft.contactName} onChange={setField} /><Field label="Username" name="username" value={draft.username} onChange={setField} /><Field label="Submission Email" name="email" type="email" value={draft.email} onChange={setField} /><div className="field"><label htmlFor="field-password">Password</label><div className="password-control"><input id="field-password" name="password" type={showPassword ? "text" : "password"} value={draft.password} autoComplete="new-password" onChange={(event) => setField("password", event.target.value)} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Hide" : "Show"}</button></div></div></div><p className="field-note">Username, Submission Email, and Password are manual profile data. Passwords are hidden by default and never generated.</p></section>; }

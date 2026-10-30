"use client";

import { useState } from "react";
import type { BusinessProfileInput, BusinessSocialLink, SocialPlatform } from "@backlink-autofill/shared";
import { addSocialLink, detectSocialPlatform } from "@/lib/profile-editor-logic";

const SOCIAL_LABELS: Record<SocialPlatform, string> = { facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", twitter: "X / Twitter", youtube: "YouTube", tiktok: "TikTok", pinterest: "Pinterest", other: "Other / Unknown" };

interface FixedMediaSectionProps { draft: BusinessProfileInput; initialLinks: BusinessSocialLink[]; onSocialLinks: (links: BusinessSocialLink[]) => void; onImageUrl: (value: string) => void; }

export function FixedMediaSection({ draft, initialLinks, onSocialLinks, onImageUrl }: FixedMediaSectionProps) {
  const [savedLinks, setSavedLinks] = useState(initialLinks);
  const [currentUrl, setCurrentUrl] = useState("");
  const detected = detectSocialPlatform(currentUrl.trim());
  const duplicate = savedLinks.some((link) => link.url.trim() === currentUrl.trim());
  function addCurrentLink() { if (!currentUrl.trim() || !detected || duplicate) return; const next = addSocialLink(savedLinks, { url: currentUrl.trim(), platform: detected }); setSavedLinks(next); onSocialLinks(next); setCurrentUrl(""); }
  function removeLink(index: number) { const next = savedLinks.filter((_, linkIndex) => linkIndex !== index); setSavedLinks(next); onSocialLinks(next); }
  return <section aria-labelledby="media-heading"><header className="section-heading"><h3 id="media-heading"><span className="section-index" aria-hidden="true">05</span>Media &amp; Social</h3><p>Image and social profile links.</p></header><div className="field full image-url-field"><label htmlFor="image-url">Image URL</label><input id="image-url" name="imageUrl" type="url" value={draft.imageUrl} placeholder="https://example.com/image.jpg" onChange={(event) => onImageUrl(event.target.value)} /></div><div className="social-links-panel"><div className="social-links-heading"><h4>Social Links</h4><span>{savedLinks.length ? `${savedLinks.length} saved` : "Optional"}</span></div><div className="social-saved-list">{savedLinks.map((link, index) => <div className="social-saved-row" key={`${link.url}-${index}`}><div className="field"><label htmlFor={`saved-social-url-${index}`}>Profile URL</label><input id={`saved-social-url-${index}`} type="url" value={link.url} readOnly /><small>{SOCIAL_LABELS[link.platform]}</small></div><button type="button" className="text-button" onClick={() => removeLink(index)}>Remove</button></div>)}</div><div className="social-entry-row" style={{ display: "flex", alignItems: "end", gap: "8px" }}><div className="field" style={{ flex: 1 }}><label htmlFor="social-url-entry">Profile URL</label><input id="social-url-entry" type="url" value={currentUrl} placeholder="https://facebook.com/your-business" autoComplete="off" onChange={(event) => setCurrentUrl(event.target.value)} />{currentUrl.trim() ? <small>{detected ? SOCIAL_LABELS[detected] : "Enter a valid URL"}</small> : null}</div><button type="button" className="small social-add-button" aria-label="Add social link" disabled={!currentUrl.trim() || !detected || duplicate} onClick={addCurrentLink}>+</button></div></div></section>;
}

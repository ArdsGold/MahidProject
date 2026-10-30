"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusinessProfile, BusinessProfileInput } from "@backlink-autofill/shared";
import { createEmptyProfileInput } from "@backlink-autofill/shared";
import { getProfileRepository } from "@/lib/profile-repository";
import { createIndexedDbProfileAssetStore, DRAFT_PROFILE_ID } from "@/lib/profile-asset-store";
import { ProfileForm } from "./ProfileForm";

type EditorState = { mode: "idle" } | { mode: "create" } | { mode: "edit"; profile: BusinessProfile };

export function Dashboard() {
  const repository = useMemo(() => getProfileRepository(), []);
  const assetStore = useMemo(() => createIndexedDbProfileAssetStore(), []);
  const [profiles, setProfiles] = useState<BusinessProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ mode: "idle" });
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "info"; text: string } | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [all, active] = await Promise.all([repository.list(), repository.getActive()]);
    setProfiles(all); setActiveId(active?.id ?? null); setLoaded(true);
  }, [repository]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function handleSave(input: BusinessProfileInput) {
    try {
      if (editor.mode === "edit") {
        const saved = await repository.update(editor.profile.id, input);
        if (input.logoAsset) await assetStore.claimAssetOwner(saved.id, "logo", input.logoAsset.id, [DRAFT_PROFILE_ID, ""]);
        setStatus({ kind: "ok", text: `Saved “${input.businessName || "Untitled"}”.` });
      } else {
        const saved = await repository.create(input);
        if (input.logoAsset) await assetStore.claimAssetOwner(saved.id, "logo", input.logoAsset.id, [DRAFT_PROFILE_ID, ""]);
        setStatus({ kind: "ok", text: `Saved “${input.businessName || "Untitled"}”.` });
      }
      setEditor({ mode: "idle" }); await refresh();
    } catch (error) { setStatus({ kind: "error", text: error instanceof Error ? error.message : "Failed to save profile." }); }
  }
  async function handleDelete(profile: BusinessProfile) {
    if (!window.confirm(`Delete “${profile.businessName || "Untitled"}”?`)) return;
    await repository.delete(profile.id); if (editor.mode === "edit" && editor.profile.id === profile.id) setEditor({ mode: "idle" });
    setStatus({ kind: "info", text: "Profile deleted." }); await refresh();
  }
  async function handleSetActive(profile: BusinessProfile) { await repository.setActive(profile.id); setStatus({ kind: "ok", text: `“${profile.businessName || "Untitled"}” is now active for autofill.` }); await refresh(); }
  function startNew() { setStatus(null); setEditor({ mode: "create" }); }
  const initialValue = editor.mode === "edit" ? editor.profile : { ...createEmptyProfileInput(), id: "", createdAt: "", updatedAt: "" };

  return <div className="workspace-layout">
    <section className="workspace-main">
      {editor.mode === "idle" ? <div className="empty-workspace"><p className="eyebrow">Business profile workspace</p><h2>Create a profile.</h2><p>Store the business identity, location, details, submission fields, media, and social links used by the extension. Nothing is saved until you press SAVE.</p><button type="button" className="primary" onClick={startNew}>New Profile</button>{status ? <p className={`status ${status.kind}`} role="status">{status.text}</p> : null}</div> : <ProfileForm key={editor.mode === "edit" ? editor.profile.id : "new"} initialValue={initialValue} onSave={handleSave} onCancel={() => setEditor({ mode: "idle" })} />}
    </section>
    <SavedProfilesRail profiles={profiles} activeId={activeId} loaded={loaded} onNew={startNew} onEdit={(profile) => { setStatus(null); setEditor({ mode: "edit", profile }); }} onSetActive={(profile) => void handleSetActive(profile)} onDelete={(profile) => void handleDelete(profile)} />
  </div>;
}

function SavedProfilesRail({ profiles, activeId, loaded, onNew, onEdit, onSetActive, onDelete }: { profiles: BusinessProfile[]; activeId: string | null; loaded: boolean; onNew: () => void; onEdit: (profile: BusinessProfile) => void; onSetActive: (profile: BusinessProfile) => void; onDelete: (profile: BusinessProfile) => void }) {
  return <aside className="saved-rail" aria-label="Saved Business Profiles"><div className="saved-rail-heading"><div><p className="eyebrow">Library</p><h2>Saved Profiles</h2></div><button type="button" className="small primary" onClick={onNew}>+ New</button></div><label className="mobile-profile-select">Select profile<select value="" onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); if (profile) onEdit(profile); }}><option value="">Choose a saved profile…</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.businessName || "Untitled"}{profile.id === activeId ? " · Active" : ""}</option>)}</select></label>{loaded && profiles.length === 0 ? <p className="empty">No saved profiles yet.</p> : <ul className="saved-list">{profiles.map((profile) => <li className={profile.id === activeId ? "saved-item active" : "saved-item"} key={profile.id}><button type="button" className="saved-item-main" onClick={() => onEdit(profile)}><span className="saved-name">{profile.businessName || "Untitled"}</span><span className="saved-sub">{profile.city || profile.email || "No contact details"}</span></button><div className="saved-item-actions">{profile.id === activeId ? <span className="active-mark">Active</span> : <button type="button" className="text-button" onClick={() => onSetActive(profile)}>Set active</button>}<button type="button" className="text-button" onClick={() => onDelete(profile)}>Delete</button></div></li>)}</ul>}</aside>;
}

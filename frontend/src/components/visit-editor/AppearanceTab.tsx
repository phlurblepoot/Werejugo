import type { CustomIcon, Theme } from "../../api/client";
import { StylePicker } from "../StylePicker";
import { PinStyleControls } from "../PinStyleControls";
import { PathStyleControls } from "../PathStyleControls";
import { POINT_KINDS, type VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
  applyTheme: (id: string | null, themes: { id: string; color: string; icon: string }[]) => void;
  themes: Theme[];
  customIcons: CustomIcon[];
  onIconsChanged?: () => void;
}

export function AppearanceTab({ draft, set, applyTheme, themes, customIcons, onIconsChanged }: Props) {
  const isPoint = POINT_KINDS.includes(draft.kind);
  return (
    <>
      <div className="field">
        <label>Theme</label>
        <select value={draft.themeId ?? ""} onChange={(e) => applyTheme(e.target.value || null, themes)}>
          <option value="">— None (custom style) —</option>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name} {t.isBuiltin ? "" : "(yours)"}</option>)}
        </select>
      </div>

      <StylePicker color={draft.color} icon={draft.icon} customIcons={customIcons} onColor={(color) => set({ color })} onIcon={(icon) => set({ icon })} onUploaded={onIconsChanged} />
      <PinStyleControls value={draft.pin} color={draft.color} icon={draft.icon} onChange={(pin) => set({ pin })} />
      {!isPoint && (
        <>
          <div className="section-title"><span>Trail (path line)</span></div>
          <PathStyleControls value={draft.path} customIcons={customIcons} onChange={(path) => set({ path })} />
        </>
      )}
    </>
  );
}

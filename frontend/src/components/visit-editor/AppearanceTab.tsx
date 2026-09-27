import type { CustomIcon, Theme } from "../../api/client";
import { StylePicker } from "../StylePicker";
import { PinStyleControls } from "../PinStyleControls";
import { PathStyleControls } from "../PathStyleControls";
import type { ItemStyle } from "../MapView";
import { POINT_KINDS, type VisitDraft } from "./useVisitDraft";

interface Props {
  draft: VisitDraft;
  set: (patch: Partial<VisitDraft>) => void;
  applyTheme: (id: string | null) => void;
  /** What this item gets when it doesn't choose (the family's defaults, its theme, its cruise line). */
  inherited: ItemStyle;
  themes: Theme[];
  customIcons: CustomIcon[];
  onIconsChanged?: () => void;
}

/** A line under a group: whether it follows the defaults, and a way back to them. */
function Defaults({ own, onReset }: { own: boolean; onReset: () => void }) {
  return own ? (
    <div className="sub style-own">
      Chosen for this item. <button type="button" className="btn-link" onClick={onReset}>Use default</button>
    </div>
  ) : (
    <div className="sub style-inherited">Following the defaults (Map appearance).</div>
  );
}

export function AppearanceTab({ draft, set, applyTheme, inherited, themes, customIcons, onIconsChanged }: Props) {
  const isPoint = POINT_KINDS.includes(draft.kind);
  const pinDefault = { size: inherited.size, shape: inherited.shape, borderWidth: inherited.borderWidth, borderColor: inherited.borderColor };
  const pathDefault = { style: inherited.pathStyle, color: inherited.lineColor, width: inherited.lineWidth, imageUrl: inherited.pathImageUrl };
  const ownLook = draft.color.toLowerCase() !== inherited.color.toLowerCase() || draft.icon !== inherited.icon;
  const ownPin = (Object.keys(pinDefault) as Array<keyof typeof pinDefault>).some((k) => draft.pin[k] !== pinDefault[k]);
  const ownPath = (Object.keys(pathDefault) as Array<keyof typeof pathDefault>).some((k) => draft.path[k] !== undefined && draft.path[k] !== pathDefault[k]);
  return (
    <>
      <div className="field">
        <label>Theme</label>
        <select value={draft.themeId ?? ""} onChange={(e) => applyTheme(e.target.value || null)}>
          <option value="">— None —</option>
          {themes.map((t) => <option key={t.id} value={t.id}>{t.name} {t.isBuiltin ? "" : "(yours)"}</option>)}
        </select>
      </div>

      <StylePicker color={draft.color} icon={draft.icon} customIcons={customIcons} onColor={(color) => set({ color })} onIcon={(icon) => set({ icon })} onUploaded={onIconsChanged} />
      <Defaults own={ownLook} onReset={() => set({ color: inherited.color, icon: inherited.icon })} />
      <PinStyleControls value={draft.pin} color={draft.color} icon={draft.icon} onChange={(pin) => set({ pin })} />
      <Defaults own={ownPin} onReset={() => set({ pin: pinDefault })} />
      {!isPoint && (
        <>
          <div className="section-title"><span>Trail (path line)</span></div>
          <PathStyleControls value={draft.path} customIcons={customIcons} onChange={(path) => set({ path })} />
          <Defaults own={ownPath} onReset={() => set({ path: pathDefault })} />
        </>
      )}
    </>
  );
}

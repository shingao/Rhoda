import { Folder } from "lucide-react";
import { useT } from "../../app/i18n";
import { updateSettings, useApp } from "../../app/store";
import { changeVaultFolder } from "../../app/vault";
import { Button } from "../../components/Button";
import { Segmented } from "../../components/Segmented";
import { Toggle } from "../../components/Toggle";
import { DARK_PALETTES, LIGHT_PALETTES, type Appearance, type Palette, type ThemeMode } from "../../services/settings";
import { Field } from "./fields";
import s from "./Settings.module.css";

const setAppearance = (patch: Partial<Appearance>) => updateSettings((st) => ({ ...st, appearance: { ...st.appearance, ...patch } }));

export function GeneralPage() {
  const t = useT();
  const vault = useApp((st) => st.vault);
  const count = useApp((st) => Object.keys(st.notes).length);
  const appearance = useApp((st) => st.settings.appearance);
  const linkPreviews = useApp((st) => st.settings.editor.linkPreviews);
  const modes: ThemeMode[] = ["light", "dark", "system"];

  return (
    <>
      <Field label={t.settings.folder} hint={t.settings.folderHint(count)}>
        <div className={s.folderRow}>
          <div className={s.path} title={vault.kind === "ready" ? vault.path : undefined}>
            <Folder className={s.pathIcon} aria-hidden />
            <span className={s.pathText}>{vault.kind === "ready" ? vault.path : "…"}</span>
          </div>
          <Button onClick={() => void changeVaultFolder()}>{t.settings.change}</Button>
        </div>
      </Field>

      <Field label={t.settings.mode} hint={appearance.mode === "system" ? t.settings.systemHint : undefined}>
        <div>
          <Segmented
            label={t.settings.mode}
            value={appearance.mode}
            options={modes.map((m) => ({ value: m, label: t.settings.modes[m] }))}
            onChange={(mode) => setAppearance({ mode })}
          />
        </div>
      </Field>

      <Field label={t.settings.lightPalette}>
        <PaletteGrid palettes={LIGHT_PALETTES} value={appearance.light} onChange={(light) => setAppearance({ light })} label={t.settings.lightPalette} />
      </Field>

      <Field label={t.settings.darkPalette}>
        <PaletteGrid palettes={DARK_PALETTES} value={appearance.dark} onChange={(dark) => setAppearance({ dark })} label={t.settings.darkPalette} />
      </Field>

      <Toggle
        checked={linkPreviews}
        onChange={(on) => updateSettings((st) => ({ ...st, editor: { ...st.editor, linkPreviews: on } }))}
        label={t.settings.linkPreviews}
        hint={t.settings.linkPreviewsHint}
      />
    </>
  );
}

/** Palette cards [§2.17]: a miniature of the app drawn with the palette's own tokens. */
function PaletteGrid<P extends Palette>({ palettes, value, onChange, label }: { palettes: readonly P[]; value: P; onChange: (p: P) => void; label: string }) {
  const t = useT();
  return (
    <div className={s.palettes} role="radiogroup" aria-label={label}>
      {palettes.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={p === value} className={s.palette} onClick={() => onChange(p)}>
          <span className={s.preview} data-theme={p} aria-hidden>
            <span className={s.previewSide}>
              <i className={s.dashAccent} />
              <i className={s.dashFaint} />
            </span>
            <span className={s.previewList} />
            <span className={s.previewPage}>
              <i className={s.dashText} />
              <i className={s.dashAccent} />
            </span>
          </span>
          <span className={s.paletteName}>{t.settings.palettes[p]}</span>
        </button>
      ))}
    </div>
  );
}

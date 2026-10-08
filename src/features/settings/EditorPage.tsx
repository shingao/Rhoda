import { useT } from "../../app/i18n";
import { shortcutLabel } from "../../app/shortcuts";
import { updateSettings, useApp } from "../../app/store";
import { Select } from "../../components/Select";
import { Slider } from "../../components/Slider";
import { Stepper } from "../../components/Stepper";
import { Toggle } from "../../components/Toggle";
import { ColumnChoice, PaperChoices } from "../editor/PaperPicker";
import { COLUMN_WIDTH, FONT_SIZE, type EditorSettings, type Settings } from "../../services/settings";
import { Field } from "./fields";
import s from "./Settings.module.css";

const setEditor = (patch: Partial<EditorSettings>) => updateSettings((st) => ({ ...st, editor: { ...st.editor, ...patch } }));
const setStickers = (patch: Partial<Settings["stickers"]>) => updateSettings((st) => ({ ...st, stickers: { ...st.stickers, ...patch } }));

export function EditorPage() {
  const t = useT();
  const e = useApp((st) => st.settings.editor);
  const st = useApp((state) => state.settings.stickers);
  const fonts = ["sans", "serif"] as const;

  return (
    <>
      <div className={s.pair}>
        <Field label={t.settings.font}>
          <Select label={t.settings.font} value={e.font} options={fonts.map((f) => ({ value: f, label: t.settings.fonts[f] }))} onChange={(font) => setEditor({ font })} />
        </Field>
        <Field label={t.settings.fontSize}>
          <Stepper
            label={t.settings.fontSize}
            decreaseLabel={t.settings.smaller}
            increaseLabel={t.settings.larger}
            value={e.fontSize}
            min={FONT_SIZE.min}
            max={FONT_SIZE.max}
            step={FONT_SIZE.step}
            format={t.settings.px}
            onChange={(fontSize) => setEditor({ fontSize })}
          />
        </Field>
      </div>

      <Field label={t.settings.column} value={t.settings.px(e.columnWidth)}>
        <Slider
          label={t.settings.column}
          valueText={t.settings.px(e.columnWidth)}
          value={e.columnWidth}
          min={COLUMN_WIDTH.min}
          max={COLUMN_WIDTH.max}
          step={COLUMN_WIDTH.step}
          onChange={(columnWidth) => setEditor({ columnWidth })}
        />
        <div className={s.scale}>
          <span>{t.settings.narrow(COLUMN_WIDTH.min)}</span>
          <span>{t.settings.wide(COLUMN_WIDTH.max)}</span>
        </div>
      </Field>

      <Toggle checked={e.headingMarkers} onChange={(headingMarkers) => setEditor({ headingMarkers })} label={t.settings.headingMarkers} hint={t.settings.headingMarkersHint} />

      <Toggle checked={e.focusDim} onChange={(focusDim) => setEditor({ focusDim })} label={t.settings.focusDim} hint={t.settings.focusDimHint(shortcutLabel("focus.toggle", t))} />

      <Toggle checked={st.show} onChange={(show) => setStickers({ show })} label={t.settings.decorations} hint={t.settings.decorationsHint(shortcutLabel("stickers.hide", t))} />
      <Toggle checked={st.hideInFocus} onChange={(hideInFocus) => setStickers({ hideInFocus })} label={t.settings.decorationsInFocus} />

      <Field label={t.settings.paper} hint={t.settings.paperHint}>
        <div className={s.paperRow}>
          <PaperChoices label={t.settings.paper} value={e.paper} margin={e.margin} onChange={(paper) => setEditor({ paper })} />
        </div>
        <Toggle checked={e.margin} onChange={(margin) => setEditor({ margin })} label={t.paper.margin} />
      </Field>

      <Field label={t.settings.columnPosition} hint={t.settings.columnPositionHint}>
        <ColumnChoice value={e.columnPosition} onChange={(columnPosition) => setEditor({ columnPosition })} />
      </Field>
    </>
  );
}

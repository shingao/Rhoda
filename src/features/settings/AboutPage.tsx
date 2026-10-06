import { useT } from "../../app/i18n";
import apache from "../../assets/licenses/pdfjs-Apache-2.0.txt?raw";
import isc from "../../assets/licenses/lucide-ISC.txt?raw";
import mit from "../../assets/licenses/fluent-emoji-MIT.txt?raw";
import ofl from "../../assets/licenses/OFL-1.1.txt?raw";
import { version } from "../../../package.json";
import s from "./Settings.module.css";

type Licence = "mit" | "ofl" | "isc" | "apache" | "mitApache";
const TEXTS: Partial<Record<Licence, string>> = { mit, ofl, isc, apache };

/** What Ursa ships that others made; `use` keys are in i18n (settings.credits). */
const CREDITS: ReadonlyArray<{ name: string; author: string; licence: Licence; use: "stickers" | "hand" | "ui" | "mono" | "icons" | "pdf" | "editor" | "app" | "shell" | "store" | "yaml" }> = [
  { name: "Fluent Emoji 3D", author: "Microsoft", licence: "mit", use: "stickers" },
  { name: "Caveat", author: "The Caveat Project Authors", licence: "ofl", use: "hand" },
  { name: "Hanken Grotesk", author: "The Hanken Grotesk Project Authors", licence: "ofl", use: "ui" },
  { name: "JetBrains Mono", author: "The JetBrains Mono Project Authors", licence: "ofl", use: "mono" },
  { name: "Lucide", author: "Lucide Icons and Contributors", licence: "isc", use: "icons" },
  { name: "PDF.js", author: "Mozilla Foundation", licence: "apache", use: "pdf" },
  { name: "CodeMirror", author: "Marijn Haverbeke and others", licence: "mit", use: "editor" },
  { name: "React", author: "Meta Platforms", licence: "mit", use: "app" },
  { name: "Tauri", author: "The Tauri Programme", licence: "mitApache", use: "shell" },
  { name: "Zustand", author: "Poimandres", licence: "mit", use: "store" },
  { name: "yaml", author: "Eemeli Aro", licence: "isc", use: "yaml" },
];

/** Settings › About: version, privacy, third-party licences (full texts of those shipped as files). */
export function AboutPage() {
  const t = useT();
  return (
    <div className={s.about}>
      <p className={s.aboutName}>
        Ursa <span className={s.aboutVersion}>{t.settings.version(version)}</span>
      </p>
      <p className={s.aboutText}>{t.settings.aboutText}</p>
      <h3 className={s.aboutHeading}>{t.settings.thirdParty}</h3>
      <ul className={s.credits}>
        {CREDITS.map((c) => (
          <li key={c.name} className={s.credit}>
            <div className={s.creditHead}>
              <span className={s.creditName}>{c.name}</span>
              <span className={s.creditLicence}>{t.settings.licences[c.licence]}</span>
            </div>
            <div className={s.creditMeta}>
              {c.author} · {t.settings.credits[c.use]}
            </div>
          </li>
        ))}
      </ul>
      <h3 className={s.aboutHeading}>{t.settings.licenceTexts}</h3>
      {(["mit", "ofl", "isc", "apache"] as const).map((l) => (
        <details key={l} className={s.licence}>
          <summary>{t.settings.licenceTitles[l]}</summary>
          <pre>{TEXTS[l]}</pre>
        </details>
      ))}
    </div>
  );
}

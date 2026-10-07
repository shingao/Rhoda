/**
 * Development only: a deterministic vault of French notes for performance
 * tests (search benchmark, `localStorage.setItem("ursa-dev-notes", "1000")`).
 * With `images`, one note in ten shows a picture of its own (`assets/scan-<n>.png`),
 * which the OCR queue has to read.
 */

const WORDS = (
  "voyage été hiver projet réunion budget œuvre lecture cuisine jardin musée temple quartier marché train billet hôtel ryokan " +
  "réserver préparer écrire relire envoyer appeler acheter vérifier planifier comparer chercher trouver décider " +
  "rapide lent calme ancien nouveau précis léger épais frais doux élégant étrange " +
  "matin soir semaine mois année journée après-midi lendemain " +
  "kyoto nara osaka lisbonne porto lyon nîmes québec montréal " +
  "idée note liste tâche question réponse résumé chapitre carnet adresse recette pain levain farine café thé"
).split(" ");
const TAGS = ["voyages/japon-2026", "voyages/portugal", "travail/réunions", "travail/clients", "cuisine", "lecture", "journal", "idées", "été"];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export interface GeneratedNote {
  path: string;
  content: string;
  mtime: number;
  /** Picture referenced by the note (vault path), if any. */
  image?: string;
}

export function generateNotes(count: number, now = Date.now(), seed = 42, images = false): GeneratedNote[] {
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)]!;
  const sentence = () => {
    const words = Array.from({ length: 6 + Math.floor(r() * 14) }, () => pick(WORDS));
    const s = words.join(" ");
    return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
  };
  const notes: GeneratedNote[] = [];
  for (let i = 0; i < count; i++) {
    const title = `${sentence().slice(0, 30 + Math.floor(r() * 20)).replace(/[.\s]+$/, "")} ${i}`;
    const lines = [`# ${title}`, `#${pick(TAGS)}${r() < 0.5 ? ` #${pick(TAGS)}` : ""}`, ""];
    const image = images && i % 10 === 0 ? `assets/scan-${i}.png` : undefined;
    if (image) lines.push(`![Scan ${i}](${image})`, "");
    // Mostly short notes, some long ones (like a real vault).
    const paragraphs = r() < 0.05 ? 60 : 2 + Math.floor(r() * 8);
    for (let p = 0; p < paragraphs; p++) {
      if (r() < 0.25) {
        for (let t = 0; t < 3; t++) lines.push(`- [${r() < 0.5 ? "x" : " "}] ${sentence()}`);
      } else if (r() < 0.1) {
        lines.push("## " + sentence().slice(0, 30));
      } else {
        lines.push(Array.from({ length: 2 + Math.floor(r() * 4) }, sentence).join(" "));
      }
      lines.push("");
    }
    notes.push({
      path: `Gen ${String(i).padStart(4, "0")}.md`,
      content: `---\nid: gen-${i}\n---\n${lines.join("\n")}`,
      mtime: now - Math.floor(r() * 400) * 86_400_000,
      image,
    });
  }
  return notes;
}

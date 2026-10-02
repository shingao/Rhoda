# Ursa — PROGRESS

État : **Phase 0 terminée** — en attente du « go » pour la phase 1.

| Phase | Sujet | État |
|---|---|---|
| 0 | Cadrage | ✅ fait |
| 1 | Squelette et fichiers | ⏳ en attente du go |
| 2 | Éditeur Markdown live | — |
| 3 | Tags, liens, todos, sections | — |
| 4 | Sommaire, folding, focus de section | — |
| 5 | Recherche | — |
| 6 | Thèmes, fonds de page, rythme, réglages | — |
| 7 | Images, aperçus de liens, PDF | — |
| 8 | Stickers et post-it | — |
| 9 | OCR local | — |
| 10 | Export, raccourcis, palette, packaging | — |

---

## Phase 0 — Cadrage

### Fait
- Lecture de `DESIGN.md` et des tokens (`design/ursa-tokens.css`, identiques au bloc CSS de DESIGN.md — vérifié par diff).
- `DESIGN.md` placé à la racine, tokens source dans `design/`.
- `CLAUDE.md` (conventions, structure, commandes, règles) et ce fichier.
- Propositions ci-dessous : arborescence, modèle de données, stratégie éditeur, risques.

### Reste à faire / bloquant
- **Maquettes absentes** : le dépôt ne contient aucun dossier `/design` avec des PNG. DESIGN.md cite des fichiers `Ursa Main.dc.html`, `Ursa Themes.dc.html`, `Ursa Screens.dc.html`, `Ursa Paper and Stickers.dc.html` qui ne sont pas fournis non plus. → À déposer dans `design/` avant la phase 1 (sinon je travaille d'après DESIGN.md seul et je le signale).

---

## Proposition d'architecture

### Arborescence

```
Rhoda/
├─ DESIGN.md  CLAUDE.md  PROGRESS.md
├─ design/                     maquettes PNG + ursa-tokens.css (source)
├─ src-tauri/
│  ├─ tauri.conf.json          decorations:false, shadow:true, CSP stricte
│  └─ src/
│     ├─ main.rs / lib.rs
│     ├─ vault.rs              scan, lecture, écriture atomique, renommage, corbeille OS
│     ├─ watcher.rs            notify (debounced) → événements "vault://changed"
│     ├─ preview.rs            (ph. 7) fetch OpenGraph
│     └─ ocr/                  (ph. 9) windows.rs (#[cfg(windows)]), fallback
├─ src/
│  ├─ main.tsx  App.tsx
│  ├─ styles/                  tokens.css, tokens.components.css, fonts.css, global.css
│  ├─ app/                     store (zustand), raccourcis, layout persistant
│  ├─ services/                tauri.ts, vault.ts, watcher.ts, settings.ts  ← seul accès à invoke()
│  ├─ core/                    pur TS, testé avec vitest
│  │  ├─ note/                 frontmatter.ts, title.ts, filename.ts, preview.ts
│  │  ├─ markdown/             extensions Lezer partagées (tags, wiki-links, ==, {width=})
│  │  ├─ index/                NoteIndex (méta, tags, backlinks)
│  │  ├─ search/               (ph. 5)
│  │  └─ dates.ts              dates relatives (2.4)
│  ├─ editor/                  extensions CodeMirror : theme, livePreview, widgets, checkbox, typewriter…
│  ├─ components/              Button, IconButton, Toggle, Segmented, Menu, Modal, Tooltip, Resizer, ScrollArea
│  └─ features/                titlebar/, sidebar/, notelist/, editor/, tags/, outline/, search/, settings/…
└─ package.json  vite.config.ts  eslint.config.js  .stylelintrc.json  tsconfig.json
```

Répartition : **Rust = I/O** (FS, watcher, corbeille, réseau, OCR, fenêtre). **TS = logique** (parsing, index, recherche, rendu). Avantage clé : un seul parseur Markdown (Lezer) sert à la fois l'éditeur et l'indexation, donc tags/liens/todos sont reconnus exactement de la même façon partout.

Dépendances prévues (front) : `@codemirror/*`, `@lezer/markdown`, `react`, `zustand`, `lucide-react`, `yaml`, `@tanstack/react-virtual` (liste 1000+), `@fontsource/*`. Plugins Tauri : `dialog` (choix du dossier), `opener` (URL/fichiers), `window-state`. Crates : `notify-debouncer-full`, `trash`, `serde`.

### Modèle de données

**Une note = un fichier `.md`** dans le dossier du coffre (sous-dossiers acceptés à la lecture ; l'app crée à la racine).

```markdown
---
id: 0192f3a8-6c1e-7b3a-9d2e-5f8a908ec703
created: 2026-10-02T11:24:00+02:00
pinned: true
paper: lined
margin: true
---
# Voyage au Japon

Idées en vrac #voyages/japon-2026
- [ ] Réserver le ryokan
```

- Frontmatter **minimal** : seules les clés non-défaut sont écrites (`pinned`, `archived`, `trashed`, `paper`, `margin`, puis `stickers` en ph. 8). `id` (UUID v7, triable) et `created` sont toujours présents dans les notes créées par l'app.
- Une note externe sans frontmatter est lue telle quelle (identité = chemin) ; l'`id` n'est ajouté qu'à la première écriture par l'app.
- Clés inconnues **préservées** ; si aucune clé gérée ne change, le bloc frontmatter est réécrit à l'octet près.
- **Modifié** = mtime du fichier (pas de clé `updated`, évite le bruit à chaque frappe).
- **Titre** = 1re ligne non vide du corps, sans `#`. **Nom de fichier** = titre assaini pour Windows (`<>:"/\|?*`, noms réservés `CON`…, points/espaces finaux, ≤ 120 caractères), collision → ` (2)`. Renommage lors de la sauvegarde, au plus une fois toutes les ~2 s et au changement de note.
- **Tags, liens, todos** : extraits du corps (style Bear), jamais stockés en frontmatter.
- **Corbeille** : `trashed: <date>` dans le frontmatter (le fichier reste en place → liens et restauration triviaux). « Vider la corbeille » envoie les fichiers à la corbeille Windows (crate `trash`), jamais de suppression définitive directe.
- Écriture **atomique** (fichier temporaire + rename) avec retry (verrous antivirus/indexeur Windows).

**Index (mémoire, TS)**, reconstruit au démarrage : `NoteMeta { id, path, title, preview, created, modified, pinned, archived, trashedAt, tags[], wikiLinks[], todos{done,total}, firstImage, paper, margin }` + contenu brut pour la recherche, et tables dérivées `tag → notes`, `titre → note`, `backlinks`. Le watcher met l'index à jour incrémentalement.

**`.ursa/`** (dans le coffre, données propres au coffre) :

| Fichier | Phase | Contenu |
|---|---|---|
| `version` | 1 | version de schéma |
| `tags.json` | 3 | `{ "voyages/japon": { icon, color, pinned, order } }` |
| `folds.json` | 4 | par `id` de note : titres repliés (clé = texte du titre + rang d'occurrence, robuste aux éditions) |
| `cache/index.json` | 10 si besoin | méta parsées indexées par `chemin + mtime + taille`, seulement si le démarrage à 1000+ notes dépasse ~500 ms |
| `previews/` | 7 | `<sha1(url)>.json` + images |
| `thumbs/` | 7 | miniatures PDF |
| `ocr/` | 9 | `<sha256(fichier)>.json` |

**Réglages de l'app** (hors coffre, dossier de config Tauri) : chemin du coffre, palette, mode, police, taille, largeur de colonne, fond par défaut, aperçus on/off, largeurs/repli des colonnes, tri.

**Pièces jointes** : `<coffre>/assets/` (images, PDF) ; stickers importés dans `assets/stickers/`.

### Stratégie éditeur (CodeMirror 6)

- Base : `@codemirror/lang-markdown` (Lezer, GFM : barré, task lists) + **extensions Lezer maison** dans `core/markdown/` : `==surlignage==`, `[[wiki-link]]`, `#tag`, `#tag/sous`, `#tag multi mots#`, attributs `{width=400}`. Code des blocs : `@codemirror/language-data` (chargement paresseux des langages) + `HighlightStyle` mappé sur les tokens (2.8).
- **Live preview** (`ViewPlugin`, limité à `visibleRanges`, recalculé sur `docChanged | viewportChanged | selectionSet`) : parcours de l'arbre syntaxique ; pour chaque nœud inline, si la sélection touche sa portée → `Decoration.mark({class:"cm-syntax"})` sur les marqueurs (opacité `--syntax-opacity`), sinon `Decoration.replace` ; marques de style (gras, italique, code, surlignage, liens, tags) toujours appliquées. `atomicRanges` pour que le curseur saute proprement les marqueurs cachés.
- **Décorations de ligne** : titres (`cm-h1…h6` + `data-h="H2"` affiché en marge par `::before` en position absolue, donc jamais décalé par l'apparition du `#`), citations, lignes de liste (retrait suspendu 24 px), lignes de code.
- **Widgets** : checkbox (`WidgetType`, clic → transaction `[ ]`↔`[x]`), séparateur. Les widgets **bloc** (code block hors édition, plus tard images, cartes de lien/PDF) viennent d'un `StateField` — CM6 exige qu'un remplacement multi-lignes ne vienne pas d'un `ViewPlugin`.
- **Rythme** : `line-height` fixe `--rhythm` sur `.cm-line`, H1 = 2 unités, blocs arrondis au multiple de 28 par padding compensatoire calculé (la hauteur des lignes est déterministe), valeurs lues dans les variables CSS.
- **Colonne** : `.cm-content` centré, `max-width: var(--editor-max)`, gouttière ≥ `--editor-pad-x` (marqueurs H, chevrons de folding).
- **Machine à écrire** : extension qui recentre la tête de sélection (`scrollIntoView(..., {y:"center"})`) + padding vertical de 50 %.
- Plus tard : `foldService` par titres + widget de résumé (ph. 4), autocomplétion `#` et `[[` (ph. 3), `search` CM6 restylé (ph. 5).

### Risques techniques identifiés

1. **Pas de Windows ici** : je développe dans un conteneur Linux. Je peux y valider typecheck, lint, tests, build Vite et `cargo clippy` (après installation de webkit2gtk), mais **pas lancer `npm run tauri dev` ni voir le rendu WebView2**. Chaque phase doit être validée sur ta machine ; le code Windows-only est derrière `#[cfg(windows)]` et n'est vérifiable que chez toi.
2. **Code blocks à défilement horizontal** : CM6 n'a qu'un seul flux de lignes, pas de scroll horizontal par bloc. Proposition : hors édition, le bloc est un widget (pre surligné, en-tête, copier, `overflow-x:auto`) ; curseur dedans → lignes brutes avec retour à la ligne. Écart mineur : les très longues lignes se replient pendant l'édition.
3. **Rythme vertical strict** avec widgets de hauteur variable (code, images, cartes) : arrondi par padding compensatoire ; à vérifier finement à la ph. 6.
4. **Boucle watcher ↔ sauvegarde** : nos propres écritures/renommages reviennent comme événements. Parade : à chaque événement, relire le fichier et ignorer si identique à l'état mémoire ; renommage = suppression+création rapprochées par `id`. Conflit (modif externe pendant une édition non sauvegardée) : on vide d'abord la file de sauvegarde locale, puis on recharge si le fichier a encore changé.
5. **Documents redirigé vers OneDrive** sur beaucoup de Windows : le coffre par défaut serait alors synchronisé (fichiers à la demande, conflits). Je le détecterai et l'afficherai dans les réglages ; à toi de décider.
6. **Barre de titre custom** (`decorations:false`) : perte du menu Snap Layouts au survol de « Agrandir » sur Windows 11 (limite Tauri connue). Ombre et coins arrondis via `shadow: true`.
7. **Ancrage des stickers** sans ID dans le Markdown : ancre = empreinte du bloc (type + hash du texte normalisé) + index de secours ; ré-association au plus proche si le bloc disparaît.
8. **Fluent Emoji** : GitHub et jsDelivr sont bloqués depuis ce conteneur, mais le paquet npm `@lobehub/fluent-emoji-3d` (MIT) est accessible. Poids : sélection d'environ 150 stickers pour rester raisonnable.
9. **OCR** : `Windows.Media.Ocr` exige les packs de langue OCR fr/en installés dans Windows ; fallback Tesseract → je proposerai `tesseract.js` (WASM, traineddata embarqués) plutôt qu'un binaire natif. À trancher en ph. 9.
10. **Export PDF** silencieux : nécessite l'API `PrintToPdf` de WebView2 (via `webview2-com`), sinon dialogue d'impression. À trancher en ph. 10.
11. **Performances 1000+ notes** : liste virtualisée, décorations limitées au viewport, recherche éventuellement dans un Web Worker.
12. **Préservation du frontmatter** utilisateur (commentaires, ordre) : réécriture seulement si une clé gérée change.

---

## Décisions et points à arbitrer

Contradictions entre le brief et DESIGN.md, ou silences de DESIGN.md. Proposition par défaut entre crochets ; je l'applique sauf avis contraire.

| # | Sujet | Brief | DESIGN.md | Proposition |
|---|---|---|---|---|
| D1 | Fond de page | `paper: plain\|lined\|grid\|dots` + `margin: true\|false` | `page: plain\|ruled\|ruled-margin\|grid\|dots` (§7) | **[Brief]** : `paper` + `margin`, cohérent avec le popover de DESIGN (4 vignettes + toggle « Red margin »). |
| D2 | Stockage stickers | frontmatter `stickers:` | bloc `<!-- ursa:stickers -->` en fin de fichier (§8) | **[Brief]** frontmatter (Markdown propre). |
| D3 | Décalage stickers | `dx, dy` en % de la largeur de colonne | offset en px | **[Brief]** % (suit le redimensionnement). |
| D4 | Stickers importés | `assets/stickers/` | `.ursa/stickers/` | **[Brief]** `assets/stickers/` : ce sont des données utilisateur, pas un cache. |
| D5 | Rotation à la pose | ±8° | stickers ±8°, post-it ±3° | **[DESIGN]** ±8° stickers, ±3° post-it. |
| D6 | Sommaire | colonne décalée sur grand écran, overlay sur petit | toujours overlay, colonne immobile (§2.15) | **[Brief]** : décalage si la place le permet, overlay sinon. |
| D7 | Palettes sombres | 4 palettes en clair **et** sombre | 4 claires + 2 sombres (`graphite`, `blue`) | coral→`graphite`, ink→`blue` ; je proposerai en ph. 6 des tokens sombres pour sage et kraft, à valider. |
| D8 | Opérateurs de recherche | + `@pinned` | + `@pdf` | Union des deux. |
| D9 | Raccourcis de folding | Ctrl+K = recherche | « tout replier » = Ctrl K Ctrl 0 / J | Conflit avec Ctrl+K → Ctrl+Alt+[ / ] pour tout replier/déplier, Ctrl+Shift+[ / ] pour la section. |
| D10 | Contrôles fenêtre et recherche de la titlebar | — | icônes en `--text`, recherche en `--bg-sunken` (§2.1, 2.3) | Sur `--bg-0` foncé (coral, ink), `--text` est illisible → `--chrome-text` et `--chrome-sunken`, comme l'indique la famille `--chrome-*` (§1). |
| D11 | Token de rythme | `--baseline` | `--rhythm` | **[DESIGN]** `--rhythm`. |
| D12 | Ctrl+U | souligné | — (pas de souligné en Markdown) | `<u>…</u>` rendu souligné, balises masquées comme la syntaxe. À confirmer en ph. 10. |
| D13 | Export image | JPG/PNG | tuile « JPG » | Tuile « Image » + segmented JPG/PNG. |
| D14 | Section Today | — | — | Notes **modifiées** aujourd'hui (comportement Bear). |
| D15 | Sizes en dur | « aucune taille en dur » | specs composants en px non tokenisées | Tokens de composants dans `tokens.components.css`, chaque valeur tracée vers sa section DESIGN.md. |

## Écarts avec le design
- Aucun pour l'instant (pas encore d'UI). Maquettes PNG manquantes : comparaison impossible tant qu'elles ne sont pas dans `design/`.

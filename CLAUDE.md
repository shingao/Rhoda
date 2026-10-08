# Ursa — guide du projet

Application de prise de notes locale pour Windows (usage perso). Esthétique et UX inspirées de Bear, identité **originale** : ne jamais reprendre le nom, le logo ni les icônes de Bear.

Nom public depuis la 1.0 : **Bullshit** (identifiant `com.bullshit.notes`, dossier par défaut `Documents\Bullshit`, exécutable `bullshit.exe`, icône `design/app-icon-1024.png`). « Ursa » reste le nom de code interne : dossier `.ursa/` du coffre, clés `ursa-*`, protocole `ursa-export:`, crate `ursa_lib`. Tout texte vu par l'utilisateur dit Bullshit (`src/app/brand.test.ts`, journal `bullshit.log`). La migration depuis Ursa (réglages `com.ursa.notes`, dossier `Documents\Ursa`) est dans `src-tauri/src/legacy.rs`.

## Sources de vérité

| Sujet | Fichier |
|---|---|
| Design (tokens, composants, états, Markdown live, motion, a11y, papier, stickers) | `DESIGN.md` |
| Tokens CSS (copie verbatim) | `design/ursa-tokens.css` → `src/styles/tokens.css` |
| Maquettes validées | `design/maquettes/` (canevas HTML + captures PNG) |
| Avancement, décisions, écarts | `PROGRESS.md` |

Si DESIGN.md est muet : proposer une solution cohérente et la consigner dans `PROGRESS.md` (section « Décisions »).

## Règles de travail (strictes)

1. Construction **phase par phase**, dans l'ordre de `PROGRESS.md`. Ne jamais démarrer une phase sans le « go » explicite de l'utilisateur.
2. Fin de phase : l'app compile et tourne (`npm run tauri dev`), 0 erreur TS, 0 warning de lint → commit propre → `PROGRESS.md` à jour (fait / reste / décisions / écarts design) → checklist de test manuel (5–10 points) → **STOP**.
3. Un problème signalé se corrige dans la phase en cours avant de passer à la suivante.
4. Code typé, modules clairs, commentaires seulement là où ils apportent quelque chose. Aucune fonctionnalité d'une phase future, sauf décision d'architecture explicitement justifiée.
5. Phase trop grosse → la découper en sous-étapes et l'annoncer.
6. À chaque phase UI : comparer le rendu aux maquettes de `design/` et lister les écarts.

## Stack

- **Tauri 2** (Rust minimal : FS, watcher, corbeille OS, fenêtre, réseau des aperçus de liens, OCR) + **React 19 + TypeScript strict + Vite**.
- Éditeur : **CodeMirror 6** uniquement (pas de contenteditable maison).
- Style : variables CSS + **CSS modules** (`*.module.css`).
- Icônes UI/tags : **lucide-react**. Stickers : **Fluent Emoji** (MIT) embarqués. Polices embarquées (woff2, `@fontsource/*`) : Hanken Grotesk, JetBrains Mono, Newsreader, Caveat (OFL).
- 100 % local, aucune télémétrie. Seule requête réseau : aperçus de liens (désactivables), faite côté Rust.

## Règles de style (non négociables)

- **Aucune couleur, taille de police, durée ou courbe en dur** dans le code. Tout passe par des variables CSS :
  - `src/styles/tokens.css` : copie verbatim de `design/ursa-tokens.css`. Ne jamais l'éditer à la main hors resynchronisation.
  - `src/styles/tokens.components.css` : tokens de composants extraits des specs de DESIGN.md (ex. `--sidebar-item-h: 32px`). Chaque ajout cite la section DESIGN.md.
- Exceptions autorisées par DESIGN.md : `#C42B1C` / `#B22A1C` (bouton Fermer Windows), `#FFFFFF` (poignée des toggles), badge de taille d'image — déclarées elles aussi comme tokens.
- Côté TS, les valeurs nécessaires au calcul (ex. rythme 28 px) sont lues depuis les variables CSS (`getComputedStyle`), jamais dupliquées.
- Pas de bordures entre zones ; accent réservé aux tags, liens, sélection, bouton principal, marqueurs H.
- Focus : `:focus-visible` uniquement, ring défini en 2. de DESIGN.md.
- Stylelint garde-fou : hex/rgb/hsl et unités `ms`/`s` interdits hors des fichiers de tokens.

## Structure (cible)

```
src/                     # frontend React
  app/                   # bootstrap, providers, raccourcis globaux, store
  components/            # UI génériques (Button, Toggle, Menu, Modal, Tooltip…)
  features/              # un dossier par domaine : titlebar, sidebar, notelist, editor, tags, search, outline, settings, export, stickers
  editor/                # extensions CodeMirror (markdown live, widgets, folding…)
  core/                  # logique pure sans React : parsing note/frontmatter, index, recherche, tags, dates
  services/              # pont Tauri (fs, watcher, settings) — seul endroit qui appelle invoke()
  styles/                # tokens.css, tokens.components.css, fonts.css, global.css
  assets/                # polices, stickers embarqués
src-tauri/               # backend Rust
  src/                   # commandes Tauri par domaine : vault, watcher, snapshots, assets, preview (ocr en phase 9)
design/                  # maquettes PNG + tokens source
```

Règle de dépendances : `core/` ne dépend de rien (testable en isolation) ; `features/` → `core/`, `services/`, `components/` ; `services/` est la seule couche qui parle à Tauri.

## Commandes

```bash
npm install
npm run tauri dev        # lancer l'app (Windows)
npm run dev              # frontend seul dans un navigateur, coffre factice en mémoire (devMock)
npm run typecheck        # tsc (app + config Vite)
npm run lint             # eslint + stylelint (0 warning toléré : --max-warnings 0)
npm run test             # vitest (logique core/)
npm run check            # typecheck + lint + tokens + contrastes + test
npm run check:contrast   # contrastes AA des paires texte/fond, 6 thèmes (tokens.css + tokens.components.css)
npm run check:tokens     # tokens.css == design/ursa-tokens.css, 6 thèmes, aucune var() indéfinie
npm run test:rhythm      # Playwright : chaque ligne et bloc (images, cartes) de « Rythme vertical » sur un multiple de 28 (2 polices × 14–20 px), aussi avec des blocs centrés / à droite / justifiés
npm run test:a11y       # Playwright : axe-core (WCAG 2.1 AA) sur les écrans principaux × 6 thèmes, focus visible au clavier, mouvement réduit, contraste élevé Windows
npm run test:typewriter  # Playwright : mode machine à écrire sur la note de 5 000 lignes (activation centrée, clic / souris / molette sans saut, recentrage doux à la frappe et aux flèches, rythme)
npm run test:align       # Playwright : alignement des blocs (raccourcis AZERTY, annulation, menu du bloc au clic droit, stickers qui évitent le texte, frontmatter, réouverture)
npm run perf             # build de production + coffre factice : démarrage à 2 000 notes, OCR au démarrage, frappe dans la recherche, mémoire sur 200 notes ouvertes
npm run sample:images    # régénère samples/assets (images et PDF d'exemple)
npm run build            # build frontend
npm run tauri build      # installeur NSIS par utilisateur (src-tauri/target/release/bundle/nsis/)
npm run icon             # icônes depuis design/icone-coquelicot-reference.png (puis npx tauri icon)
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Flux de données et conventions

- `src/app/notes.ts` est le seul endroit qui modifie des notes : sauvegarde (debounce 500 ms), renommage (2 s), création, corbeille, réconciliation avec le watcher. Toutes les opérations disque passent par sa file sérielle.
- `src/editor/session.ts` possède l'unique `EditorView` et garde l'`EditorState` des 30 dernières notes ouvertes (jamais d'une note au texte non écrit) ; les mises à jour venues du disque sont annotées pour ne pas déclencher de sauvegarde.
- Liste des notes fenêtrée (`src/features/notelist/useWindow.ts`) : seules les cartes proches de la zone visible sont dans le DOM ; focus et défilement passent par `view.focus` / `view.reveal`, jamais par un `getElementById` de carte.
- L'éditeur ne lit jamais le store : `src/editor/hooks.ts` déclare ce dont il a besoin (liens, tags, rétroliens, autocomplétion), `src/app/editorBridge.ts` le branche. Confirmations via `confirmAction()` (`src/app/confirm.ts`), messages courts via `showToast()`.
- Réglages des tags (icône, couleur, épingle, repli) : `.ursa/tags.json`, gérés par `src/app/tagOps.ts`.
- Sections de note (`src/editor/sections/`) : titres via la grammaire partagée (`headings.ts`), replis (`fold.ts`, état attaché à la ligne du titre), isolement (`focus.ts`), sommaire (`outline.ts`). Ce qui est caché : `visibility.ts` (`hiddenRanges`, `isHidden`, `revealPosition`) — à utiliser par la recherche et les stickers. Replis mémorisés dans `.ursa/folds.json` (`src/app/folds.ts`).
- Opérations en masse (tags, liens, suppression définitive, restauration) : copie préalable dans `.ursa/backups/<date-heure>-<opération>/` + `manifest.json` (id, chemin, titre, empreinte `textHash` du texte après l'opération), « Annuler » dans le toast (`undoAction`), Réglages › Sauvegardes (`listBackups`, `restoreBackup`, même vérification), purge à 30 jours.
- Recherche : moteur pur dans `src/core/search/` (`fold.ts` casse/accents, `query.ts` syntaxe, `search.ts` index incrémental, classement, extraits, `registerTextSource` pour l'OCR) ; état dans le store (`search`, `find`), logique dans `src/app/search.ts` ; occurrences dans l'éditeur via `src/editor/find/find.ts`. Banc : `src/core/search/bench.test.ts` (1 000 notes, < 50 ms par frappe) ; `localStorage` `ursa-dev-notes` = nombre de notes générées dans le coffre factice ; `VITE_URSA_MOCK=1` pour un build de production mesurable.
- Apparence : `src/app/theme.ts` applique mode / palettes (`data-theme`) et réglages d'éditeur (variables `--editor-fs`, `--editor-max`, `--editor-font-active`) ; `public/theme-boot.js` pose le thème mis en cache avant le premier rendu ; la fenêtre est affichée par `bootstrap` une fois thémée.
- Pixels physiques : `--dpr` posé par `src/app/devicePixels.ts` (suit l'écran de la fenêtre) ; traits fins via `--hairline`, positions via `round(…, var(--device-px))` (`tokens.components.css`). Jamais de `1px` en dur pour un trait visible.
- Fond de page : frontmatter `paper` / `margin` (sinon réglage par défaut), classes de `src/features/editor/paper.module.css` sur le corps de l'éditeur ; motifs dans `tokens.components.css` alignés sur `--paper-rule-y`. Tout nouveau bloc de l'éditeur doit garder le rythme (vérifier avec `npm run test:rhythm`).
- Dossier des notes : `src/app/vault.ts` (`openVault`, `switchVault`) ; tout état propre à un coffre doit pouvoir être vidé (`closeVault`, `closeTagConfig`, `closeFolds`, `resetEditor`).
- Modales : `components/Dialog.tsx` (scrim, focus piégé, app inerte derrière) ; popovers et toast rendus dans `document.body`. Réglages : `src/features/settings/`, ouverts via `settingsPage` du store.
- Mode focus : `focusMode` du store (non persisté), `src/app/layout.ts` ; estompage des paragraphes `src/editor/focusDim.ts`. Comptages (mots, caractères, lecture) : `src/core/markdown/stats.ts`.
- Pièces jointes : Rust `assets.rs` (import par chemins / octets / presse-papier système, format d'après le contenu, SHA-256, protocole `vault:` qui ne sert que `assets`, notes et caches `.ursa/thumbs|previews`, vignettes `_thumb/…`, PDF) ; côté app `src/app/attachments.ts`, `crops.ts`, `pdfs.ts`, `previews.ts` ; lignes d'image / PDF / URL dans `src/core/markdown/embeds.ts` ; blocs de l'éditeur dans `src/editor/embeds/` (champ d'état, widgets image / carte de lien / carte PDF ; hauteur de bloc = multiple de `--rhythm`). Les SVG ne passent que par `<img>`.
- Aperçus de liens : uniquement `src-tauri/src/preview.rs` ; toute requête passe par `fetch()` (contrôle d'URL + IP après DNS + connexion épinglée + redirections vérifiées). Ne jamais ajouter d'autre accès réseau.
- Stickers et post-it : modèle et ancrage dans `src/core/stickers.ts` (clé de bloc type + texte + rang, comme les replis) ; frontmatter `stickers:` réécrit à chaque sauvegarde par `persist` (`withEditorStickers`, `src/app/notes.ts`). Côté éditeur, `src/editor/stickers/` : `state.ts` (champ CodeMirror ; toute modification passe par `stickerTransaction`, effets inversibles donc annulables avec le texte), `layer.ts` (calque, gestes, fenêtre étroite), `postit.ts`, `commands.ts`. Côté app : `src/app/stickers.ts` (images `fluent/<id>` embarquées dans `src/assets/stickers/fluent/` ou `assets/stickers/` du coffre, tiroir, récents), `src/app/noteView.ts` (« Masquer les stickers » par note, `.ursa/view.json`), tiroir dans `src/features/stickers/`.
- OCR : Rust `src-tauri/src/ocr/` (interface `Engine`, Windows.Media.Ocr dans `windows.rs` sous `#[cfg(windows)]`, tuiles, EXIF, cache `.ursa/ocr/<sha256>.json` + `index.json`) ; côté app `src/app/ocr.ts` (file d'attente, PDF via `src/app/pdfjs.ts`, source de texte `ocr` avec fichier et page) ; logique pure `src/core/ocr.ts` (fichiers lus, zones, cadrage) ; zones dans Ctrl+F via `findField.images` et `ImageWidget` ; réglages `settings.ocr`. Le vrai test OCR ne tourne que sous Windows (CI) ; coffre factice : `localStorage` `ursa-dev-ocr` = `off` | `en`.
- Export : modèle de document pur dans `src/core/export/` (`model.ts` depuis la grammaire, `html.ts` échappe tout, `markdown.ts`) ; côté app `src/app/export/` (`page.ts` page autonome avec polices / images / stickers en data URL, `docx.ts`, `raster.ts` PNG/JPG, `index.ts` orchestration) ; styles de la page dans `src/features/export/export.css` (tokens seulement, intégrés en `?raw`). Rust `src-tauri/src/export/` : écriture limitée au dossier choisi par l'utilisateur (jamais d'écrasement), PDF par `PrintToPdf` de WebView2 dans une fenêtre cachée servie par `ursa-export:` ; `URSA_PDF_SMOKE` pour le test CI.
- Robustesse : `src/app/ErrorBoundary.tsx` (écran `features/crash/`, texte en attente écrit avant « Recharger ») ; journal d'erreurs `src-tauri/src/log.rs` (`%LOCALAPPDATA%\com.ursa.notes\logs`, 5 fichiers max) alimenté par `src/app/log.ts` (`console.error/warn`, erreurs non rattrapées) ; ce qui y entre passe par `src/core/logText.ts` : jamais de texte de note. Coffre factice : `window.__ursaLogs`, `window.__ursaCrash()`.
- Intégration continue : `.github/workflows/windows.yml` (check, test:rhythm, test:a11y, clippy, tests Rust dont l'OCR réel, build Tauri, installeur en artefact, `scripts/ci/installer-test.ps1` : installation / instance unique / désinstallation / mise à jour 0.9.0 → version courante) à chaque push ; une release se fait par *Actions* › *Windows* › *Run workflow* avec « release » coché (tous les tests, puis tag `v<version>` et release GitHub brouillon avec l'installeur et les notes de `CHANGELOG.md`) ; un tag `v*` poussé fait de même.
- Packaging : NSIS `currentUser` en français (`src-tauri/installer/French.nsh`), bootstrapper WebView2 embarqué, instance unique (`tauri-plugin-single-instance`, premier plugin). Version : `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (À propos lit `package.json`).
- Accessibilité : contrastes vérifiés par `scripts/check-contrast.mjs` (toute nouvelle paire texte/fond s'y ajoute ; si un thème est trop juste, jeton dérivé `color-mix` dans `tokens.components.css`, ex. `--text-3-raised` sur les surfaces surélevées) ; en contraste élevé, toute surface surélevée a `border: 1px solid CanvasText` ; les cartes et arbres gardent le titre en premier dans l'ordre de lecture.
- Tout élément tiers embarqué (police, images, bibliothèque) est listé dans Réglages › À propos (`src/features/settings/AboutPage.tsx`), avec le texte de sa licence dans `src/assets/licenses/`.
- Identité d'une note : l'`id` du frontmatter (provisoire en mémoire pour une note externe, écrit à la 1re écriture). L'index est indexé par `id`, jamais par chemin.
- Échecs disque (fichier verrouillé) : jamais bloquants ni destructeurs ; texte gardé en attente, ancien nom conservé, nouvelle tentative plus tard.
- **Textes d'interface** : uniquement via `src/i18n/` (`fr.ts` = référence, `en.ts` mêmes clés) et `useT()` / `currentMessages()`. Aucune chaîne visible en dur dans les composants.
- **Raccourcis** : uniquement déclarés dans `src/app/shortcuts.ts` ; les composants les référencent par id (`shortcutLabel`, `shortcutKeys`, `matchShortcut`), jamais par touches : les personnalisations (`settings.shortcuts`, règles et résolution dans `src/core/keys.ts`) s'appliquent alors partout. Les raccourcis de l'éditeur passent par `EDITOR_COMMANDS` (`src/editor/setup.ts`).
- **Commandes** : toute action nommable va dans `src/app/commandList.ts` (libellé, icône, raccourci, raison d'indisponibilité) ; la palette (`src/app/palette.ts`) et les raccourcis globaux s'en servent.
- **Markdown** : une seule grammaire (`src/core/markdown/syntax.ts`) pour l'éditeur et l'indexation. Le rendu live (`src/editor/livePreview/`) ne parcourt que la zone visible ; ses styles sont dans `src/editor/editor.css` (règles de ligne en `.cm-editor .cm-line.x`).
- Notes d'exemple dans `samples/` (`npm run sample:long` régénère la note de 5 000 lignes). Outils de dev du navigateur : `localStorage` `ursa-dev-raw`, `ursa-dev-fail-writes`.

## Données sur disque

- Dossier des notes (défaut `Documents/Ursa`) : un `.md` par note, frontmatter YAML géré par l'app (clés inconnues préservées), `assets/` pour les pièces jointes.
- `<dossier>/.ursa/` : données internes reconstructibles ou propres au coffre (tags.json, folds.json, caches).
- Réglages de l'app (dont l'emplacement du dossier) : dossier de config Tauri (`%APPDATA%/…/settings.json`), pas dans le coffre.
- Le Markdown doit rester lisible et propre dans n'importe quel autre éditeur.

## Git

- Branche de travail : `claude/ursa-notes-app-j3yanr`. Un commit propre par phase (ou sous-étape), message clair en anglais au format `phase N: …`.
- Ne jamais committer `node_modules/`, `src-tauri/target/`, `dist/`.

## Environnement de développement

Le développement se fait en partie dans un conteneur Linux : on y vérifie typecheck, lint, tests, build Vite et `cargo check/clippy`, mais l'app Windows (`npm run tauri dev`, rendu WebView2, API Windows) ne peut être lancée que sur la machine de l'utilisateur. Le code spécifique Windows est isolé derrière `#[cfg(windows)]`.

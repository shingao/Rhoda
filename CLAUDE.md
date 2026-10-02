# Ursa — guide du projet

Application de prise de notes locale pour Windows (usage perso). Esthétique et UX inspirées de Bear, identité **originale** : ne jamais reprendre le nom, le logo ni les icônes de Bear.

## Sources de vérité

| Sujet | Fichier |
|---|---|
| Design (tokens, composants, états, Markdown live, motion, a11y, papier, stickers) | `DESIGN.md` |
| Tokens CSS (copie verbatim) | `design/ursa-tokens.css` → `src/styles/tokens.css` |
| Maquettes validées | `design/*.png` |
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
  src/commands/          # commandes Tauri groupées par domaine (vault, watcher, preview, ocr)
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
npm run check            # typecheck + lint + test
npm run build            # build frontend
npm run tauri build      # packaging (.msi en phase 10)
cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test
```

## Flux de données et conventions

- `src/app/notes.ts` est le seul endroit qui modifie des notes : sauvegarde (debounce 500 ms), renommage (2 s), création, corbeille, réconciliation avec le watcher. Toutes les opérations disque passent par sa file sérielle.
- `src/editor/session.ts` possède l'unique `EditorView` et un `EditorState` par note ; les mises à jour venues du disque sont annotées pour ne pas déclencher de sauvegarde.
- Identité d'une note : l'`id` du frontmatter (provisoire en mémoire pour une note externe, écrit à la 1re écriture). L'index est indexé par `id`, jamais par chemin.
- Échecs disque (fichier verrouillé) : jamais bloquants ni destructeurs ; texte gardé en attente, ancien nom conservé, nouvelle tentative plus tard.
- **Textes d'interface** : uniquement via `src/i18n/` (`fr.ts` = référence, `en.ts` mêmes clés) et `useT()` / `currentMessages()`. Aucune chaîne visible en dur dans les composants.
- **Raccourcis** : uniquement déclarés dans `src/app/shortcuts.ts` ; les composants les référencent par id (`shortcutLabel`, `matchShortcut`).

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

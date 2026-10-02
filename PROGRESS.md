# Ursa — PROGRESS

État : **Phase 2 terminée et comparée aux maquettes** (à valider sur Windows) — en attente du « go » pour la phase 3.

| Phase | Sujet | État |
|---|---|---|
| 0 | Cadrage | ✅ fait |
| 1 | Squelette et fichiers | ✅ validée |
| 2 | Éditeur Markdown live | ✅ fait (à valider sur Windows) |
| 3 | Tags, liens, todos, sections | ⏳ en attente du go |
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

## Phase 1 — Squelette et fichiers

### Fait
- **Scaffold** Tauri 2 + React 19 + TypeScript strict + Vite 8 ; ESLint (0 warning) + Stylelint (garde-fou tokens : hex/rgb/hsl/`ms` interdits hors fichiers de tokens, `font-size`/`font-weight`/`border-radius` uniquement via variables) + Vitest ; clippy `-D warnings`.
- **Tokens** : `src/styles/tokens.css` (copie verbatim), `src/styles/tokens.components.css` (valeurs des specs DESIGN.md, section citée pour chacune, + réduction de mouvement). Polices Hanken Grotesk et JetBrains Mono embarquées (`@fontsource`). Palette `coral` par défaut.
- **Fenêtre** sans décorations Windows, ombre native, taille/position mémorisées (plugin `window-state`). **Titlebar** : bouton sidebar + « Ursa », champ de recherche (visuel ; Ctrl+K y met le focus), bouton « Nouvelle note », contrôles fenêtre (Fermer rouge au survol, icônes estompées si fenêtre inactive). Zones vides = déplacement, double-clic = agrandir.
- **Layout** : sidebar (`--bg-0`) + « feuille » arrondie (liste `--bg-1` + éditeur `--bg-2`, `--shadow-sheet`). Colonnes redimensionnables (poignée 6 px, ligne accent pendant le drag, double-clic = défaut, bornes des tokens, éditeur ≥ 420 px), repliables (animation 240 ms), largeurs et repli persistés.
- **Fichiers** (Rust) : scan récursif (ignore dossiers cachés, `.ursa/`, `assets/`), lecture UTF-8, écriture atomique (temp + rename, retry si verrou Windows), création et renommage sans jamais écraser un fichier (voir « Corrections »), chemins validés (impossible de sortir du coffre), `.ursa/version`. Watcher `notify` (debounce 250 ms).
- **Cycle de vie des notes** (TS) : sauvegarde auto 500 ms après la dernière frappe ; renommage d'après le titre 2 s après la dernière frappe, et immédiatement au changement de note, à la perte de focus de la fenêtre et à la fermeture ; toutes les écritures passent par une file sérielle. Fins de ligne CRLF/LF préservées. `id` UUID v7 + `created` à la création ; `id` ajouté à la 1re écriture d'une note externe.
- **Watcher côté app** : nos propres écritures sont reconnues (contenu identique) et ignorées ; modif externe → liste et éditeur mis à jour en direct (curseur conservé) ; ajout/suppression externes ; renommage externe d'une note avec `id` → même note conservée. Une note avec des modifications locales non sauvegardées garde la version locale.
- **Corbeille** : Suppr (liste), clic droit › Placer dans la corbeille ou menu `…` de l'éditeur → `trashed: <date>` dans le frontmatter, la note disparaît de la liste (la vue Trash et la restauration arrivent en phase 3).
- **Liste** : cartes (date relative, titre, aperçu 2 lignes sans Markdown, icône épingle), épinglées en tête, tri modifié/créé/titre (menu, mémorisé), navigation clavier (flèches, Home/End, Entrée → éditeur, Suppr), roving tabindex, `listbox`/`option`.
- **Éditeur** : CodeMirror 6 en Markdown brut, colonne centrée `--editor-max`, police/taille/interligne des tokens, curseur 2 px accent (sans clignotement si mouvement réduit), historique d'annulation conservé par note.
- **Composants** : Button, IconButton, Tooltip (500 ms, enchaînement instantané < 800 ms), Menu (clavier, items danger, radio), Resizer, scrollbar overlay auto-masquée.
- **Tests** : 41 tests Vitest (frontmatter, titre/aperçu, noms de fichiers Windows, CRLF, tri, dates fr/en, raccourcis, cycle de vie des notes avec faux système de fichiers + écho du watcher), 9 tests Rust (chemins, validation, MAX_PATH, collisions, renommage, écriture atomique).
- **Vérifications faites ici** : typecheck, lint, tests, `vite build`, `cargo clippy`, et lancement réel du binaire Tauri sous Linux/Xvfb : coffre créé, notes chargées, ajout + modification externes répercutés en direct, puis (après corrections) création, renommage d'après le titre (`Réunion: équipe / Q4?` → `Réunion équipe Q4.md`) et collision insensible à la casse (`PLANPLAN 2.md` à côté de `Planplan.md`). Rendu WebView2 Windows non vérifiable ici.

### Corrections après le retour sur la phase 1

**1. Noms de fichiers Windows** (`src/core/note/filename.ts` + `src-tauri/src/vault.rs`)
- Titre → nom : `< > : " / \ | ? *` et caractères de contrôle (U+0000–U+001F, U+007F) remplacés par une espace, espaces multiples fusionnées, points de tête retirés, points et espaces de fin retirés, normalisation Unicode NFC, titre vide → « Sans titre ».
- Noms réservés (`CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0-9`, `LPT0-9`, y compris `COM¹²³`), **même suivis d'une extension** (`CON.txt`) : suffixe `_` (`CON_`, `CON_.txt`).
- Longueur : 120 caractères max côté interface ; le backend raccourcit encore si besoin pour que `dossier\nom 999.md` reste sous **MAX_PATH (259 unités UTF-16)**, sans couper un caractère.
- Collisions **insensibles à la casse** (comme NTFS) : suffixe ` 2`, ` 3`… Un changement de casse seul renomme bien le fichier. Une note qui porte déjà le bon nom (avec ou sans suffixe) n'est pas renommée.
- **Jamais d'écrasement** : `rename` de Rust remplace silencieusement la cible sous Windows ; on passe par un lien physique + suppression de la source (ou un `rename` après vérification sur les systèmes de fichiers sans liens physiques). Création : fichier temporaire puis déplacement sans écrasement.
- **Fichier verrouillé** : nouvelles tentatives côté Rust (accès refusé, violation de partage), puis côté app : l'ancien nom est conservé et le renommage est retenté plus tard (2 s, 5 s, 15 s, 30 s puis toutes les 60 s), sans message bloquant. Même logique pour une sauvegarde qui échoue : le texte reste en attente et rien n'est perdu.
- Le backend revalide le nom reçu (caractères, noms réservés, points finaux) par sécurité.

**2. Watcher et écritures de l'app** — vérifié par tests (`src/app/notes.test.ts`) : les chemins touchés par nos sauvegardes, créations et renommages sont renvoyés au réconciliateur comme le ferait le watcher, et le store ne reçoit **aucune** mise à jour (0 doublon, 0 clignotement). Mécanisme : toutes les opérations disque et la réconciliation passent par la même file sérielle ; une écriture de l'app revient avec un contenu identique à `diskContent` → ignorée ; après un renommage, l'ancien chemin n'est plus dans l'index et le nouveau a un contenu identique → ignorés.

**3. Identité des notes** — l'index (`useApp().notes`) est désormais **indexé par l'`id` du frontmatter**, jamais par le chemin (auparavant : par un identifiant d'exécution). Détails :
- Note externe sans `id` : `id` provisoire en mémoire, écrit **en tête** du frontmatter à la première écriture par l'app.
- Note renommée ou déplacée hors de l'app : reconnue par son `id`, elle reste la même note (sélection, historique d'annulation conservés).
- Fichier copié dans l'Explorateur (même `id` que l'original) : la copie reçoit un nouvel `id`, écrit dans son frontmatter ; au démarrage, c'est le fichier le plus ancien qui garde l'`id`.
- `id` numérique écrit par un autre outil (`id: 42`) : accepté tel quel (converti en texte), jamais écrasé.

**4. Langue** — interface en **français par défaut**, anglais disponible (`language: "fr" | "en"` dans `settings.json` ; sélecteur dans l'écran Réglages en ph. 6). Toutes les chaînes sont dans `src/i18n/fr.ts` (catalogue de référence, typé) et `src/i18n/en.ts` (mêmes clés, vérifié par le compilateur). Dates relatives localisées : « à l'instant », « il y a 12 min », « il y a 2 h », « hier », « lun. », « 28 août », « 28 sept. 2025 ». Noms de touches localisés (« Maj », « Suppr »).

**5. Raccourcis** — tous déclarés dans `src/app/shortcuts.ts` (`SHORTCUTS` : id → touches + portée `global` | `list`) ; les composants n'y font référence que par id, et les libellés des tooltips/menus en sont dérivés. Analyse/correspondance/affichage dans `src/core/keys.ts` (testé) : lettres comparées par caractère (fonctionne en AZERTY), ponctuation par touche physique. Restent hors config, volontairement : touches de navigation imposées par les conventions ARIA (flèches, Début/Fin, Entrée, Échap, Tab) et touches d'édition de CodeMirror. Phase 10 : surcharges utilisateur dans `settings.shortcuts` appliquées sur `SHORTCUTS`.

**6. Échecs de sauvegarde visibles** — après **plus de 2 échecs consécutifs** de sauvegarde d'une note, une icône `circle-alert` (`--danger`) apparaît dans la barre de l'éditeur ; son tooltip (aussi atteignable au clavier) donne la raison : « Non sauvegardé : le fichier est verrouillé par un autre programme. Nouvel essai automatique. ». Le backend renvoie désormais des erreurs typées (`locked`, `permissionDenied`, `diskFull`, `readOnly`, `notFound`…) traduites dans `src/i18n`. L'icône disparaît à la première sauvegarde réussie. Les échecs de renommage restent silencieux.

**7. Fermeture avec du contenu non sauvegardé** — à la fermeture, tout est d'abord sauvegardé ; s'il reste du texte non écrit, une modale (§2.17) « Modifications non enregistrées » liste les notes et la cause, avec **Réessayer** (action principale, focus initial : Entrée ne fait jamais perdre de texte), **Enregistrer une copie ailleurs…** (boîte de dialogue native « Enregistrer sous » pour une note, choix d'un dossier pour plusieurs ; le chemin est choisi côté Rust, l'interface ne peut pas écrire ailleurs que dans le coffre) et **Quitter quand même** (bouton danger). Échap ou clic hors de la modale = annuler la fermeture.

**8. Libellés** — l'interface française fait foi : DESIGN.md a une section « 0. Langue et libellés » (tableau FR/EN) et tous ses libellés sont passés en français.

### Stratégie prévue (phase 3) : mise à jour automatique des [[wiki-links]] au changement de titre
- **Déclencheur** : le même point de contrôle que le renommage du fichier (2 s d'inactivité, changement de note, perte de focus, fermeture), jamais à chaque frappe, pour ne pas réécrire les liens sur des titres intermédiaires (« Jap », « Japo »…). L'ancien titre est celui du dernier point de contrôle.
- **Ciblage par `id`** : l'index des backlinks (construit avec le parseur Lezer partagé, donc les liens dans du code sont ignorés) associe chaque `[[…]]` résolu à l'`id` de la note cible. On ne réécrit que les liens résolus vers *cette* note ; si l'ancien titre était ambigu (plusieurs notes du même titre), on ne touche à rien.
- **Réécriture** : `[[Ancien]]` → `[[Nouveau]]`, en conservant alias et ancre (`[[Ancien|texte]]`, `[[Ancien#Section]]`) ; comparaison insensible à la casse comme la résolution des liens. Titre devenu vide → aucun changement.
- **Écriture** : via la file sérielle et `persist` ; une note ouverte dans l'éditeur est modifiée par une transaction CodeMirror (le curseur est préservé et Ctrl+Z l'annule), une note avec des modifications en attente est d'abord sauvegardée. Indication discrète non bloquante (« 3 liens mis à jour »).
- **Robustesse** : si un fichier est verrouillé, même politique de nouvelles tentatives que les sauvegardes.

### Reste à faire (phases suivantes)
- Rendu Markdown live (ph. 2) ; sections Untagged/Todo/Today/Pinned/Archive/Trash, épingler/archiver/restaurer (ph. 3) ; recherche (ph. 5) ; écran Réglages, dont le choix du dossier (ph. 6) ; virtualisation de la liste et F6 entre zones (ph. 10).

### Décisions (phase 1)
| # | Sujet | Décision |
|---|---|---|
| P1-1 | Sous-étapes | Annoncées en 3 (scaffold / fichiers / liste+éditeur) mais livrées en **un seul commit** : elles dépendent les unes des autres et des commits intermédiaires n'auraient pas compilé. |
| P1-2 | Sidebar | Seule la section « Notes » (avec compteur) est affichée ; les autres sont en phase 3. |
| P1-3 | Barre de l'éditeur | ~~44 px + bouton de repli de la liste~~ → alignée sur les maquettes en phase 2 : 52 px, fil d'Ariane à gauche (ph. 3), « Modifié … » + menu `…` à droite ; replier la liste passe par le menu `…` et Ctrl+Maj+\. |
| P1-4 | En-tête de liste | 52 px : titre de panneau « Notes » 17/700 + bouton texte de tri « Modification ⌄ » (maquettes), menu radio. La date des cartes suit le tri. |
| P1-5 | Raccourcis colonnes | Ctrl+\ sidebar (DESIGN), **Ctrl+Maj+\ liste** (ajout). Touche physique : sur AZERTY, c'est la touche `*` / `µ` à gauche d'Entrée. |
| P1-6 | Note sans titre | Fichier `Sans titre.md` (`Untitled.md` en anglais), titre affiché « Sans titre » en `--text-3`. Nouvelle note = `# ` prêt à recevoir le titre. |
| P1-7 | Encodage | Fichiers non UTF-8 ignorés (log) ; BOM UTF-8 retiré à la lecture et non réécrit. |
| P1-8 | Sous-dossiers | Lus et surveillés ; les nouvelles notes sont créées à la racine du coffre. |
| P1-9 | Notes archivées | Lues (`archived: true`) et exclues de « Notes », comme chez Bear. |
| P1-10 | Emplacement du coffre | `vaultPath` dans `%APPDATA%\com.ursa.notes\settings.json` (null = Documents\Ursa) ; l'interface pour le changer arrive avec l'écran Réglages (ph. 6). |
| P1-11 | Éditeur | Marge haute = 2 unités de rythme, marge basse 40 vh pour pouvoir remonter la dernière ligne ; frontmatter jamais affiché dans l'éditeur. |
| P1-12 | CSP | Stricte, avec `dangerousDisableAssetCspModification: ["style-src"]`, nécessaire car CodeMirror injecte ses styles à l'exécution. |
| P1-13 | Mode navigateur | `npm run dev` hors Tauri sert un coffre factice en mémoire (`src/services/devMock.ts`, exclu du build) pour itérer sur l'UI et faire des captures. |
| P1-14 | Icône | Originale : la Grande Ourse (Ursa Major) sur fond graphite, étoiles de pointage en corail (`design/app-icon.svg`). |
| P1-15 | Fermeture de la recherche | Bouton effacer 22 px (DESIGN), icône 14 px (non spécifiée). |

### Checklist de test manuel (phase 1, mise à jour)
1. `npm install` puis `npm run tauri dev` : fenêtre sans barre Windows, **interface en français** ; déplacement, double-clic, Réduire/Agrandir/Fermer.
2. Ctrl+N → `Sans titre.md` dans `Documents\Ursa` ; tape un titre, 2 s plus tard le fichier porte ce titre.
3. **Caractères interdits** : titre `Réunion: équipe / Q4?` → `Réunion équipe Q4.md`.
4. **Noms réservés** : titre `CON` → `CON_.md` ; titre `aux.txt` → `aux_.txt.md`.
5. **Collision insensible à la casse** : deux notes intitulées `Plan` puis `PLAN` → `Plan.md` et `PLAN 2.md`. Change le 2e titre en `plan` → `plan 2.md` (simple changement de casse). Supprime `Plan.md` dans l'Explorateur puis modifie la 2e note → elle devient `plan.md`.
6. **Points/espaces finaux et titre vide** : titre `Fin...` → `Fin.md` ; titre `...` → `Sans titre.md`. **Titre très long** (300 caractères) : nom tronqué, fichier créé sans erreur.
7. **Fichier verrouillé** : ouvre une note dans Word (ou un autre programme qui verrouille), change son titre dans Ursa : aucune erreur affichée, le texte est sauvegardé, l'ancien nom est gardé ; ferme Word, modifie la note : le fichier est renommé.
8. Modifie une note dans le Bloc-notes : mise à jour en direct. **Renomme un fichier dans l'Explorateur** : la note reste sélectionnée, pas de doublon. **Copie un fichier** dans l'Explorateur : 2 notes, la copie reçoit un nouvel `id`.
9. Pendant que tu tapes, la liste ne clignote pas et aucune note n'apparaît en double lors des sauvegardes/renommages.
10. Suppr sur une carte (ou clic droit › Placer dans la corbeille) : la note disparaît, le fichier contient `trashed:`. Tri, largeurs et repli des colonnes conservés après redémarrage.

### Écarts avec le design (phase 1)
- **Pas de maquettes PNG** : comparaison faite uniquement avec DESIGN.md, via captures du frontend dans Chromium. À refaire quand les maquettes seront dans `design/`.
- Titlebar en `--chrome-*` au lieu de `--text` / `--bg-sunken` (D10).
- Scrollbar : le pouce s'élargit à 8 px au survol du pouce lui-même, pas de toute la zone de 10 px (limite de `::-webkit-scrollbar`).
- Snap Layouts de Windows 11 absents au survol de « Agrandir » (limite Tauri, cf. risque 6).
- Markdown brut dans l'éditeur (attendu : live preview en phase 2).

---

## Phase 2 — Éditeur Markdown live

Découpée et livrée en sous-étapes : 2a grammaire, 2b rendu inline, 2c blocs, 2d machine à écrire, performances, démo, captures.

### Fait
- **Grammaire partagée** (`src/core/markdown/syntax.ts`, 9 tests) : CommonMark + GFM + `==surlignage==`, `[[cible]]` / `[[cible|alias]]`, tags `#tag`, `#tag/sous-tag`, `#tag multi mots#` (pas de faux positif sur `C#`, `#123`, `…/#ancre`, ni dans le code). Elle servira aussi à l'indexation (ph. 3).
- **Rendu live** (`src/editor/livePreview/`) : un `ViewPlugin` parcourt l'arbre syntaxique **uniquement sur la zone visible** et reconstruit les décorations seulement si le texte, la zone visible, l'arbre ou l'ensemble des lignes révélées change.
  - Syntaxe (`**`, `_`, `*`, `~~`, `==`, `` ` ``, `#`, `>`, `[ ]( )`, `[[ ]]`, `\`) **cachée** hors des lignes qui portent le curseur ou une sélection, **estompée** (`--syntax-opacity`) sur ces lignes ; rien n'est révélé quand l'éditeur n'a pas le focus.
  - Titres H1–H6 aux tailles du design (H1 sur 2 unités, décalé de 10 px), marqueur « H1…H6 » dans la marge (accent, opacité .55, `aria-hidden`), qui ne bouge jamais.
  - Gras, italique, gras-italique, barré (`--text-3`), surlignage, code inline (mono .86em, `--accent-text`), liens (Ctrl+clic ouvre http/https/mailto/www), URL nues, `[[wiki-links]]` (alias affiché seul), tags en pastille (identiques sur la ligne active).
  - Listes : puces 5 px, numéros tabulaires, retrait suspendu de 24 px par niveau, lignes de continuation alignées ; Entrée continue la liste, Retour arrière retire le marqueur (keymap Markdown de CodeMirror).
  - Tâches : cercle 18 px cliquable (seule la case bascule, Ctrl+Z l'annule), cochée = fond `--text-3` + coche, texte `--text-3`, sous-tâches imbriquées.
  - Citations : bloc `--bg-1` arrondi, italique `--text-2`, sans barre ; imbriquées en `--bg-sunken`.
  - Blocs de code : en-tête 32 px (langue + bouton Copier, visible au survol ou curseur dans le bloc, coche pendant 1,2 s), code mono 13.5/1.65, coloration (mots-clés accent, littéraux `--text-2`, commentaires `--text-3` italique), clôtures estompées quand le curseur est dans le bloc. Langages chargés à la demande.
  - Séparateur `---` : trait 1 px `--separator` au milieu de sa ligne.
- **Curseur** : rien n'est atomique ni sauté. La ligne active étant entièrement révélée, les flèches traversent chaque caractère de syntaxe ; ↑/↓ gardent la colonne visée ; la sélection au clavier et à la souris fonctionne sur les lignes rendues ; **copier/couper copient le Markdown brut** (vérifié : texte copié identique au source).
- **Mode machine à écrire** (menu `…` de l'éditeur, mémorisé) : la ligne courante reste centrée.
- **Note de démo** : `samples/Démo éditeur.md` (chaque élément + cas limites : gras dans un titre, lien dans une liste, code inline contenant des `**`, tâche imbriquée, titre très long, emoji composés, faux tags) ; `samples/Note longue (5000 lignes).md` générée par `npm run sample:long`.
- **Performances** (note de 5 000 lignes, curseur ligne 2500, Chromium) : transaction + décorations + DOM par frappe **3,0 ms** médiane / 4,6 ms p95 ; **frappe → image affichée 11,2 ms** médiane / 18,5 ms p95 à vitesse de frappe humaine ; **aucune tâche longue** (> 50 ms) ; défilement de toute la note à 60 i/s.
- **Captures avant/après** : `docs/captures/phase-2/planche-1.png` et `planche-2.png` (16 éléments × brut / rendu / curseur sur la ligne).
- **Vérifié dans la vraie app** (binaire Tauri sous Linux) : rendu de la démo, indicateur « Non sauvegardé » et dialogue de fermeture en conditions réelles (Réessayer → sauvegarde puis fermeture).
- Tests : 55 Vitest (dont grammaire, rythme des blocs de code, lignes révélées), 9 Rust.

### Décisions (phase 2)
| # | Sujet | Décision |
|---|---|---|
| P2-1 | Portée de la révélation | Par ligne : toute ligne touchée par le curseur ou la sélection, et seulement si l'éditeur a le focus. Un bloc de code est révélé en entier dès que le curseur y entre. |
| P2-2 | Marqueurs de liste sur la ligne active | Bruts et estompés, dans une boîte de 24 px pour que le texte ne bouge pas (puces, numéros). Les tâches sont en mono .86em comme le veut DESIGN §3 : leur texte se décale vers la droite quand le curseur arrive. |
| P2-3 | Blocs de code | Décorations de ligne, pas de widget bloc : le curseur entre et sort du bloc sans saut et la hauteur du bloc est identique révélé ou non. Contrepartie : les lignes longues **reviennent à la ligne** au lieu de défiler horizontalement (voir écarts). |
| P2-4 | Rythme vertical des blocs de code | La ligne de clôture prend la hauteur qui arrondit le bloc au multiple de 28 (en-tête 32 + n × 22,275 + ≥ 16). La « marge basse 24 » de §2.8 est remplacée par la ligne vide Markdown (28). |
| P2-5 | Tags et wiki-links | Rendu visuel dès la phase 2 (la grammaire en a besoin) ; clic pour filtrer, autocomplétion, navigation, liens cassés et aperçu au survol en phase 3. |
| P2-6 | Ctrl+clic | Ouvre les liens web (http, https, mailto, www.) dans le navigateur ; les autres schémas sont ignorés. |
| P2-7 | Éléments non rendus | Images (phase 7), tableaux et HTML restent en texte brut. |
| P2-8 | Sélection | Calque de sélection au-dessus du texte (couleur translucide `--selection`) pour rester visible sur les fonds de code, citation et pastilles. |
| P2-9 | Citations imbriquées | Bloc `--bg-sunken` accolé sous la citation parente, sans retrait supplémentaire (DESIGN muet). |
| P2-10 | Titres Setext (`===`/`---` sous le texte) | Rendus comme H1/H2, soulignement toujours estompé. |
| P2-11 | Outils de dev | `localStorage` `ursa-dev-raw` (Markdown brut), `ursa-dev-fail-writes` (échecs simulés) et `window.__ursaView`, uniquement en `npm run dev` ; absents du build. |

### Comparaison avec les maquettes (retour sur la phase 2)

Sources : `design/maquettes/` (canevas HTML + captures). Méthode : l'écran 02 (HTML statique) a été rendu dans Chromium et comparé, mesures à l'appui, à la même note dans Ursa (`samples/Maquette éditeur.md`, colonne de 660 px dans les deux cas) ; les captures des écrans 04–09 et Papier ont servi pour le reste. Résultat après corrections : `docs/captures/phase-2/maquette-02-rendu-ursa.png`.

**Écarts corrigés**
| Élément | Maquette | Avant | Correction |
|---|---|---|---|
| Barre de l'éditeur | 52 px, padding 0 16 0 28, fil d'Ariane à gauche, « Edited just now » + `…` (02) ; icônes à droite (04–09) | 44 px, bouton de repli de la liste à gauche | 52 px, « Modifié à l'instant / il y a 2 h / hier / le 28 sept. » (12.5 `--text-3`) + `…` ; le repli de la liste passe dans le menu `…` (avec son raccourci). Fil d'Ariane : phase 3 |
| Code inline, ligne active | backticks estompés en mono .86em **hors** de la pastille (02, 02b) | backticks dans la pastille | pastille autour du code seul, backticks à côté |
| Lien `[texte](url)`, ligne active | texte en `--accent-text` **sans** soulignement quand la syntaxe est visible (02b) | soulignement conservé | soulignement retiré sur la ligne active |
| Wiki-link, ligne active | `[[ ]]` estompés, sans le trait `--accent-soft` (02b) | trait conservé | trait retiré sur la ligne active |
| `## ` d'un titre actif | estompé et en graisse 500 (02b) | estompé, graisse 700 | graisse 500 |
| Tri de la liste | bouton texte « Modified ⌄ » (04–09) | bouton icône | bouton texte « Modification ⌄ » |
| Recherche (titlebar) | placeholder « Search notes, #tags, @todo… » | « Rechercher » | « Rechercher des notes, #tags, @todo… » |
| Aperçu des cartes | la ligne de tags sous le titre n'apparaît pas (05–09) | aperçu commençant par `#projets/ursa #recherche` | lignes composées uniquement de tags ignorées dans l'aperçu (testé) |

**Conforme (vérifié)** : colonne de 660 px centrée ; marqueurs H1–H6 à 48 px à gauche dans une boîte de 22 px, H2/H3 centrés sur la x-height (± 1 px de la maquette) ; tags en pastille identiques sur la ligne active ; gras, italique, surlignage (`--highlight`, rayon 3, padding 0 2), code inline (`--bg-code`, `--accent-text`), wiki-links (600 + trait inset), liens (soulignement 1,5 px `--accent-soft`, décalage 3) ; tâches (cercle 18 px, cochée `--text-3` + coche 12 `--bg-2`, gap 12) ; bloc de code (en-tête 32 px, langue 11.5/500 `--text-3`, mono 13.5/1.65, mots-clés `--accent-text`, chaînes et nombres `--text-2`) ; citation (bg-1, padding 14 18, italique `--text-2`, sans barre) ; rythme de 28 px de la maquette Papier (titre H1 décalé de 10 px, ligne de tags de 28 px, tâches sur 28 px).

**Écarts assumés (maquettes contradictoires ou DESIGN.md plus précis)**
- Marqueur « H1 » : l'écran 02 le place ~11 px au-dessus de la x-height avec un H1 non décalé ; la maquette Papier et DESIGN §3 décalent le H1 de +10 px et §2.14 centre le marqueur sur la x-height. Ursa suit DESIGN + Papier (le marqueur suit le texte), ce qui correspond aussi aux captures 04–09.
- Espacements de l'écran 02 (16 px entre paragraphes, 6 px entre tâches, 10 px sous H2, pastille de tag de 30 px) : non retenus, car ils cassent le rythme de 28 px que fixent DESIGN §6 et la maquette Papier (paragraphes séparés de 28, tâches de 28, pastille de 22).
- Marge haute de la colonne : 56 px (2 unités, maquette Papier B) et non 36 px (écran 02).
- Blocs de code : retour à la ligne au lieu de `white-space: pre` + défilement horizontal (P2-3).
- Bouton Copier des blocs de code : visible au survol ou curseur dans le bloc (DESIGN §2.8), toujours visible dans la maquette statique.
- §2.7 : case à cocher et bouton Copier non atteignables au clavier (Ctrl+Maj+T en ph. 10).
- §2.14 : marqueur de marge pas encore masquable (réglage en ph. 6).

**Observations pour les phases suivantes** (captures 04–09, à respecter le moment venu) : barre de l'éditeur avec fil d'Ariane `icône du tag › sous-tag` et boutons `list-tree` (sommaire), export et `…` ; cartes avec compteur de tâches `☑ 4/7` et miniature 64 px ; sidebar avec tags épinglés en pastilles puis arbre « Tags » ; jetons `@todo` / `#tag` dans la recherche et barre « 3 occurrences ↑ ↓ » ; sommaire flottant à droite ; chevrons de folding et pastille « 7 items · 4 done ».

### Vérification des tokens
Script `npm run check:tokens` (inclus dans `npm run check`) :
- `src/styles/tokens.css` est **identique octet pour octet** à `design/ursa-tokens.css`, lui-même identique au fichier fourni et au bloc CSS de DESIGN.md ;
- les **6 thèmes** (`coral`, `sage`, `ink`, `kraft`, `graphite`, `blue`) sont présents et définissent chacun les 40 tokens de couleur (les thèmes sombres surchargent en plus papier, stickers et post-it) ;
- les 209 variables utilisées dans `src/` sont toutes définies (84 tokens du design, 125 tokens de composants ou locaux) ; aucun token de composant ne redéfinit un token du design, sauf les durées en mouvement réduit (DESIGN §4) ;
- aucune couleur littérale dans le TypeScript (le CSS est couvert par Stylelint).

Rendu des 6 thèmes vérifié visuellement : `docs/captures/phase-2/six-themes.png` (le sélecteur de palette arrive en phase 6).

### Checklist de test manuel (phase 2)
1. Copie `samples/Démo éditeur.md` dans `Documents\Ursa`, ouvre-la : titres avec marqueurs H1–H6 dans la marge, gras/italique/barré/surlignage/code rendus, aucune syntaxe visible.
2. Clique sur une ligne : sa syntaxe apparaît estompée, sans que la ligne bouge verticalement ; clique ailleurs (ou dans la liste) : elle disparaît.
3. Flèches ←/→ sur une ligne avec `**gras**` et `[lien](url)` : le curseur avance caractère par caractère ; ↑/↓ sur plusieurs paragraphes : pas de saut de colonne bizarre.
4. Sélectionne plusieurs lignes rendues (souris et Maj+flèches), Ctrl+C, colle dans le Bloc-notes : c'est le Markdown brut.
5. Clique sur un cercle de tâche : il se coche (texte grisé), Ctrl+Z annule. Dans une liste de tâches, Entrée crée une nouvelle tâche au même niveau ; Entrée sur une tâche vide la remonte d'un niveau ; Retour arrière en début de tâche retire la case et le tiret (1er appui) puis le retrait (2e appui).
6. Bloc de code : survol → bouton Copier ; clique dedans : les ``` apparaissent estompées, la hauteur du bloc ne change pas ; Copier colle bien le code.
7. Ctrl+clic sur le lien Markdown et sur l'URL nue : le navigateur s'ouvre.
8. Ouvre `samples/Note longue (5000 lignes).md` (copie-la aussi), tape au milieu : la frappe reste fluide, le défilement aussi.
9. Menu `…` › Mode machine à écrire : la ligne courante reste centrée en tapant ; l'option est conservée au redémarrage.
10. Les emoji (🐻, 👩🏽‍💻, 🇫🇷) se sélectionnent et s'effacent d'un bloc, sans décalage du curseur.
11. Ouvre `samples/Maquette éditeur.md` à côté de `design/maquettes/02-editeur.png` : même rendu ; curseur sur une ligne avec du `code`, un lien et un `## ` : backticks hors de la pastille, lien sans soulignement, `##` plus léger.
12. Barre de l'éditeur : « Modifié à l'instant » se met à jour en tapant ; menu `…` › Masquer la liste des notes (Ctrl Maj \\) ; en-tête de liste « Modification ⌄ » ouvre le menu de tri.

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
- Une note externe sans frontmatter est lue telle quelle, avec un `id` provisoire en mémoire ; cet `id` est écrit (en tête du frontmatter) à la première écriture par l'app. L'index est toujours indexé par `id`, jamais par chemin.
- Clés inconnues **préservées** ; si aucune clé gérée ne change, le bloc frontmatter est réécrit à l'octet près.
- **Modifié** = mtime du fichier (pas de clé `updated`, évite le bruit à chaque frappe).
- **Titre** = 1re ligne non vide du corps, sans `#`. **Nom de fichier** = titre assaini pour Windows (`<>:"/\|?*`, noms réservés `CON`…, points/espaces finaux, ≤ 120 caractères), collision insensible à la casse → ` 2`, ` 3`…, chemin < MAX_PATH. Renommage 2 s après la dernière frappe et au changement de note ; fichier verrouillé → ancien nom gardé, nouvelle tentative plus tard.
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

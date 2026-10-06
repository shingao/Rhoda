# Ursa — PROGRESS

État : **Phase 8 terminée** (à valider sur Windows) — en attente du « go » pour la phase 9.

| Phase | Sujet | État |
|---|---|---|
| 0 | Cadrage | ✅ fait |
| 1 | Squelette et fichiers | ✅ validée |
| 2 | Éditeur Markdown live | ✅ validée |
| 3 | Tags, liens, todos, sections | ✅ validée |
| 4 | Sommaire, folding, focus de section | ✅ validée |
| 5 | Recherche | ✅ validée |
| 6 | Thèmes, fonds de page, rythme, réglages | ✅ validée |
| 7 | Images, aperçus de liens, PDF | ✅ validée |
| 8 | Stickers et post-it | 🟡 terminée, à valider |
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

## Phase 3 — Tags, liens, tâches, sections

Livrée en sous-étapes : 3a extraction et index (cœur testé), 3b sidebar (sections, pastilles, arbre, sélecteur d'icône), 3c liste (filtres, corbeille, compteur de tâches), 3d éditeur (liens, tags cliquables, autocomplétion, rétroliens, fil d'Ariane).

### Fait
- **Extraction** (`src/core/markdown/extract.ts`, même grammaire Lezer que l'éditeur) : tags, wiki-links (cible, ancre, alias, positions) et tâches `fait/total` de chaque note. Notes indexées à l'ouverture ; au-delà de 50 notes, l'extraction se fait en tâche de fond par lots de 25 (66 ms pour la note de 5 000 lignes, 2 ms pour une note normale).
- **Tags** — cas limites couverts par les tests :
  - reconnus : `#été`, `#japon-2026`, `#voyages/japon-2026`, `#liste de courses#`, `#l'été en famille#` ;
  - ignorés : dans un titre (`# Titre`, `## … #tag`), dans le code (bloc et inline), dans une URL (`https://site.fr/page#ancre`), couleurs hexadécimales (`#FFF`, `#E0654A` — un mot hexa en minuscules sans chiffre, comme `#cafe`, reste un tag), `#` collé à un mot (`C#`, `n°#3`), `#123` ;
  - insensibles à la casse (`#Voyage` = `#voyage`), affichés avec l'orthographe de la **première occurrence** (note la plus ancienne) ;
  - un tag parent compte les notes de ses enfants ;
  - un tag multi-mots ne contient que des lettres, chiffres, espaces, `_ - / '` : « (#idée) — mais pas C# » n'est plus un seul tag.
- **Sidebar** (`features/sidebar/`) :
  - sections Notes, Sans tag, À faire, Aujourd'hui, Épinglées (avec compteurs), Archives, Corbeille (sans compteur) ;
  - tags épinglés en pastilles ; titre « Tags » ; arbre imbriqué repliable (état mémorisé), icône au premier niveau seulement, compteur au survol, au focus et sur l'élément actif ; navigation ↑/↓, ←/→ pour replier, F2 pour renommer ;
  - clic droit sur un tag : Changer l'icône…, Épingler/Désépingler, Renommer… (F2, champ en place), Supprimer le tag… ;
  - **sélecteur d'icône** (maquette 06) : aperçu, recherche (noms + mots-clés Lucide), 9 pastilles de couleur, grille groupée de 8 colonnes, navigation au clavier, « Retirer l'icône », pied « Lucide · 2 122 icônes ».
- **Renommer / supprimer un tag** : confirmation qui annonce le nombre de notes touchées (sous-tags compris), réécriture de toutes les notes concernées (corbeille et archives comprises) par la file sérielle, la note ouverte via une transaction annulable (Ctrl+Z). Supprimer retire `#tag` et ses sous-tags du texte, ainsi qu'une ligne qui ne contenait que des tags. Les réglages du tag (icône, couleur, épingle) suivent le renommage. Toast « N notes mises à jour ».
- **Réglages des tags** dans `.ursa/tags.json` (`{ version: 1, tags: { clé: { icon, color, pinned, collapsed } } }`), écrits 300 ms après un changement.
- **Liste** : titre selon le filtre (section ou `#tag`), compteur de tâches `☑ 4/7` sur les cartes, textes vides par section, menu contextuel selon l'état (Épingler, Archiver, Placer dans la corbeille / Restaurer, Supprimer définitivement…), bouton « Vider la corbeille », Suppr dans la corbeille = suppression définitive (avec confirmation). La suppression définitive envoie le fichier dans la **corbeille du système** (récupérable depuis Windows).
- **Éditeur** :
  - tags : pastille cliquable qui filtre la liste (clic simple hors de la ligne en cours d'édition, Ctrl+clic partout) ; un tag dans un titre reste du texte ;
  - wiki-links : Ctrl+clic ouvre la note (en basculant sur une liste qui la contient si besoin) ; **lien cassé** en `--text-3` + soulignement pointillé ; Ctrl+clic sur un lien cassé → « Créer la note « X » ? » puis création avec ce titre ;
  - aperçu flottant au survol d'un lien (400 ms, DESIGN §3) : titre + début de la note ;
  - **autocomplétion** après `#` (tags du coffre) et après `[[` (titres ; ferme les `]]`), correspondance par sous-chaîne insensible à la casse et aux accents, préfixes en premier ;
  - **rétroliens** : bloc « Mentionnée dans N notes » après la dernière ligne, avec le titre de chaque note et la phrase qui contient le lien (Markdown retiré), cliquable ;
  - **fil d'Ariane** (maquettes 04–09) : premier tag de la note, `icône › sous-tag`, parents en `--text-3`, dernier segment en `--text-2` ; chaque segment filtre la liste ;
  - menu `…` : Épingler, Archiver, Placer dans la corbeille, ou Restaurer / Supprimer définitivement pour une note de la corbeille.
- **Mise à jour des wiki-links au changement de titre** (stratégie de la phase 1) : au point de contrôle du renommage (2 s), par `id`, en gardant alias et ancre ; titre ambigu → rien. Testé : note citée dans 3 autres dont une ouverte dans l'éditeur — réécriture annulable par Ctrl+Z dans celle-ci, écriture directe des deux autres.
- **Architecture** : l'éditeur ne lit jamais le store. `src/editor/hooks.ts` déclare ce dont il a besoin (lien existant ?, ouvrir un lien / un tag / une note, données d'autocomplétion, rétroliens, aperçu) ; `src/app/editorBridge.ts` le branche et redessine l'éditeur seulement quand les titres ou les rétroliens de la note ouverte changent.
- **Vérifié dans la vraie app** (binaire Tauri sous Linux/Xvfb) : chargement de `.ursa/tags.json` (icônes), épinglage écrit dans le fichier, suppression définitive → fichier dans la corbeille du système.
- Tests : **81 Vitest** (dont 55 du cœur : grammaire, extraction, index des tags, réécritures, extraits ; 23 de `notes.ts` : renommage avec liens, tags, filtres, corbeille), **10 Rust**.
- Captures : `docs/captures/phase-3/` (vue générale, filtre par tag, menu et sélecteur d'icône, liens et tags, aperçu, lien cassé, rétroliens, autocomplétion, corbeille, renommage de tag, app réelle).

### Décisions (phase 3)
| # | Sujet | Décision |
|---|---|---|
| P3-1 | Tags dans les titres | Ignorés (ni pastille, ni index), conformément au point 1 du brief. |
| P3-2 | Couleurs hexadécimales | Un mot de 3, 4, 6 ou 8 caractères hexa est une couleur s'il contient un chiffre ou s'il est tout en majuscules ; `#cafe`, `#bed` restent des tags. |
| P3-3 | Orthographe affichée | Celle de la première occurrence, en partant de la note la plus ancienne (date de création). |
| P3-4 | Tags des notes archivées / dans la corbeille | Hors de l'arbre et des compteurs ; mais un renommage ou une suppression de tag les réécrit aussi (sinon le tag réapparaîtrait à la restauration). |
| P3-5 | Tag épinglé | Affiché en pastille et retiré de l'arbre, comme sur la maquette 06 ; s'il a des sous-tags, il reste aussi dans l'arbre pour qu'ils restent accessibles. |
| P3-6 | Compteurs de l'arbre | Visibles au survol, au focus et sur le tag actif (la maquette 06 n'en montre pas au repos). |
| P3-7 | Couleurs des icônes de tags | 8 couleurs (`--tag-color-1…8`, relevées sur la maquette 06) + couleur par défaut ; tokens de composants, identiques dans les 6 thèmes. |
| P3-8 | Grille du sélecteur d'icône | Groupes choisis à la main (voyages et lieux, travail et études, vie quotidienne, nature, divers) ; la recherche couvre toute la bibliothèque Lucide. |
| P3-9 | Suppression définitive | Envoi dans la corbeille du système (crate `trash`) plutôt qu'un effacement : la confirmation le dit. |
| P3-10 | Section « À faire » | Notes ayant au moins une tâche non cochée. « Aujourd'hui » = modifiées aujourd'hui (D14). |
| P3-11 | Résolution d'un lien | Par titre, insensible à la casse ; si plusieurs notes ont ce titre, la plus récemment modifiée gagne. Les notes de la corbeille ne sont pas des cibles. |
| P3-12 | Rétroliens | Bloc en fin de note (pas un panneau) : il défile avec le texte et ne prend pas de place quand il n'y a rien. Une entrée par note source. |
| P3-13 | Autocomplétion | Correspondance par sous-chaîne (la correspondance floue de CodeMirror proposait `#travail/réunions` pour `#vo`). Habillage identique aux menus (§2.13). |
| P3-14 | Clic sur une pastille de tag | Filtre la liste, sauf sur la ligne en cours d'édition (clic = placer le curseur) où il faut Ctrl+clic. |
| P3-15 | Fil d'Ariane | Premier tag du texte (hors titres). Un segment qui n'existe pas dans l'index (note de la corbeille) est affiché mais inactif. |
| P3-16 | Toasts | Message court centré en bas de la fenêtre, 3,5 s (`--toast-duration`), annoncé aux lecteurs d'écran (`role="status"`). DESIGN muet. |

### Comparaison avec les maquettes (phase 3)
Maquettes utilisées : `sélecteur icone de tag.png` (06) pour la sidebar et le sélecteur, `recherche active.png`, `sommaire en overlayflottant.png`, `mode focus.png` pour la barre de l'éditeur et les cartes.

**Conforme** : sections avec icônes et compteurs (Archives et Corbeille sans compteur) ; pastilles des tags épinglés (`--chrome-tag-bg`, icône) ; titre « Tags » ; arbre avec chevrons, icône au premier niveau, enfants en retrait et plus clairs ; sélecteur d'icône (aperçu dans une pastille accent, « Icône de #tag », champ de recherche avec anneau accent, 9 pastilles de couleur, groupes titrés, 8 colonnes, case active cerclée, pied « Retirer l'icône » / « Lucide · N icônes ») ; ligne active de l'arbre cerclée pendant que le sélecteur est ouvert ; fil d'Ariane `✈ voyages › japon-2026` ; méta des cartes `il y a 12 min ☑ 4/7`.

**Écarts** :
- Barre de l'éditeur : boutons `list-tree` (sommaire, ph. 4) et partage/export (ph. 10) pas encore présents.
- Miniature 64 px des cartes : phase 7 (images).
- Le compteur du nombre d'icônes affiche le vrai total de la version embarquée de Lucide (2 122), pas « 1 500 ».
- Aperçu au survol des liens, autocomplétion, rétroliens, toast : pas de maquette ; habillage des menus/popovers (§2.13).

### Problème connu
- ~~Avertissement CodeMirror « Measure loop restarted »~~ : corrigé en phase 4 (voir P4-9).

### Ajout après validation : sauvegarde avant opération en masse
- Avant un **renommage ou une suppression de tag**, une **mise à jour des wiki-links** (changement de titre) ou une **suppression définitive** (une note ou toute la corbeille), les fichiers qui vont changer sont copiés dans `.ursa/backups/<date-heure>-<opération>/` (ex. `2026-10-02_15-04-05-rename-tag/`, chemins relatifs conservés). Le texte non encore écrit de ces notes est sauvegardé d'abord, pour que la copie soit bien l'état précédent.
- **Si la copie échoue, l'opération n'a pas lieu** (toast « Opération abandonnée… ») ; pour les liens, l'ancien titre est gardé et la mise à jour sera retentée au prochain point de contrôle.
- Le toast de fin d'opération propose **« Annuler »** (8 s, minuterie suspendue au survol ou au focus) : les fichiers sont restaurés (une note supprimée est recréée, sans jamais écraser un autre fichier), l'index et l'éditeur sont mis à jour, et les réglages du tag (icône, couleur, épingle) reviennent. Refusé si l'une des notes a été modifiée depuis (« Impossible d'annuler… »).
- Purge automatique au démarrage des sauvegardes de plus de 30 jours (nom horodaté, comparé au texte : pas d'horloge côté Rust).
- Rust : `src-tauri/src/snapshots.rs` (`backup_notes`, `restore_backup`, `purge_backups`, 4 tests) ; TS : `notes.ts` (`backupBefore`, `undoBulk`, `undoAction`, `purgeOldBackups`), 8 tests dans `notes.test.ts`.

### Checklist de test manuel (phase 3)
Copie `samples/*.md` dans `Documents\Ursa` et ajoute quelques notes avec tags (`#voyages/japon-2026`, `#maison`…).
1. Sidebar : les compteurs de Notes / Sans tag / À faire / Aujourd'hui / Épinglées sont justes ; l'arbre montre `voyages › japon-2026`, un clic filtre la liste et le parent compte les notes de ses enfants.
2. Dans `Démo éditeur`, section Tags : seuls `#idée`, `#voyages/japon-2026`, `#été`, `#liste de courses#`, `#Idée` sont en pastille ; `C#`, `#123`, `n°#3`, `#FFF`, `#E0654A`, `` `#code` ``, l'ancre de l'URL et le `#tag` du titre restent du texte. `#Idée` et `#idée` ne font qu'un tag.
3. Tape `#vo` dans une note : la liste propose les tags ; Entrée insère `#voyages `. Tape `[[Voy` : propose les titres ; Entrée insère `[[Voyage au Japon]]`.
4. Ctrl+clic sur un wiki-link : la note s'ouvre. Survole-le 0,5 s : aperçu. Ctrl+clic sur `[[Note qui n'existe pas]]` (grisé, pointillé) : « Créer la note » crée la note et le lien redevient normal.
5. Renomme le titre de `Voyage au Japon` (cité par 3 notes, dont une ouverte à côté) : après 2 s, toast « N liens mis à jour » ; dans la note ouverte qui le cite, Ctrl+Z rétablit l'ancien lien. Le bloc « Mentionnée dans N notes » en bas de la note liste les sources.
6. Clic droit sur un tag › Renommer… (ou F2) : la confirmation annonce le nombre de notes ; après validation, le texte de ces notes est à jour, l'icône suit. Clic droit › Supprimer le tag… : le tag disparaît des notes.
7. Clic droit › Changer l'icône… : choisis une icône et une couleur, ferme, redémarre l'app : elles sont conservées (`.ursa\tags.json`). Clic droit › Épingler : le tag passe en pastille en haut.
8. Clic droit sur une note › Épingler / Archiver / Placer dans la corbeille ; dans Corbeille : Restaurer, puis Supprimer définitivement (confirmation) → le fichier est dans la Corbeille de Windows. « Vider la corbeille » idem pour toutes.
9. Fil d'Ariane de l'éditeur : premier tag de la note avec son icône ; clic sur un segment = filtre.
10. Les cartes affichent `☑ fait/total` pour les notes avec des tâches ; cocher une tâche met le compteur à jour.

## Phase 4 — Sommaire, folding, isolement de section

Livrée en sous-étapes, un commit chacune : 4.0 sauvegardes avant opération en masse (demandé après la validation de la phase 3, décrit plus haut), 4a folding, 4b sommaire, 4c isolement de section, 4d boucle de mesure de CodeMirror.

### Fait
- **Folding des titres** (`src/editor/sections/`) :
  - chevron 18 px à 22 px à gauche de la colonne, visible au survol du titre, toujours visible (fond `--hover`) quand la section est repliée, rotation 160 ms ;
  - une section va jusqu'au prochain titre de même niveau ou supérieur ; les lignes vides de fin restent visibles (l'espacement ne change pas) ; une section vide n'a pas de chevron ;
  - pastille après le titre : « 7 tâches · 4 faites » si la section contient des tâches, sinon « ··· » ; clic = déplier ;
  - les titres viennent de la grammaire partagée : un `#` dans un bloc de code n'est jamais un titre repliable ;
  - **copier** une sélection qui traverse une section repliée copie tout le Markdown (CodeMirror copie le texte du document) ;
  - **curseur** : la zone repliée est atomique, les flèches la sautent ; si le curseur y atterrit (recherche, Ctrl+Z) ou si son texte est modifié (annulation, remplacement, frappe juste après la pastille), la section se déplie ;
  - **supprimer le titre** (ou le fusionner avec la ligne du dessus) déplie le contenu, rien n'est perdu ;
  - la ligne d'un titre replié garde la hauteur du rythme (28 px ; 56 px pour un H1), vérifié au navigateur, pour le fond ligné de la phase 6 ;
  - **clé robuste** : un repli est attaché à la ligne de son titre et suit toutes les modifications, y compris le renommage du titre et le changement de niveau. Les réécritures d'Ursa (tags, liens) ne déplient rien ;
  - **mémorisé par note** dans `.ursa/folds.json`, par texte, niveau et rang du titre : on retrouve le bon titre même si des titres ont été ajoutés avant ou si le titre a été renommé dans un autre éditeur. Restauré à l'ouverture et après un rechargement depuis le disque ;
  - commandes : replier / déplier la section du curseur, tout replier, tout déplier (raccourcis et menu `…`).
- **Sommaire** (`features/outline/`, maquette « sommaire en overlay flottant ») :
  - bouton `list-tree` dans la barre de l'éditeur (actif : fond accent), Ctrl+Maj+O, Échap ou `x` pour fermer ; fermé par défaut, état mémorisé globalement ;
  - titres indentés de 14 px par niveau, premier niveau en 600 `--text` ; section courante (scroll-spy) en `--accent-soft` / `--accent-text` ;
  - **fenêtre large** : la colonne d'écriture se décale vers la gauche (transition 240 ms) et le panneau ne recouvre jamais le texte (mesuré : panneau à 1656 px, texte jusqu'à 1432 px pour une fenêtre de 1920) ; **fenêtre étroite** : overlay flottant avec `--shadow-pop` ;
  - chevrons synchronisés avec l'éditeur (repliés toujours visibles, les autres au survol) ; les titres d'une section repliée disparaissent du sommaire ;
  - **clic sur un titre replié** (ou caché dans une section repliée) : il se déplie, puis défilement doux jusqu'à lui (instantané si « réduire les animations ») ;
  - navigation ↑ / ↓ dans la liste.
- **Isoler une section** (« focus sur cette section ») : Ctrl+Maj+Entrée ou menu `…`. Tout ce qui est hors de la section est masqué ; une barre « Section isolée… Afficher toute la note » la surmonte ; Échap ou le bouton pour sortir. Ctrl+A sélectionne la section seulement. Même robustesse que le folding (suit les modifications et le renommage ; se termine si le titre disparaît, si le curseur sort, ou si du texte masqué est modifié).
- **Préparé pour les phases 5 et 8** : `src/editor/sections/visibility.ts` expose `hiddenRanges`, `isHidden` (folds + isolement) et `revealPosition` (déplie ce qui cache une position, sort de l'isolement si besoin). La recherche s'en servira pour montrer un résultat caché, les stickers pour se masquer quand leur ancre est cachée.
- **Avertissement « Measure loop restarted » corrigé** (voir P4-9) ; en prime, chaque note retrouve sa position de défilement quand on y revient.
- **Rythme** : les lignes H2 faisaient 29 px au lieu de 28 depuis la phase 2 (images `cm-widgetBuffer` de CodeMirror alignées en `text-top`) ; corrigé, tous les titres sont sur le rythme.
- Note d'exemple `samples/Maquette sommaire.md` (contenu de la maquette, avec un bloc de code contenant `# pas un titre`).
- **Vérifié dans la vraie app** (Linux/Xvfb) : suppression d'un tag → `.ursa/backups/2026-10-02_18-41-32-delete-tag/` contient les 2 notes ; « Annuler » → fichiers restaurés, toast « Opération annulée » ; tout replier → `.ursa/folds.json` écrit ; sommaire en overlay sur fenêtre étroite.
- Tests : **112 Vitest** (dont 17 folding / isolement sur `EditorState` réel avec la grammaire : code, copie, curseur, modifications, renommage, suppression du titre, imbrication, section vide ; 5 sur les clés de repli ; 8 sur les sauvegardes), **14 Rust** (dont 4 sur les sauvegardes).
- Captures : `docs/captures/phase-4/` (chevron au survol, sections repliées, tout replié, sommaire large / étroit, clic sur un titre replié, section isolée, menu `…`, toast « Annuler », app réelle).

### Décisions (phase 4)
| # | Sujet | Décision |
|---|---|---|
| P4-0 | Bouton du toast | Bouton texte « Annuler » en `--accent-soft` sur le toast sombre ; le toast dure 8 s quand il propose une action (`--toast-action-duration`), minuterie suspendue au survol et au focus. |
| P4-1 | Étendue d'une section repliée | Jusqu'à la dernière ligne non vide avant le titre suivant de même niveau ou supérieur ; les lignes vides restent visibles. |
| P4-2 | Sections imbriquées | Un repli à l'intérieur d'une section repliée est conservé : en dépliant la section parente, la sous-section reste repliée. |
| P4-3 | Raccourcis | Compatibles AZERTY (pas de `[ ] \` qui demandent AltGr, pas de Ctrl+Alt qui vaut AltGr) : Ctrl+Maj+↑ / ↓ section, Ctrl+Maj+Pg préc / Pg suiv tout, Ctrl+Maj+Entrée isoler, Ctrl+Maj+O sommaire. Déclarés dans `shortcuts.ts` (portée « editor » convertie pour CodeMirror). |
| P4-4 | Persistance des replis | `.ursa/folds.json`, par texte + niveau + rang du titre. Correspondance : même texte et niveau (rang le plus proche) ; sinon même rang et même niveau si ce titre n'est pas réclamé par un autre (renommé ailleurs). Les notes supprimées sont retirées à l'enregistrement. L'isolement n'est pas mémorisé. |
| P4-5 | Sommaire ancré | Ancré (la colonne se décale) dès que l'éditeur a la place de la colonne (660 + 2 × 48) plus le panneau (248 + 16 + 16) ; sinon overlay. Même carte flottante dans les deux cas, comme sur la maquette. |
| P4-6 | Isolement | Barre de 2 unités de rythme au-dessus du titre ; le reste est masqué par des décorations de bloc (lignes entières). |
| P4-7 | Clic sur un titre du sommaire | Défile sans déplacer le curseur ni prendre le focus (on peut parcourir le sommaire au clavier). |
| P4-8 | Réécritures d'Ursa | Mises à jour de tags et de liens marquées `keepFolds` : elles ne déplient pas et ne font pas sortir de l'isolement. |
| P4-9 | « Measure loop restarted » | Cause : pour estimer la hauteur des lignes non affichées, CodeMirror mesure une ligne courte de texte brut à l'écran ; quand c'était une ligne de code (22,3 px) au lieu d'une ligne de texte (28 px), toute l'estimation basculait de 20 % (≈ 140 000 ↔ 112 000 px) et la mesure bouclait. Les lignes de code et les titres Setext portent désormais une marque qui les exclut de l'échantillon. Vérifié : plus aucun avertissement (sauts de défilement, changements de note), la mesure converge en 2 passes. |

### Comparaison avec les maquettes (phase 4)
Maquette : `sommaire en overlayflottant.png` (et DESIGN §2.13, §2.15).

**Conforme** : chevrons à gauche des titres entre le marqueur « H2 » et le texte, chevron `>` sur les sections repliées ; pastille « 7 tâches · 4 faites » et « ··· » en `--bg-sunken` ; panneau 248 px, rayon `--r-xl`, `--bg-raised` + `--shadow-pop`, 8 px sous la barre, 16 px du bord droit ; en-tête « Sommaire » 12/600 `--text-3` + `x` ; titres indentés, premier niveau plus gras ; section courante en `--accent-soft` / `--accent-text` ; chevrons `>` dans le sommaire devant les sections repliées ; bouton `list-tree` actif en fond accent.

**Écarts** :
- Sur fenêtre large, la colonne se décale au lieu d'être recouverte (demande explicite, D6) ; la maquette montre le panneau par-dessus le texte.
- Bouton partage / export de la barre : phase 10.
- Le chevron des sections dépliées n'est pas affiché en permanence dans le sommaire (au survol seulement) : la maquette n'en montre que devant les sections repliées.

### Checklist de test manuel (phase 4)
Copie `samples/Maquette sommaire.md` dans `Documents\Ursa` et ouvre-la.
1. Survole « Avant le départ » : un chevron apparaît à gauche ; clique : la section se replie avec « 7 tâches · 4 faites » ; clic sur la pastille : elle se déplie. Le bloc de code `# pas un titre` n'a jamais de chevron.
2. Replie « Avant le départ », place le curseur sur la ligne du titre, ↓ : le curseur saute la zone repliée. Sélectionne du paragraphe du dessus jusqu'à « Itinéraire », Ctrl+C, colle dans le Bloc-notes : les tâches cachées sont là.
3. Section repliée : renomme son titre, ajoute des lignes au-dessus, passe `##` en `###` : elle reste repliée. Supprime le texte du titre : le contenu réapparaît, intact.
4. Tape un mot dans une section, replie-la (Ctrl+Maj+↑), puis Ctrl+Z : la section se déplie et le mot disparaît.
5. Ctrl+Maj+Pg préc (tout replier), Ctrl+Maj+Pg suiv (tout déplier), Ctrl+Maj+↑ / ↓ dans une section : fonctionnent sur ton clavier AZERTY.
6. Replie deux sections, ferme Ursa, rouvre : elles sont toujours repliées (`.ursa\folds.json`). Renomme un titre replié dans le Bloc-notes : il reste replié à la réouverture.
7. Ctrl+Maj+O : le sommaire s'ouvre. Fenêtre maximisée : la colonne se décale, le panneau ne recouvre aucun texte ; fenêtre étroite : il flotte par-dessus. La section courante se surligne en faisant défiler. L'état ouvert est conservé au redémarrage.
8. Dans le sommaire : clic sur le chevron d'une section = repli/dépli synchronisé avec l'éditeur ; clic sur le titre d'une section repliée = elle se déplie puis défile jusqu'à elle.
9. Ctrl+Maj+Entrée dans « Jour 1 » : seule cette section reste, sous une barre « Section isolée… » ; Ctrl+A ne sélectionne qu'elle ; Échap ou « Afficher toute la note » pour revenir.
10. Ouvre `Note longue (5000 lignes).md`, fais glisser l'ascenseur d'un bout à l'autre, change de note et reviens : défilement fluide, position retrouvée (et, avec les outils de dev ouverts, aucun avertissement « Measure loop »).
11. Sauvegardes : supprime un tag (clic droit), clique « Annuler » dans le toast avant 8 s : les notes retrouvent leur tag ; `.ursa\backups\` contient un dossier `<date-heure>-delete-tag`.

## Phase 5 — Recherche

Livrée en sous-étapes : 5a moteur (cœur testé, banc de 1 000 notes), 5b interface de recherche globale, 5c recherche et remplacement dans la note.

### Fait
- **Moteur** (`src/core/search/`, sans dépendance à React ni à Tauri) :
  - **pliage pour le français** : casse, accents et ligatures ignorés (`ete` trouve « été », `oeuvre` trouve « œuvre », `strasse` trouve « Straße », apostrophes typographiques unifiées), avec une table de correspondance vers le texte d'origine pour surligner exactement ;
  - les **mots** se cherchent en début de mot (`ete` ne trouve pas « complète »), les **phrases** entre guillemets n'importe où ; tous les mots sont requis ;
  - **syntaxe combinable** : `@todo`, `@done`, `@untagged`, `@pinned`, `@today`, `@images`, `@pdf`, `#tag` (un tag parent inclut ses sous-tags, accents ignorés), `"phrase exacte"`, `-mot`, `-"phrase"`, `-#tag`, `-@op` ;
  - **classement** : titre > tag > contenu (cumulé sur les mots), puis récence ; sans mot (opérateurs seuls), l'ordre de tri de la liste ;
  - le **frontmatter n'est jamais cherché** (seuls titre, tags, corps et sources annexes sont indexés) ;
  - **index incrémental** : une entrée par objet note, recalculée seulement quand la note change (frappe, sauvegarde, rechargement par le watcher) ; préchauffé par lots de 50 notes pendant les temps morts, pour que la première frappe soit aussi rapide que les autres ;
  - **sources de texte extensibles** : `registerTextSource({ name, text(note) })` ; l'OCR (phase 9) s'y branchera et ses correspondances s'afficheront avec « Trouvé dans l'image » (déjà prévu sur les cartes et testé avec une fausse source).
- **Recherche globale** (Ctrl+K, maquette « recherche active ») :
  - la liste devient « Résultats N notes » dès la frappe ; cartes avec un **extrait autour de la correspondance** (texte brut, coupé au mot) et les occurrences en `<mark>` `--match`, titre surligné aussi ;
  - opérateurs et tags complets deviennent des **jetons** (opérateur en mono accent, tag en pastille) ; Retour arrière au début sélectionne le dernier jeton, un second le supprime ;
  - **autocomplétion** dans la barre : `@` propose les opérateurs avec leur description, `#` les tags du coffre ;
  - « N résultats » et le bouton effacer dans le champ ;
  - **clavier** : ↑ / ↓ parcourent les résultats (la note s'affiche), **Entrée ouvre** le résultat choisi (ou le premier) avec le focus dans l'éditeur, **Échap vide** la recherche et rend le focus à l'éditeur ;
  - **ouvrir un résultat** surligne toutes les occurrences dans la note, sélectionne la première, la fait défiler au centre et **déplie la section repliée** (ou sort de l'isolement) qui la cache, via `visibility.ts` ; barre « N occurrences ↑ ↓ » dans la barre de l'éditeur pour passer de l'une à l'autre ;
  - **portée** : tout le coffre sauf la corbeille ; les notes archivées apparaissent avec un marqueur « Archivée » ; dans la vue Corbeille, la recherche porte sur la corbeille seulement ;
  - **aucun résultat** : « Aucune note ne correspond à « … » », un conseil, et le bouton « Créer la note « … » ».
- **Dans la note** :
  - **Ctrl+F** : panneau flottant, compteur « 3 / 12 », Entrée / Maj+Entrée, ↑ ↓, Échap ; mêmes règles de casse et d'accents ; part de la sélection, sinon des mots de la recherche globale ; une occurrence cachée dans une section repliée est révélée ;
  - **Ctrl+H** : remplacer (puis passer à la suivante) et **tout remplacer en une seule transaction**, annulable par **un seul Ctrl+Z** (pas d'ouverture des sections repliées) ; toast « N remplacements — Ctrl+Z pour annuler ».
- **Performances** (1 000 notes générées, 2,6 M caractères, `src/dev/generateNotes.ts`) :
  - moteur seul (Vitest) : index construit en 101 ms une fois, puis **3,2 ms en moyenne, 5,9 ms au pire par frappe** (requête + parcours + classement + extraits des cartes visibles) ;
  - interface, build de production dans Chromium, de la touche à l'image affichée : **médiane 22,6 ms, 95e centile 36 ms, pire 46,5 ms**, aucune tâche longue ; pas besoin de worker. Leviers : liste calculée une fois par changement et partagée par le champ et la colonne, `useDeferredValue`, cartes rendues par pages de 30 au défilement.
- **Vérifié dans la vraie app** (Linux/Xvfb) : Ctrl+K « ete », la note « Démo éditeur » s'ouvre sur `#été`, « 1 occurrence ↑ ↓ ».
- Correctif : une occurrence dans une pastille de tag la coupait en deux ; les marques d'occurrence sont maintenant dessinées à l'intérieur des pastilles et des liens.
- Tests : **131 Vitest** (dont 16 sur le moteur et la syntaxe, 4 sur le pliage, 2 bancs de performance, 3 sur la recherche dans la note dont « tout remplacer = un seul Ctrl+Z »), 14 Rust.
- Captures : `docs/captures/phase-5/` (suggestions d'opérateurs, jetons et résultats, résultat ouvert à la correspondance, accents, aucun résultat, résultat dans une section repliée, note archivée, Ctrl+F, Ctrl+H, app réelle).

### Décisions (phase 5)
| # | Sujet | Décision |
|---|---|---|
| P5-1 | Portée | Tout le coffre (hors corbeille) quelle que soit la section ou le tag sélectionné, comme « Résultats » sur la maquette ; `#tag` sert à restreindre. Vue Corbeille : la corbeille seulement. |
| P5-2 | Correspondance des mots | En début de mot (un mot tapé est un préfixe) ; phrases entre guillemets n'importe où. Le texte tapé dans Ctrl+F se cherche n'importe où (comme un éditeur). |
| P5-3 | Classement | Score = somme, pour chaque mot, de sa meilleure place (titre 3, tag 2, contenu 1), puis date de modification. |
| P5-4 | `@done` / `@images` / `@pdf` | `@done` = notes dont toutes les tâches sont faites ; `@images` = image Markdown ou `<img>` ; `@pdf` = lien vers un `.pdf` (union des listes du brief et de DESIGN, D8). |
| P5-5 | Jetons | Un opérateur ou un tag devient un jeton quand on tape l'espace qui le suit ; `@to` en cours de frappe n'est pas cherché comme un mot. |
| P5-6 | ↑ / ↓ dans le champ | Changent la note sélectionnée (l'éditeur l'affiche à sa première occurrence) sans quitter le champ ; Entrée y envoie le focus. |
| P5-7 | Panneau Ctrl+F / Ctrl+H | DESIGN ne décrit que la barre « N occurrences ↑ ↓ » ; le champ de recherche dans la note est une carte flottante sous la barre de l'éditeur (même surface que les popovers), qui remplace la barre tant qu'elle est ouverte. |
| P5-8 | Surlignage dans l'éditeur | Les mots de la recherche globale sont surlignés dans toute note ouverte pendant la recherche ; Ctrl+F prend le relais tant qu'il est ouvert. |
| P5-9 | Liste longue | Cartes rendues par pages de 30 au défilement (virtualisation complète en phase 10). |
| P5-10 | Mesure en production | `VITE_URSA_MOCK=1 npx vite build --outDir …` produit un build de production avec le coffre factice, pour mesurer sans le surcoût du mode développement de React (×7 sur cette page). |
| P5-11 | Retours de validation | Si un tag est sélectionné dans la sidebar quand on commence à taper, la recherche démarre avec le jeton `#tag` correspondant (Retour arrière le retire). L'apostrophe (droite et typographique) et le tiret coupent les mots : `ete` trouve « l'été », `monnaie` « porte-monnaie », `2026` « japon-2026 » (testé). `@done` exclut les notes sans tâche (testé). |

### Comparaison avec la maquette « recherche active »
**Conforme** : champ actif fond `--bg-2` + anneau accent 1,5 px, jetons `@todo` (mono, `--accent-soft`) et `#voyages` (pastille), « N résultats » + `x` ; titre « Résultats » + « N notes » ; extraits avec occurrences `--match` ; occurrence courante dans l'éditeur en `--match` + anneau accent ; barre « N occurrences ↑ ↓ » en `--bg-sunken` dans la barre de l'éditeur.

**Écarts** :
- Résultat OCR (« Found in image » + rectangle sur la miniature) : prévu dans la carte, branché en phases 7 (miniatures) et 9 (OCR).
- Les jetons apparaissent au moment où on tape l'espace qui suit l'opérateur ; un opérateur tapé au milieu du texte puis complété devient aussi un jeton, en fin de liste des jetons.

### À faire en phase 6 (demandé à la validation de la phase 4)
- ~~Réglages › **Sauvegardes**~~ : fait en phase 6 (6d).

### Checklist de test manuel (phase 5)
1. Ctrl+K, tape `kyoto` : la liste devient « Résultats », les cartes montrent un extrait avec « Kyoto » surligné ; les notes dont le titre contient le mot sont en tête.
2. Tape `ete` : « été » est trouvé ; `oeuvre` trouve « œuvre ». `ete` ne trouve pas « complète ». Le contenu du frontmatter (ex. l'`id`) ne donne jamais de résultat.
3. Tape `@to` : la liste d'autocomplétion propose `@todo` / `@today` ; Entrée, puis `#voy` et Entrée : deux jetons ; ajoute `kyoto`. Retour arrière deux fois au début du champ retire le dernier jeton.
4. Essaie `"chemin du philosophe"`, `kyoto -ryokan`, `#voyages` (sous-tags inclus), `@done`, `@untagged`, `@pinned`, `@today`.
5. ↑ / ↓ dans le champ : la note affichée change et défile jusqu'à l'occurrence ; Entrée : le focus passe dans l'éditeur, « N occurrences ↑ ↓ » permet de naviguer. Échap dans le champ : la recherche est vidée, le focus revient à l'éditeur.
6. Replie une section, cherche un mot qui n'est que dans cette section, Entrée : la section se déplie sur l'occurrence.
7. Archive une note puis cherche-la : elle apparaît avec « Archivée ». Mets une note à la corbeille : absente des résultats, présente si tu cherches depuis la vue Corbeille.
8. Cherche `zzzz` : message clair et bouton « Créer la note « zzzz » ».
9. Dans une note : Ctrl+F, tape `KYOTO` → « 1 / 4 », Entrée / Maj+Entrée ; Ctrl+H, remplace une occurrence, puis « Tout remplacer » ; un seul Ctrl+Z dans l'éditeur annule tout le remplacement.
10. Performances : copie 1 000 notes dans le dossier (ou plus), tape dans la recherche : la saisie reste fluide.

## Phase 6 — Thèmes, fonds de page, rythme vertical, réglages

Livrée en sous-étapes : 6a thèmes, 6b rythme vertical, 6c fonds de page, 6d réglages (dossier, sauvegardes), 6e mode focus et infos.

### Fait
- **Thèmes** (6a) : 4 palettes claires (coral, sage, ink, kraft) et 2 sombres (graphite, blue), tokens repris tels quels. Réglage du **mode Clair / Sombre / Système** + **palette claire** + **palette sombre** ; en mode Système, l'app suit Windows en direct (`prefers-color-scheme`).
  - **Pas de flash au démarrage** : `public/theme-boot.js` s'exécute avant les styles et pose le thème mis en cache (`localStorage` `ursa-theme`) ; la fenêtre Tauri est créée cachée et affichée par l'interface une fois le thème appliqué (filet de sécurité côté Rust à 3 s) ; la couleur de fond de la fenêtre et de la WebView suit `--bg-0` du thème.
  - Police d'édition (sans / serif), taille (14 à 20 px par 0,5), largeur de colonne (560 à 860 par 20), marqueurs de titre : appliqués en direct par variables CSS.
- **Rythme vertical** (6b) : sur fond ligné, le haut de chaque ligne de texte tombe sur un multiple de `--rhythm` (28 px), pour les **deux polices** et **toutes les tailles** de 14 à 20 px :
  - blocs de code (lignes mono de 22 px) : hauteur totale, padding compris, **arrondie au multiple de 28 supérieur** (hauteurs mesurées dans le navigateur, la ligne de clôture prend le complément) ;
  - citations (cadre = lignes de texte), séparateurs, listes imbriquées, pastilles de tag (22 px centrées dans la ligne), panneau des rétroliens (en unités de rythme), titres H1–H6 et Setext ; les éléments en ligne (gras, code, liens, emoji) ne changent plus la hauteur de ligne ; les images (phase 7) suivront la même règle ;
  - note de test **`samples/Rythme vertical.md`** (tous les types de blocs, fond ligné + marge) ;
  - **test automatique** `npm run test:rhythm` (`scripts/check-rhythm.mjs`, Playwright) : 2 polices × 13 tailles = 26 passes ; vérifie que chaque ligne commence sur un multiple de 28 **à partir de l'origine du fond de page** (donc sur les réglures), que chaque ligne mesure un multiple de 28 et que chaque bloc (code, citation) a une hauteur multiple de 28. 26/26 (64 lignes, 5 blocs, rétroliens). Un décalage volontaire de 1 px est bien détecté.
- **Fonds de page** (6c) : **uni / lignes / quadrillage / pointillés + marge rouge**, par note dans le frontmatter (`paper: lined`, `margin: true`) et **par défaut dans les réglages** pour les notes sans réglage propre. Changement depuis **… › Fond de page…** (popover de 4 vignettes + interrupteur « Marge rouge », DESIGN §7). Le motif défile avec le texte ; la **marge rouge suit la colonne** (36 px à gauche du texte) quand on change sa largeur ou que le sommaire décale la colonne.
- **Réglages** (6d), Ctrl+, ou … › Réglages… (maquette 09) :
  - **Général** : dossier des notes (chemin, nombre de notes, « Changer… »), thème, palettes claire et sombre (cartes d'aperçu dessinées avec les couleurs de chaque palette), aperçus de liens on/off ;
  - **Éditeur** : police, taille, largeur de colonne (curseur), marqueurs de titre, fond de page par défaut et marge rouge ;
  - **Sauvegardes** : liste de `.ursa/backups/` (opération, date, nombre de notes) avec « Restaurer » ;
  - tout s'applique **en direct, sans redémarrage** ; nouveaux composants : Dialog, Segmented, Stepper, Slider, Select, Toggle.
- **Changement de dossier des notes** : sélecteur de dossier natif, puis **rechargement propre** : tout est enregistré d'abord (si une note ne peut pas l'être, le dossier ne change pas), les réglages de tags et les replis en attente sont écrits dans l'ancien dossier, l'éditeur oublie les notes, l'index, les tags, les replis et la recherche repartent de zéro. Si le nouveau dossier ne s'ouvre pas, l'ancien est rouvert. L'écran d'erreur « Impossible d'ouvrir le dossier des notes » propose maintenant « Choisir un autre dossier… ».
- **Sauvegardes, restauration** : chaque sauvegarde reçoit un `manifest.json` (id, chemin et titre de chaque note, empreinte du texte juste après l'opération). « Restaurer » fait **la même vérification qu'« Annuler »**, même après un redémarrage ; si des notes ont changé depuis, une **confirmation** les nomme ; les versions actuelles sont alors copiées avant (sauvegarde « Avant une restauration »), et le toast propose « Annuler ».
- **Mode focus** (6e), **Ctrl+Maj+F** ou F11 (maquette 03) : barre latérale, liste, barre de titre et barre de l'éditeur s'effacent (240 ms), « Échap pour quitter le mode focus » en haut, nombre de mots et temps de lecture en bas, les paragraphes autres que celui en cours s'estompent. **Échap** quitte (sauf si Échap sert d'abord à fermer un menu, la recherche dans la note…), comme Ctrl+K et l'affichage d'une colonne.
- **Infos de la note** (clic sur « Modifié … » ou … › Infos sur la note) : mots, caractères (avec et sans espaces), temps de lecture (230 mots/min, arrondi à la minute supérieure), dates de création et de modification. Comptage sur le texte tel qu'on le lit (sans marqueurs Markdown, cibles de liens ni URL ; « l'été », « porte-monnaie » = 1 mot).
- **Vérifié dans la vraie app** (Linux/Xvfb) : démarrage, réglages (Ctrl+,), mode focus (Ctrl+Maj+F, Échap).
- Tests : **142 Vitest** (dont restauration depuis les réglages après redémarrage, avec confirmation, sans manifeste, liste des sauvegardes, comptages, empreinte, frontmatter `paper`/`margin`), **15 Rust** (liste / lecture / manifeste des sauvegardes), **26 passes de rythme**.
- Captures : `docs/captures/phase-6/` — 6 thèmes (01–06), 4 fonds de page (07–10), lignes + marge en sombre (11), sélecteur de fond (12), réglages Général / Éditeur / Sauvegardes (13–15), mode focus (16), infos (17), app réelle (18–19).

### Décisions (phase 6)
| # | Sujet | Décision |
|---|---|---|
| P6-1 | Choix du thème | Mode **Clair / Sombre / Système** (segmented) + rangée « Palette claire » (4 cartes) + rangée « Palette sombre » (2 cartes), comme demandé, au lieu de la grille unique de la maquette 09 + case « Suivre Windows ». |
| P6-2 | Démarrage sans flash | Thème mis en cache dans `localStorage` et appliqué par `theme-boot.js` avant le premier rendu ; fenêtre cachée jusqu'à ce que l'interface soit thémée ; fond de fenêtre = `--bg-0`. |
| P6-3 | Taille de police | 14 à 20 px par 0,5 (demande) ; DESIGN §2.17 indique 14 à 22. |
| P6-4 | Cadre des citations | Le fond des citations couvre exactement leurs lignes de texte, sans padding vertical (DESIGN §2.9 : padding 14), sinon le texte ne peut pas rester sur les réglures. |
| P6-5 | Blocs de code | Hauteurs mesurées (la hauteur d'une ligne mono varie avec la taille) ; la ligne de clôture complète jusqu'au multiple de 28. |
| P6-6 | Clés du fond de page | `paper` + `margin` (D1) ; la clé `page:` de DESIGN est aussi lue (`ruled` → lignes, `ruled-margin` → lignes + marge), puis réécrite en `paper`/`margin` au prochain changement. |
| P6-7 | Marqueurs H avec la marge rouge | Placés entre la ligne rouge et le texte (sinon ils la chevauchent). |
| P6-8 | Vignettes du sélecteur | Motifs dessinés à 40 % et marge rouge visible quand elle est active (la maquette n'en montre pas). |
| P6-9 | Mode machine à écrire | Espace haut et bas arrondi à un multiple de 28 pour que les lignes restent sur les réglures. |
| P6-10 | Accès aux réglages | Ctrl+, (titre de la maquette 09) et … › Réglages… ; pages Général, Éditeur, Sauvegardes ; Raccourcis, Import et À propos de la maquette arrivent en phase 10. |
| P6-11 | Restauration d'une sauvegarde | Vérification par `manifest.json` (empreinte non cryptographique du texte, pas le texte). Sauvegardes de la phase 4 sans manifeste : impossible de vérifier, donc toujours une confirmation. Une note recréée par une restauration reste si on annule celle-ci. ~~Les réglages de tag ne sont rétablis que par « Annuler »~~ → corrigé à la validation (voir ci-dessous). |
| P6-12 | Changement de dossier | Les sauvegardes et l'historique d'annulation sont propres à chaque dossier. Aucun changement si une note n'a pas pu être enregistrée. |
| P6-13 | Mode focus | F11 en plus de Ctrl+Maj+F (maquette) ; non mémorisé au redémarrage ; paragraphes non courants à 40 % d'opacité, titres et paragraphe en cours en pleine encre — réglable (voir ci-dessous). |
| P6-14 | Comptages | Calculés sur le texte enregistré : en mode focus, le compteur se met à jour à chaque sauvegarde automatique (0,5 s après une pause de frappe). |
| P6-15 | Dialogues | L'app est inerte derrière une modale ; le toast est rendu au-dessus, pour que « Annuler » reste cliquable pendant que les réglages sont ouverts. |
| P6-16 | Aperçus de liens | Réglage enregistré dès maintenant, utilisé en phase 7. |

### Ajustements après validation
- **« Restaurer » = « Annuler »** : les sauvegardes de renommage et de suppression de tag contiennent `tags.json` (réglages avant l'opération) et le manifeste liste les tags concernés (ancien et nouveau nom). Le toast et Réglages › Sauvegardes rétablissent l'icône, la couleur, l'épingle et le repli de ces tags de la même façon (`restoreTagScopes`, testé), y compris après un redémarrage ; les réglages des autres tags ne bougent pas.
- **Estompage en mode focus** : option Réglages › Éditeur « Estomper les autres paragraphes en mode focus », activée par défaut.

### Comparaison avec les maquettes
- **Réglages (09)** — conforme : fenêtre 860×660, navigation 200 px sur `--bg-1` (item actif blanc + ombre, icône accent), champ du dossier en mono + « Changer… » et nombre de notes, cartes de palette avec miniature et double anneau, police (select) et taille (stepper) côte à côte, curseur de largeur avec « Étroite · 560 / Large · 860 » et la valeur, interrupteur des marqueurs. Écarts : P6-1 (mode + deux rangées), P6-10 (pages), pages et réglages en plus (Sauvegardes, aperçus de liens, fond par défaut).
- **Papier A1–A4** — conforme : réglures à 24 px dans chaque unité de 28, quadrillage de 14, points, marge rouge à 36 px, couleurs dérivées du thème ; popover 288 px, vignettes 52 px, sélection en double anneau, interrupteur, mention en mono. Écarts : P6-8 ; la mention affiche `paper: lined, margin: true` au lieu de `page: ruled-margin` (D1).
- **Mode focus (03)** — conforme : seule la page reste, « Échap pour quitter le mode focus » en haut, « N mots · N min de lecture » en bas, paragraphes non courants estompés, contrôles de fenêtre seuls. Écart : P6-14.
- **Thèmes** : tokens verbatim (`check:tokens` : 6 thèmes, 40 couleurs chacun).

### Checklist de test manuel (phase 6, Windows)
1. Réglages (Ctrl+,) › Thème **Sombre**, ferme puis relance Ursa : aucun éclair blanc, la fenêtre apparaît directement en sombre. Passe en **Système**, puis change le mode de Windows (Paramètres › Personnalisation › Couleurs) : Ursa suit sans redémarrer.
2. Change les palettes claire et sombre, la police (serif), la taille (14 puis 20), la largeur de colonne, les marqueurs de titre : tout s'applique immédiatement.
3. Ouvre « Rythme vertical » (fond ligné + marge) : à 14 px, 16,5 px et 20 px, en sans et en serif, le texte de tous les blocs (code, citations, listes imbriquées, pastilles, séparateurs, rétroliens) reste sur les lignes.
4. … › Fond de page… : essaie les 4 fonds et la marge rouge ; ouvre le `.md` dans le Bloc-notes : `paper:` et `margin:` sont dans le frontmatter. Déplace le curseur de largeur de colonne : la marge rouge suit le texte.
5. Réglages › Éditeur › Fond de page par défaut « Pointillés » : les notes sans fond propre changent, celles qui en ont un le gardent.
6. Réglages › Général › Changer… : choisis un dossier vide, puis reviens au dossier d'origine : notes, icônes de tags et sections repliées sont intactes. Essaie un dossier protégé (ex. `C:\Windows`) : message d'erreur et retour au dossier précédent.
7. Renomme un tag, modifie une des notes concernées, puis Réglages › Sauvegardes › Restaurer : la confirmation nomme la note modifiée ; confirme, puis « Annuler » dans le toast rétablit ta modification. Relance Ursa : la sauvegarde est toujours listée et restaurable.
8. Mode focus (Ctrl+Maj+F ou F11) : tout s'efface sauf la page, le paragraphe en cours reste net, mots et temps de lecture en bas ; Échap quitte. Avec la recherche dans la note ouverte (Ctrl+F), Échap ferme d'abord la recherche.
9. Clique sur « Modifié il y a… » : mots, caractères, temps de lecture et dates ; compare le nombre de mots avec Word sur un texte collé.
10. Mode machine à écrire + fond ligné : en tapant, les lignes restent alignées sur les réglures.

## Phase 7 — Images, aperçus de liens, PDF

Livrée en sous-étapes : 7a images (import, affichage, rythme), 7b sélection, redimensionnement et recadrage, 7c vignettes de la liste, images orphelines et sauvegardes, 7d aperçus de liens, 7e cartes PDF.

### Fait
- **Ajouter une image ou un PDF** :
  - **coller** (capture Win+Maj+S incluse) : si le collage ne contient pas le fichier, Ursa lit l'image du presse-papier système (côté Rust) ;
  - **glisser-déposer** depuis l'Explorateur : insertion à la ligne sous le pointeur ;
  - **… › Insérer une image ou un PDF…** (sélecteur de fichiers).
- **Copie dans `assets/`** :
  - format reconnu d'après le contenu du fichier, pas son nom ;
  - nom propre et unique (`photo-ete.png`, `capture-2026-10-03-143200.png`, puis `-2`…) ;
  - même image ajoutée deux fois (même SHA-256) : le fichier existant est réutilisé.
- **Markdown standard** et chemins relatifs : `![](assets/photo.png){width=420}`, `[devis.pdf](assets/devis.pdf)`, `<assets/mon image.png>` pour les espaces. Les notes restent lisibles ailleurs.
- **Formats** :
  - PNG, JPG, GIF (animé), WebP, SVG ;
  - les SVG sont **toujours affichés par une balise image**, jamais injectés dans la page ; le protocole qui les sert ajoute en plus une politique de sécurité qui interdit les scripts ;
  - HEIC/HEIF : refusé avec un message clair (enregistrer en JPG depuis Photos).
- **Affichage** : une image seule sur sa ligne devient un bloc.
  - Hauteur du **bloc** arrondie au multiple de 28 supérieur, avec l'espace réparti au-dessus et en dessous : l'image n'est **jamais déformée ni rognée**.
  - Chargement paresseux ; tailles lues dans les en-têtes des fichiers pour éviter les sauts à l'ouverture.
  - La ligne sous le curseur montre son Markdown au-dessus de l'image ; ↑ / ↓ y mènent.
- **Sélection** (clic, DESIGN §2.12) :
  - anneau, 4 poignées d'angle et 2 latérales, badge « 560 × 315 · 12 lignes », barre S / M / L / Pleine + Recadrer…
  - **Redimensionnement proportionnel** écrit en `{width=…}`, en une seule transaction : un Ctrl+Z l'annule.
  - Échap désélectionne, Suppr retire l'image, Entrée montre son Markdown.
- **Recadrage non destructif** :
  - dans une fenêtre (cadre à poignées, extérieur assombri) ;
  - la version recadrée est enregistrée **à côté** de l'original (`paysage-recadre.png`) et la note pointe dessus ;
  - `.ursa/crops.json` garde l'original et le cadre, donc un nouveau recadrage repart de l'original et « Rétablir l'original » est toujours possible (annulable).
- **Vignettes de la liste** :
  - première image de la note en 64×64 (DESIGN §2.4) ;
  - générée une fois (128 px) par Rust, hors du fil principal, et gardée dans `.ursa/thumbs/` ;
  - `@images` trouve les images ajoutées (testé).
- **Images orphelines** : à la suppression définitive d'une note, ses fichiers de `assets/` qu'aucune autre note n'utilise (corbeille et archives comprises) :
  - sont copiés dans la sauvegarde, puis envoyés dans la **Corbeille de Windows** ;
  - « Annuler » et Réglages › Sauvegardes › Restaurer les remettent, octet pour octet.
- **Aperçus de liens** : une URL **seule sur sa ligne**, si le réglage est activé, devient une carte (DESIGN §2.10, 4 lignes de rythme).
  - Requêtes **uniquement côté Rust** :
    - http/https sur les ports web ;
    - jamais `localhost`, les noms sans point, `.local` / `.lan` / `.internal` / `.corp` (et `.home.arpa`, `.intranet`…) ;
    - jamais une IP privée, de bouclage, lien-local, CGNAT, réservée, ni une IPv6 locale ou mappée, **vérifié aussi après résolution DNS**, la connexion étant ensuite épinglée sur l'adresse vérifiée ;
    - redirections suivies à la main (3 au plus, chacune revérifiée) ;
    - délai de 5 s, taille limitée (1 Mo de HTML, lecture arrêtée à `</head>` ; image 3 Mo ; favicon 256 Ko) ;
    - sans cookies, sans proxy, sans référent.
  - Titre, description, image OpenGraph et favicon téléchargés dans `.ursa/previews/` (frais 30 jours). Hors ligne : la carte du cache, sinon un lien simple.
  - Menu « … » de la carte : ouvrir, rafraîchir, revenir à un lien simple (écrit `<url>`, qui ne redevient jamais une carte).
- **Cartes PDF** (DESIGN §2.11, 3 lignes) :
  - aperçu de la 1re page dessiné une fois par pdf.js (chargé à la demande) et gardé avec le nombre de pages dans `.ursa/thumbs/` ;
  - « 2 pages · 1,2 Ko » ;
  - un clic ouvre le PDF avec l'application par défaut de Windows.
- **Rythme** : « Rythme vertical.md » contient maintenant des images (large, verticale à 220 px, petite, SVG), une carte de lien et une carte PDF. `test:rhythm` vérifie aussi ces blocs et que les images gardent leurs proportions : 26/26.
- **Mesures** :
  - note de 30 images : défilement par pas de 400 px en 2 images d'écran, aucun bloc hors de la grille ;
  - photo de 24 Mpx (12,9 Mo) : import 83 ms, vignette 0,5 s une seule fois, hors du fil principal, puis 40 µs en cache.
- **Vérifié dans la vraie app** (Linux/Xvfb) :
  - images servies par le protocole `vault:` ;
  - **collage d'une image du presse-papier système** → `assets/capture-…png` + ligne Markdown ;
  - vignettes générées dans `.ursa/thumbs/` ;
  - carte PDF avec sa 1re page ;
  - adresses `http://wiki.corp/…` et `http://192.168.1.20/…` laissées en liens simples sans aucune requête.
- **Pas vérifiable ici** :
  - glisser-déposer depuis l'Explorateur ;
  - ouverture avec l'application Windows ;
  - aperçus de vrais sites : le proxy de ce conteneur bloque la plupart des domaines ; la première requête et la redirection de www.rust-lang.org passent, la cible est bloquée par le conteneur.
  → checklist.
- **Tests** :
  - 154 Vitest (lignes d'image / PDF / URL, chemins, références, orphelins avec « Annuler », `@images`, tailles de fichiers) ;
  - 26 Rust : formats, noms, déduplication, vignettes, protocole, garde-fous réseau dont un nom qui se résout en 127.0.0.1, lecture des métadonnées, restauration binaire ;
  - plus un test réseau réel à lancer à la main.
- Captures : `docs/captures/phase-7/`.

### Décisions (phase 7)
| # | Sujet | Décision |
|---|---|---|
| P7-1 | Où une image devient un bloc | Seule sur sa ligne (avec `{width=…}` éventuel). Une image au milieu d'un paragraphe reste du texte Markdown. Les images distantes (`https://…`) ne sont jamais chargées : la seule requête réseau d'Ursa reste l'aperçu de liens. |
| P7-2 | Arrondi au rythme | Selon ta consigne : espace réparti autour de l'image, jamais de déformation ni de rognage (DESIGN §6 proposait un rognage `object-fit: cover` de 27 px au plus). |
| P7-3 | Noms dans `assets/` | ASCII minuscule, accents repliés, tirets ; collage sans nom : `capture-AAAA-MM-JJ-HHMMSS` ; doublons détectés par SHA-256 parmi les fichiers de `assets/`. Taille maximale 200 Mo. |
| P7-4 | HEIC | Refusé avec un message : aucune conversion simple côté Rust (pas de décodeur HEVC sans bibliothèque C). |
| P7-5 | Collage | Les fichiers de l'événement de collage d'abord ; sinon (WebView sans image dans l'événement) l'image du presse-papier système, encodée en PNG par Rust (`arboard`). |
| P7-6 | Sélection d'une image | Le clic sélectionne sans montrer le Markdown (curseur placé sur la ligne de l'image, pour que Ctrl+Z après un redimensionnement reste sur place). Redimensionnement toujours proportionnel (seule la largeur est stockée) : pas de mode « Maj = libre ». |
| P7-7 | S / M / L / Pleine | Un tiers, la moitié, trois quarts de la colonne ; Pleine = pas de `{width}` (largeur naturelle, au plus la colonne). Badge : dimensions + nombre de lignes de rythme (DESIGN §6). |
| P7-8 | Recadrage | Fenêtre de 760 px ; même format en sortie (PNG, JPG, WebP) ; GIF (animation) et SVG non recadrables ; fichier `<nom>-recadre.<ext>` ; `.ursa/crops.json`. La barre n'a pas encore le bouton OCR (phase 9). |
| P7-9 | Images orphelines | Seulement les fichiers de `assets/`. Toute note (corbeille et archives comprises) qui y fait référence les garde. Un original de recadrage que seule `crops.json` référence n'est pas concerné. |
| P7-10 | Caches | `.ursa/thumbs/` (vignettes et aperçus PDF, nommés d'après chemin + date + taille) n'est pas purgé automatiquement : il se reconstruit. `.ursa/previews/` : cartes non revues depuis 90 jours supprimées à l'ouverture du coffre. |
| P7-11 | Aperçus de liens | Ports 80, 443, 8080, 8443. Proxy système ignoré (il résoudrait les noms lui-même). Carte haute de 4 lignes, chargement = squelette fixe. « Lien simple » = `<url>`. |
| P7-12 | Cartes PDF | ~~Un clic ouvre le PDF~~ → corrigé à la validation : un clic sélectionne la carte (anneau, comme une image), Ctrl+clic ou double-clic l'ouvre. Hauteur 3 lignes. pdf.js 4.x chargé seulement quand une carte en a besoin, sans `eval`. |
| P7-13 | Glisser-déposer | Pas d'indicateur pendant le survol : insertion à la ligne sous le pointeur au lâcher (sur sa ligne si elle est vide, sinon juste après). Le curseur se place sous les blocs insérés. |
| P7-14 | Outils | `npm run sample:images` régénère les images et le PDF d'exemple ; coffre factice : notes « Pièces jointes » et « Aperçus de liens ». |

| P7-15 | Images distantes | Jamais chargées automatiquement : carte « Image distante » (domaine + « Télécharger localement », 2 lignes). Le téléchargement passe par le même `fetch()` Rust que les aperçus (aucune adresse interne, IP vérifiée après DNS, redirections vérifiées), 20 Mo et 30 s au plus, puis import dans `assets/` (dédoublonné) et réécriture du lien (texte alternatif et largeur gardés, annulable). |

### Ajustements après validation
- **PDF** : un clic sélectionne la carte (Échap, Suppr, Entrée comme pour une image) ; Ctrl+clic, double-clic ou le bouton l'ouvre.
- **Images distantes** : carte « Image distante » et téléchargement local protégé (P7-15) ; une adresse du réseau local est refusée avec « adresse interne ou non autorisée » (test Rust).

### Comparaison avec la maquette 02 (éditeur)
**Conforme** :
- image : poignées d'angle et latérales, anneau accent, barre S / M / L / Full au-dessus, badge de taille en bas à droite ;
- carte de lien : domaine + favicon, titre en gras, deux lignes de description, image à droite, fond `--bg-1` ;
- carte PDF : aperçu de la 1re page avec pastille « PDF », nom, « N pages · taille », icône d'ouverture à droite.

**Écarts** :
- pas de bouton OCR dans la barre (phase 9), bouton Recadrer ajouté ;
- le badge ajoute le nombre de lignes ;
- la carte de lien a un menu « … » au survol (rafraîchir, lien simple), non dessiné sur la maquette.

### Checklist de test manuel (phase 7, Windows)
1. **Capture d'écran** : Win+Maj+S, puis Ctrl+V dans une note. L'image apparaît, `assets/capture-….png` est créé et la ligne `![](assets/capture-….png)` est lisible dans le Bloc-notes. Recolle la même capture : aucun nouveau fichier.
2. Glisse depuis l'Explorateur une PNG, une JPG et un **GIF animé** : chacun s'insère à la ligne visée, le GIF s'anime. Glisse à nouveau la même image : le fichier existant est réutilisé.
3. **Image de 20 Mo** : l'insertion est rapide, le défilement reste fluide, la vignette apparaît dans la liste.
4. **SVG** : il s'affiche. Crée un SVG contenant `<script>alert(1)</script>` et glisse-le : aucune alerte ne s'ouvre.
5. Une photo **HEIC** d'iPhone : message clair, rien n'est inséré.
6. **Redimensionnement** sur fond ligné :
   - aux poignées : proportions gardées, `{width=…}` écrit, un seul Ctrl+Z annule ;
   - avec S / M / L / Pleine : le texte autour reste sur les lignes.
7. **Recadrer…** : l'original reste dans `assets/` et `…-recadre.png` apparaît à côté. Recadrer à nouveau repart de l'original ; « Rétablir l'original » fonctionne.
8. **Note de 30 images** : ouverture et défilement fluides, tout reste sur les lignes.
9. **Suppression définitive** d'une note qui a une image à elle seule et une image partagée avec une autre note :
   - l'image à elle seule part dans la Corbeille de Windows, la partagée reste ;
   - « Annuler » ramène la note et son image.
10. **Aperçus de liens** :
    - colle `https://fr.wikipedia.org/wiki/Ours_brun` seul sur une ligne : une carte apparaît, avec un menu Rafraîchir / Revenir à un lien simple ;
    - les **URL d'intranet** `http://intranet/`, `http://192.168.1.1/`, `http://nas.local/` restent des liens simples, et `.ursa/previews/` ne reçoit rien pour elles ;
    - hors ligne, la carte s'affiche depuis le cache ;
    - réglage désactivé : plus aucune carte.
11. **PDF** : glisse un PDF : la carte montre sa 1re page et son nombre de pages, et un clic l'ouvre dans le lecteur par défaut.

## Phase 8 — Stickers et post-it

Livrée en sous-étapes : 8a modèle, ancrage et recherche ; 8b calque et annulation ; 8c tiroir ; 8d post-it ; 8e visibilité, fenêtre étroite, licences, orphelins, duplication, finitions.

### Fait
- **Modèle** (`src/core/stickers.ts`) :
  - stockés dans le frontmatter `stickers:` : `id`, `type` (`sticker` | `postit`), `asset`, `text`, `color`, `collapsed`, `anchor { block, text, index }`, `dx`, `dy`, `rotation`, `size`, `z` ;
  - entrées mal formées ignorées, nombres ramenés dans leurs bornes ;
  - texte multi-ligne de post-it écrit en bloc YAML (`|-`), testé avec guillemets, deux-points, sauts de ligne, emoji, `#` et tirets.
- **Ancrage robuste**, même stratégie que les replis :
  - la clé du bloc est son type, le début normalisé de son texte et son rang ;
  - la résolution essaie dans l'ordre : même type et même texte au rang le plus proche ; même texte ; texte retouché (même début) ; même rang ; bloc le plus proche ;
  - un sticker n'est jamais perdu, même si la note est modifiée dans un autre éditeur ou vidée ;
  - `dx` est en % de la largeur de colonne, `dy` en px depuis le haut du bloc.
- **Dans l'éditeur** (`src/editor/stickers/`) :
  - `state.ts` :
    - les stickers sont dans l'état CodeMirror, ancrés au début de ligne de leur bloc et suivis à chaque frappe ;
    - poser, déplacer, tourner, redimensionner, supprimer, recolorer ou modifier un post-it sont des effets inversibles, annulés par **Ctrl+Z / Ctrl+Y dans le même historique que le texte** ;
    - les clés d'ancrage sont recalculées à chaque sauvegarde de la note ;
    - un rechargement depuis le disque n'entre pas dans l'historique.
  - `layer.ts` :
    - calque absolu dans le défilement de la note, coupé sur les côtés, pointeur seulement sur les stickers ;
    - survol et sélection : cadre pointillé, 4 poignées, poignée de rotation, badge d'angle (Maj = pas de 15°), ombre levée et ×1,06 au glisser ;
    - clavier : flèches (Maj = 10 px), `[` `]`, Suppr, Échap, menu contextuel ;
    - ordre d'affichage : post-it au-dessus des stickers ;
    - menu : Premier plan / Arrière-plan / Dupliquer / Couleur / Supprimer.
  - `postit.ts` :
    - Caveat 500 22/28, 4 couleurs, ombre « papier collé », coin ombré, scotch ;
    - barre au survol gardée horizontale (couleurs, Replier, Supprimer) ;
    - édition en place (double-clic, Entrée, ou dès la pose) ;
    - pastille repliée (clic = déplier).
- **Tiroir** (`src/features/stickers/`, Ctrl+Maj+S ou bouton de la barre) :
  - catalogue de **209 Fluent Emoji 3D** en WebP 256 px (≈ 1,4 Mo), mots-clés fr/en ;
  - catégories Récents / Nature / Cuisine / Voyage / Objets / Les miens, recherche insensible aux accents ;
  - post-it, « Importer une image… » ;
  - clic = pose au centre de la note ; glisser = pose à l'endroit lâché (fantôme 70 %) ;
  - fichier de l'Explorateur déposé tiroir ouvert = sticker.
- **Stickers importés** :
  - PNG / WebP / SVG copiés dans `assets/stickers/` et dédoublonnés par SHA-256 (Rust `import_stickers`, `list_stickers`) ;
  - SVG toujours via `<img>` ;
  - comptés comme pièces jointes : orphelins à la Corbeille Windows lors d'une suppression définitive, inclus dans la sauvegarde, rendus par « Annuler ».
- **Visibilité** :
  - bouton œil et Ctrl+Maj+H « Masquer les stickers », mémorisé par note dans `.ursa/view.json` ;
  - Alt maintenu : transparents et clics vers le texte ;
  - masqués dans une section repliée ou hors de la section isolée (`visibility.ts`) ;
  - Réglages › Éditeur : « Afficher les décorations », « Masquer les décorations en mode focus ».
- **Fenêtre étroite** : les stickers des marges se rangent contre le bord et rétrécissent pour tenir dans la marge au lieu de recouvrir le texte. C'est un simple affichage : ils reprennent leur place quand la fenêtre s'élargit.
- **Recherche** : le texte des post-it est indexé (source de texte `postit`) ; la carte du résultat porte « Trouvé dans un post-it ».
- **Dupliquer une note** (menu de la liste et « … » de l'éditeur) : même texte et même frontmatter, nouvel `id`, nouvelle date de création, non épinglée, stickers copiés avec de nouveaux id.
- **Réglages › À propos** : version, confidentialité, licences tierces avec les textes complets (MIT de Fluent Emoji, OFL des polices, ISC, Apache 2.0).
- **Tests** :
  - Vitest 176 (modèle, ancrage, YAML, historique, fenêtre étroite, sauvegarde, orphelins, duplication) ; Rust 28 (+1 ignoré, réseau réel) ;
  - `test:rhythm` 26/26 avec 2 stickers et 2 post-it sur « Rythme vertical » (le script vérifie leur présence).
- **Performance**, note de 120 paragraphes avec 50 stickers et post-it (navigateur, coffre factice) :
  - frappe : 16,7 ms médiane (une image), 22 ms au pire ;
  - défilement : 16,7 ms médiane, 19 ms au 95e centile ;
  - fichier : 25 Ko.
- Notes d'exemple : « Mardi 2 octobre » (`samples/Journal décoré.md`, la page journal de la maquette B) et « Rythme vertical » décorée.

### Décisions (phase 8)
| # | Sujet | Décision |
|---|---|---|
| P8-1 | Taille | Clé `size` (largeur en px : stickers 40–200, post-it 120–240) plutôt que `scale` du brief, plus lisible et bornée par DESIGN. Un champ `z` garde l'ordre d'empilement. |
| P8-2 | Rang de bloc | Un titre, une règle, une image ou une carte sont un bloc chacun ; un paragraphe, une citation, un tableau ou un bloc de code sont un bloc ; **chaque élément de liste est un bloc** (un sticker posé à côté d'une tâche suit cette tâche). |
| P8-3 | Ancre en mémoire | Début de la ligne du bloc, suivi à chaque modification ; la clé (type, texte, rang) n'est recalculée qu'à la sauvegarde, pour ne pas coûter à chaque frappe. Si deux paragraphes fusionnent, le sticker suit le bloc qui les contient. |
| P8-4 | Glisser depuis le tiroir | Fait aux évènements de pointeur, pas en glisser-déposer HTML : sous Windows, le dépôt de fichiers natif de Tauri bloque le glisser-déposer HTML dans la WebView. |
| P8-5 | Fichier déposé | Tiroir ouvert : un fichier image déposé devient un sticker. Tiroir fermé : il reste une image dans le texte (phase 7). |
| P8-6 | Post-it | Pas de poignée de rotation (rotation ±3° à la pose, `[` `]` au clavier) ; redimensionnement aux angles. Le scotch est présent sur environ la moitié des post-it, incliné de −4° ou +3°, choisi d'après leur id (stable). Une édition en cours est enregistrée dans sa note avant l'affichage d'une autre. |
| P8-7 | Mode focus | Option « Masquer les décorations en mode focus » **désactivée par défaut** (les stickers font partie de la note) ; « Afficher les décorations » les masque partout. |
| P8-8 | Fenêtre étroite | Seuls les stickers posés entièrement dans une marge se rangent ; ceux posés sur le texte restent où l'utilisateur les a mis. Réduction jusqu'à 40 % (`--sticker-fit-min`), à 8 px du bord, et jamais sous le panneau Sommaire ancré. |
| P8-9 | Alt | Alt seul (pas AltGr, indispensable pour taper `#`, `@` ou `[` sur AZERTY). |
| P8-10 | Raccourcis | Ctrl+Maj+S tiroir (DESIGN), Ctrl+Maj+H masquer : S et H sont au même endroit en AZERTY et QWERTY. |
| P8-11 | Orphelins | Une image de « Les miens » utilisée seulement par les notes supprimées définitivement part à la Corbeille avec elles (et revient avec « Annuler » ou Réglages › Sauvegardes). Une image de « Les miens » utilisée par aucune note reste dans la bibliothèque. |
| P8-12 | Catalogue | 209 emoji : Nature 55, Cuisine 54, Voyage 50, Objets 50 ; identifiant `fluent/<nom Fluent>` (ex. `fluent/hot_beverage`) ; source : paquet `@lobehub/fluent-emoji-3d` (MIT), copié tel quel. |
| P8-13 | Récents | 16 derniers stickers posés, dans les réglages de l'app (pas dans le coffre) ; les images importées d'un autre coffre n'y apparaissent pas. |

### Comparaison avec la maquette « Paper and Stickers » (B1, B2, C)
Captures : `docs/captures/phase-8/` — 01 et 02 page journal claire (coral, tiroir ouvert et sticker survolé, comme B1), 03 et 04 page journal sombre (graphite, post-it survolé, comme B2), 05 à 15 états, fenêtre étroite, recherche, réglages. Le canevas HTML de la maquette ne se rend pas hors ligne (moteur de gabarit distant) : comparaison faite sur ses cotes et les PNG fournis.

**Conforme** :
- fond ligné, marge rouge, café à droite du titre, feuille dans la marge gauche à hauteur de « Petites choses », étincelles en bas à droite ;
- post-it jaune scotché (« Samedi — marché d'Aligre… ») et post-it rose ;
- tiroir : place et taille, titre, recherche, puces, grille 4 colonnes de 68 px, carrés post-it inclinés, pied « Importer une image… » et texte d'aide ;
- états : cadre pointillé et poignées, tige de rotation, badge « −2° » sombre sous le sticker, barre du post-it (pastilles, double anneau, Replier, Supprimer), anneau d'édition, pastille repliée.

**Écarts** :
- la maquette aligne la colonne à 160 px du bord ; Ursa la centre (réglage existant) : les stickers gardent leur position par rapport à la colonne ;
- les puces françaises (Récents… Les miens) tiennent sur deux lignes dans 320 px (une en anglais, comme la maquette) ;
- le bouton œil (masquer les stickers) est en plus dans la barre de l'éditeur, visible seulement si la note a des stickers ;
- dans une fenêtre très étroite, les post-it rangés deviennent petits (jusqu'à 40 %) : leur texte n'est lisible qu'en élargissant la fenêtre, en masquant la liste ou en les déplaçant.

### Checklist de test manuel (phase 8, Windows)
1. Ouvre « Mardi 2 octobre » : la page ressemble à la maquette. Ctrl+Maj+S ouvre le tiroir, Échap le ferme.
2. **Poser et annuler** :
   - clique un sticker, puis glisse-en un autre sur la note : chacun est posé incliné ;
   - déplace-en un, tourne-le (Maj = 15°), redimensionne-le, supprime-le (Suppr) ;
   - Ctrl+Z annule chaque étape dans l'ordre, intercalée avec la frappe ; Ctrl+Y rétablit.
3. **Post-it** :
   - clique un carré jaune : le post-it s'ouvre en édition. Tape `Dit : "oui"`, Entrée, `2e ligne 🌻`, Échap ;
   - ouvre le `.md` dans le Bloc-notes : le texte est intact dans le frontmatter et le Markdown sous le frontmatter est inchangé ;
   - change sa couleur, replie-le, déplie-le ; Ctrl+Z annule chaque étape.
4. **Ancrage** : dans le Bloc-notes, ajoute des paragraphes au-dessus de « Petites choses » et modifie un mot du titre, puis enregistre. Dans Ursa, chaque sticker reste à côté de son bloc. Supprime le bloc d'un sticker : le sticker passe au bloc le plus proche, il n'est pas perdu.
5. **Les miens** :
   - « Importer une image… » avec une PNG et une SVG : elles apparaissent dans « Les miens » et dans `assets/stickers/`. Réimporte la même : pas de doublon ;
   - tiroir ouvert, glisse une PNG depuis l'Explorateur sur la note : elle devient un sticker à cet endroit.
6. **Visibilité** :
   - Ctrl+Maj+H masque les stickers de cette note seulement, et l'état est retrouvé au redémarrage ;
   - maintiens Alt : les stickers deviennent transparents et un clic place le curseur dans le texte dessous ;
   - AltGr+3 tape toujours `#` ;
   - replie une section : ses stickers disparaissent.
7. **Fenêtre étroite** : réduis la fenêtre avec la liste ouverte. Les post-it de droite se rangent contre le bord, plus petits, sans couvrir le texte. Élargis : ils reviennent.
8. **Recherche** : cherche un mot d'un post-it. La carte du résultat indique « Trouvé dans un post-it ».
9. **Dupliquer** la note (clic droit dans la liste) : la copie a ses stickers, avec de nouveaux `id` dans le frontmatter. Supprime définitivement une note qui utilise seule une image de « Les miens » : l'image va à la Corbeille Windows et « Annuler » la ramène.
10. **Performance** : sur une note avec une cinquantaine de stickers, la frappe et le défilement restent fluides. Réglages › À propos montre les licences (Fluent Emoji MIT, Caveat OFL).

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
| `backups/<date-heure>-<opération>/` | 4, 6 | copies avant opération en masse + `manifest.json` (purge à 30 jours) |
| `thumbs/` | 7 | vignettes 128 px des images et aperçus des PDF (reconstructibles) |
| `previews/` | 7 | cartes d'aperçu de liens : `meta.json`, image, favicon (30 jours) |
| `crops.json` | 7 | recadrages : original et cadre de chaque version recadrée |
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
| D6 | Sommaire | colonne décalée sur grand écran, overlay sur petit | toujours overlay, colonne immobile (§2.15) | **[Brief]** : décalage si la place le permet, overlay sinon (fait en phase 4, P4-5). |
| D7 | Palettes sombres | 4 palettes en clair **et** sombre | 4 claires + 2 sombres (`graphite`, `blue`) | Tranché à la validation de la phase 5 : mode Clair / Sombre / Système + palette claire (4) + palette sombre (2) (P6-1). |
| D8 | Opérateurs de recherche | + `@pinned` | + `@pdf` | Union des deux. |
| D9 | Raccourcis de folding | Ctrl+K = recherche | « tout replier » = Ctrl K Ctrl 0 / J ; section = Ctrl Shift [ / ] | Remplacé en phase 4 (P4-3) : `[ ] \` demandent AltGr sur AZERTY et Ctrl+Alt = AltGr. Section : Ctrl+Maj+↑ / ↓ ; tout : Ctrl+Maj+Pg préc / Pg suiv ; isoler : Ctrl+Maj+Entrée ; sommaire : Ctrl+Maj+O. |
| D10 | Contrôles fenêtre et recherche de la titlebar | — | icônes en `--text`, recherche en `--bg-sunken` (§2.1, 2.3) | Sur `--bg-0` foncé (coral, ink), `--text` est illisible → `--chrome-text` et `--chrome-sunken`, comme l'indique la famille `--chrome-*` (§1). |
| D11 | Token de rythme | `--baseline` | `--rhythm` | **[DESIGN]** `--rhythm`. |
| D12 | Ctrl+U | souligné | — (pas de souligné en Markdown) | `<u>…</u>` rendu souligné, balises masquées comme la syntaxe. À confirmer en ph. 10. |
| D13 | Export image | JPG/PNG | tuile « JPG » | Tuile « Image » + segmented JPG/PNG. |
| D14 | Section Today | — | — | Notes **modifiées** aujourd'hui (comportement Bear). |
| D15 | Sizes en dur | « aucune taille en dur » | specs composants en px non tokenisées | Tokens de composants dans `tokens.components.css`, chaque valeur tracée vers sa section DESIGN.md. |

## Écarts avec le design
- Aucun pour l'instant (pas encore d'UI). Maquettes PNG manquantes : comparaison impossible tant qu'elles ne sont pas dans `design/`.

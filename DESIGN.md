# Ursa — DESIGN.md

Spécification visuelle pour l'implémentation (Tauri + React + CodeMirror 6, Windows).
Maquettes de référence : `Ursa Main.dc.html` (vue principale, props `theme` / `mode`), `Ursa Themes.dc.html` (palettes), `Ursa Screens.dc.html` (écrans 2–9), `Ursa Paper and Stickers.dc.html` (fonds de page, stickers, post-it).
Direction retenue : **1b « Atelier »** — barre de titre unifiée, recherche centrale, liste + éditeur posés sur une « feuille » arrondie au‑dessus du fond de l'app.

Principes :
- **Hiérarchie des surfaces** : `--bg-0` (titlebar + sidebar) est la plus foncée / colorée, `--bg-1` (liste) intermédiaire, `--bg-2` (éditeur) la plus claire, la « feuille de papier ». Pas de bordures entre zones. Seule exception : `--separator` (hairline très faible) dans les palettes/tables.
- **Une seule couleur d'accent**, réservée aux **tags, liens, sélection (item actif, focus, occurrences) et bouton principal**, plus les marqueurs de marge H1–H6 (décoratifs). Titres H2 en couleur de texte ; cases cochées en `--text-3`.
- Calme : peu de chrome, icônes Lucide 15–17 px en `--text-2`, beaucoup d'air.
- Toutes les valeurs ci‑dessous proviennent de variables CSS. Ne jamais coder une couleur en dur hors de `ursa-tokens.css` (exceptions : bouton Fermer Windows `#C42B1C`, poignée blanche des toggles/sliders `#FFFFFF`).

---

## 1. Design tokens

Fichier unique à importer en premier : `src/styles/tokens.css` (copie de `ursa-tokens.css`). Le thème s'applique avec `document.documentElement.dataset.theme = "coral" | "sage" | "ink" | "kraft" | "graphite" | "blue"`.

| Palette | id | Sidebar `--bg-0` | Liste `--bg-1` | Éditeur `--bg-2` | Texte | Accent |
|---|---|---|---|---|---|---|
| Graphite & corail (défaut) | `coral` | #2A2826 | #F3EFE9 | #FFFDF9 | #2B2622 | #E0654A |
| Sauge & terracotta | `sage` | #D9E0D2 | #EEF1E9 | #FCFCF8 | #26302A | #B5543A |
| Encre & papier | `ink` | #1E2A3C | #F2F0EB | #FFFDF7 | #1F2733 | #D9573F |
| Kraft & lavande | `kraft` | #E4DCCB | #F2EDE3 | #FFFDFA | #2E2A33 | #7C5CB0 |
| Sombre graphite | `graphite` | #18181A | #212123 | #2A2A2D | #EBE8E3 | #EE7A63 |
| Sombre bleuté | `blue` | #121720 | #192029 | #202834 | #E5E9EF | #F07D67 |

La titlebar et la sidebar utilisent la famille `--chrome-*` (texte, survol, item actif, champ de recherche, pastilles de tags épinglés) : sur une sidebar foncée (`coral`, `ink`) le texte y est clair alors que le reste de l'interface reste sombre sur clair. Un accent vif comme `#E0654A` n'atteint pas 4.5:1 sur fond clair : il sert aux icônes, fonds et anneaux ; le texte coloré utilise `--accent-text` et le bouton principal `--accent-solid`.
Anciens thèmes `warm` / `neutral` : supprimés (remplacés par `coral` / `ink`).

Polices : embarquer localement (app hors ligne) **Hanken Grotesk** (400/500/600/700 + 400 italic), **JetBrains Mono** (400/500), **Newsreader** (400/600, option « serif » de l'éditeur) en `woff2` via `@font-face` avec `font-display: swap`. Les fallbacks Windows (`Segoe UI Variable`, `Cascadia Code`, `Consolas`, `Cambria`) prennent le relais.

```css
/* Ursa — design tokens. Default palette = coral (Graphite & corail). */
:root {
  /* Typography */
  --font-ui: "Hanken Grotesk", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-editor: "Hanken Grotesk", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-editor-serif: "Newsreader", "Cambria", "Georgia", serif;
  --font-mono: "JetBrains Mono", "Cascadia Code", "Cascadia Mono", Consolas, monospace;
  --font-hand: "Caveat", "Ink Free", "Segoe Print", cursive;

  --fs-2xs: 11px;  --fs-xs: 12px;  --fs-sm: 13px;  --fs-md: 14px;
  --fs-lg: 15px;   --fs-xl: 17px;  --fs-2xl: 20px;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600; --fw-bold: 700;
  --lh-tight: 1.2; --lh-snug: 1.35; --lh-ui: 1.45;

  /* Editor — strict vertical rhythm on a 28px baseline grid */
  --rhythm: 28px;                 /* = line-height of every editor line */
  --editor-fs: 16.5px;            /* user setting: 14–20px; rhythm stays 28px */
  --editor-lh: var(--rhythm);
  --h1-fs: 33px; --h1-lh: 56px;   /* 2 rhythm units */
  --h2-fs: 23px; --h2-lh: 28px;
  --h3-fs: 19px; --h3-lh: 28px;
  --h4-fs: 17px; --h4-lh: 28px;

  /* Spacing (4px scale) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px; --sp-7: 28px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px; --sp-16: 64px;

  /* Radii */
  --r-xs: 3px; --r-sm: 5px; --r-md: 7px; --r-lg: 10px; --r-xl: 12px; --r-pill: 999px;

  /* Motion */
  --dur-instant: 60ms; --dur-fast: 100ms; --dur-base: 160ms; --dur-slow: 240ms;
  --ease-out: cubic-bezier(.2, .7, .2, 1);
  --ease-in-out: cubic-bezier(.4, 0, .2, 1);
  --ease-in: cubic-bezier(.4, 0, 1, 1);

  /* Layout */
  --titlebar-h: 46px;
  --sidebar-w: 232px; --sidebar-min: 180px; --sidebar-max: 320px;
  --list-w: 340px;    --list-min: 260px;    --list-max: 480px;
  --outline-w: 248px;                       /* floating overlay */
  --editor-max: 660px;                      /* user setting: 560–860px */
  --editor-pad-x: 48px;
  --syntax-opacity: .38;

  /* Page backgrounds (per note) */
  --paper-pitch: var(--rhythm);   /* ruled + dots */
  --paper-grid: 14px;             /* grid = half rhythm */
  --paper-rule-y: 24px;           /* rule position inside each 28px line box */
  --paper-margin-x: 36px;         /* red margin: distance left of the text column */
  --paper-line: color-mix(in oklab, var(--text) 9%, transparent);
  --paper-grid-line: color-mix(in oklab, var(--text) 6%, transparent);
  --paper-dot: color-mix(in oklab, var(--text) 24%, transparent);
  --paper-margin: color-mix(in oklab, #D9573F 42%, transparent);

  /* Stickers & sticky notes */
  --sticker-shadow: drop-shadow(0 1px 1px rgba(40, 25, 10, .14)) drop-shadow(0 5px 7px rgba(40, 25, 10, .16));
  --sticker-shadow-lift: drop-shadow(0 2px 2px rgba(40, 25, 10, .14)) drop-shadow(0 12px 14px rgba(40, 25, 10, .22));
  --postit-yellow: #FBEBA0; --postit-pink: #F8D2DC; --postit-green: #D3EBC8; --postit-blue: #CFE2F5;
  --postit-text: #3B342B;
  --postit-shadow: 0 1px 1px rgba(60, 40, 10, .10), 0 12px 14px -9px rgba(60, 40, 10, .38);
  --postit-tape: rgba(255, 255, 255, .55);
}

/* Palette definitions.
   bg-0 = chrome (titlebar + sidebar, darkest / most coloured)
   bg-1 = note list (intermediate)
   bg-2 = editor ("sheet of paper", lightest)               */

:root, [data-theme="coral"] {
  color-scheme: light;
  --bg-0: #2A2826;  --bg-1: #F3EFE9;  --bg-2: #FFFDF9;
  --bg-raised: #FFFDF9; --bg-sunken: #E8E2D9; --bg-code: #F5F1EA;
  --chrome-text: #E8E2DA; --chrome-text-2: #9A928A; --chrome-text-3: #9A928A;
  --chrome-hover: rgba(255, 255, 255, .05); --chrome-active: #3A3632; --chrome-active-shadow: none;
  --chrome-sunken: #36332F; --chrome-icon-active: #E0654A;
  --chrome-tag-bg: #4A342D; --chrome-tag-text: #F2A48F;
  --hover: rgba(70, 50, 30, .06); --active: rgba(70, 50, 30, .11); --selected: #FFFDF9;
  --text: #2B2622; --text-2: #5F574F; --text-3: #6B6259; --text-faint: #ADA49A;
  --accent: #E0654A; --accent-hover: #C9563C; --accent-text: #B23F27; --accent-solid: #C24A30;
  --accent-soft: #FBE2DA; --on-accent: #FFFFFF;
  --selection: rgba(224, 101, 74, .2);
  --highlight: #F8E7B2; --match: #F9D0C2;
  --danger: #B8321F; --danger-soft: #F8DEDA;
  --focus-ring: #C24A30;
  --separator: rgba(70, 50, 30, .08);
  --scrim: rgba(30, 24, 18, .32);
  --shadow-card: 0 1px 3px rgba(70, 45, 20, .08);
  --shadow-sheet: 0 0 0 1px rgba(0, 0, 0, .06), 0 2px 18px rgba(0, 0, 0, .22);
  --shadow-pop: 0 0 0 1px rgba(70, 45, 20, .07), 0 12px 32px rgba(70, 45, 20, .16);
}

[data-theme="sage"] {
  color-scheme: light;
  --bg-0: #D9E0D2;  --bg-1: #EEF1E9;  --bg-2: #FCFCF8;
  --bg-raised: #FCFCF8; --bg-sunken: #E2E7DB; --bg-code: #F1F3EC;
  --chrome-text: #26302A; --chrome-text-2: #4A564D; --chrome-text-3: #4A564D;
  --chrome-hover: rgba(30, 50, 35, .06); --chrome-active: #F4F6F0; --chrome-active-shadow: 0 1px 3px rgba(30, 50, 35, .10);
  --chrome-sunken: #CAD3C2; --chrome-icon-active: #B5543A;
  --chrome-tag-bg: #EDD3C6; --chrome-tag-text: #8F3C29;
  --hover: rgba(30, 50, 35, .05); --active: rgba(30, 50, 35, .10); --selected: #FCFCF8;
  --text: #26302A; --text-2: #4F5A52; --text-3: #56615A; --text-faint: #A3ACA2;
  --accent: #B5543A; --accent-hover: #9E4430; --accent-text: #9E4430; --accent-solid: #B5543A;
  --accent-soft: #F4DDD3; --on-accent: #FFFFFF;
  --selection: rgba(181, 84, 58, .18);
  --highlight: #F3E7A8; --match: #F2CDBE;
  --danger: #B0321F; --danger-soft: #F5DCD6;
  --focus-ring: #B5543A;
  --separator: rgba(30, 50, 35, .08);
  --scrim: rgba(25, 35, 28, .28);
  --shadow-card: 0 1px 3px rgba(30, 50, 35, .08);
  --shadow-sheet: 0 0 0 1px rgba(30, 50, 35, .05), 0 2px 14px rgba(30, 50, 35, .09);
  --shadow-pop: 0 0 0 1px rgba(30, 50, 35, .07), 0 12px 32px rgba(30, 50, 35, .16);
}

[data-theme="ink"] {
  color-scheme: light;
  --bg-0: #1E2A3C;  --bg-1: #F2F0EB;  --bg-2: #FFFDF7;
  --bg-raised: #FFFDF7; --bg-sunken: #E7E4DD; --bg-code: #F4F2EC;
  --chrome-text: #E3E7EE; --chrome-text-2: #9BA7B9; --chrome-text-3: #9BA7B9;
  --chrome-hover: rgba(200, 220, 255, .06); --chrome-active: #2D3B51; --chrome-active-shadow: none;
  --chrome-sunken: #2A374B; --chrome-icon-active: #E8735D;
  --chrome-tag-bg: #3E3141; --chrome-tag-text: #F2A693;
  --hover: rgba(30, 40, 60, .05); --active: rgba(30, 40, 60, .10); --selected: #FFFDF7;
  --text: #1F2733; --text-2: #4E5663; --text-3: #5D6470; --text-faint: #A4A8AE;
  --accent: #D9573F; --accent-hover: #C24A33; --accent-text: #AE3F29; --accent-solid: #C24A33;
  --accent-soft: #F8E0D8; --on-accent: #FFFFFF;
  --selection: rgba(217, 87, 63, .18);
  --highlight: #F6E6AE; --match: #F6CFC2;
  --danger: #B8321F; --danger-soft: #F8DEDA;
  --focus-ring: #C24A33;
  --separator: rgba(30, 40, 60, .08);
  --scrim: rgba(12, 18, 28, .36);
  --shadow-card: 0 1px 3px rgba(30, 40, 60, .08);
  --shadow-sheet: 0 0 0 1px rgba(0, 0, 0, .06), 0 2px 18px rgba(0, 0, 0, .25);
  --shadow-pop: 0 0 0 1px rgba(30, 40, 60, .08), 0 12px 32px rgba(30, 40, 60, .18);
}

[data-theme="kraft"] {
  color-scheme: light;
  --bg-0: #E4DCCB;  --bg-1: #F2EDE3;  --bg-2: #FFFDFA;
  --bg-raised: #FFFDFA; --bg-sunken: #E7E0D3; --bg-code: #F5F1EA;
  --chrome-text: #2E2A33; --chrome-text-2: #585060; --chrome-text-3: #585060;
  --chrome-hover: rgba(60, 45, 20, .06); --chrome-active: #FAF6EE; --chrome-active-shadow: 0 1px 3px rgba(60, 45, 20, .10);
  --chrome-sunken: #D6CCB8; --chrome-icon-active: #7C5CB0;
  --chrome-tag-bg: #DCD0E8; --chrome-tag-text: #5E4290;
  --hover: rgba(60, 45, 20, .05); --active: rgba(60, 45, 20, .10); --selected: #FFFDFA;
  --text: #2E2A33; --text-2: #57505C; --text-3: #5F5862; --text-faint: #ADA5A0;
  --accent: #7C5CB0; --accent-hover: #6A4B9E; --accent-text: #6A4B9E; --accent-solid: #7C5CB0;
  --accent-soft: #E9E0F4; --on-accent: #FFFFFF;
  --selection: rgba(124, 92, 176, .18);
  --highlight: #F5E6A8; --match: #E2D3F2;
  --danger: #B0321F; --danger-soft: #F5DCD6;
  --focus-ring: #7C5CB0;
  --separator: rgba(60, 45, 20, .08);
  --scrim: rgba(40, 32, 20, .28);
  --shadow-card: 0 1px 3px rgba(60, 45, 20, .08);
  --shadow-sheet: 0 0 0 1px rgba(60, 45, 20, .05), 0 2px 14px rgba(60, 45, 20, .09);
  --shadow-pop: 0 0 0 1px rgba(60, 45, 20, .07), 0 12px 32px rgba(60, 45, 20, .16);
}

/* Dark themes — same hierarchy: chrome darkest, editor lightest. */
[data-theme="graphite"] {
  color-scheme: dark;
  --bg-0: #18181A;  --bg-1: #212123;  --bg-2: #2A2A2D;
  --bg-raised: #333336; --bg-sunken: #2E2E31; --bg-code: #232326;
  --chrome-text: #EBE8E3; --chrome-text-2: #A8A39C; --chrome-text-3: #98938C;
  --chrome-hover: rgba(255, 255, 255, .05); --chrome-active: #2C2C2F; --chrome-active-shadow: none;
  --chrome-sunken: #262628; --chrome-icon-active: #EE7A63;
  --chrome-tag-bg: #45302B; --chrome-tag-text: #F4A08E;
  --hover: rgba(255, 255, 255, .05); --active: rgba(255, 255, 255, .09); --selected: #323235;
  --text: #EBE8E3; --text-2: #B6B1AA; --text-3: #9A958E; --text-faint: #66625D;
  --accent: #EE7A63; --accent-hover: #F38E7A; --accent-text: #F4A08E; --accent-solid: #EE7A63;
  --accent-soft: #45302B; --on-accent: #1B1B1C;
  --selection: rgba(238, 122, 99, .28);
  --highlight: #54472C; --match: #63382E;
  --danger: #F07063; --danger-soft: #45292A;
  --focus-ring: #EE7A63;
  --separator: rgba(255, 255, 255, .06);
  --scrim: rgba(0, 0, 0, .5);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, .35);
  --shadow-sheet: 0 0 0 1px rgba(255, 255, 255, .04), 0 2px 16px rgba(0, 0, 0, .35);
  --shadow-pop: 0 0 0 1px rgba(255, 255, 255, .07), 0 16px 40px rgba(0, 0, 0, .5);
  --paper-line: color-mix(in oklab, var(--text) 8%, transparent);
  --paper-margin: color-mix(in oklab, #EE7A63 38%, transparent);
  --sticker-shadow: drop-shadow(0 1px 1px rgba(0, 0, 0, .35)) drop-shadow(0 5px 8px rgba(0, 0, 0, .35));
  --sticker-shadow-lift: drop-shadow(0 2px 2px rgba(0, 0, 0, .35)) drop-shadow(0 12px 16px rgba(0, 0, 0, .45));
  --postit-yellow: #E6D68E; --postit-pink: #E2BCC6; --postit-green: #BCD5B1; --postit-blue: #B8CCE0;
  --postit-shadow: 0 1px 1px rgba(0, 0, 0, .3), 0 12px 16px -8px rgba(0, 0, 0, .6);
  --postit-tape: rgba(255, 255, 255, .28);
}

[data-theme="blue"] {
  color-scheme: dark;
  --bg-0: #121720;  --bg-1: #192029;  --bg-2: #202834;
  --bg-raised: #28313E; --bg-sunken: #252E3A; --bg-code: #1A212B;
  --chrome-text: #E5E9EF; --chrome-text-2: #A0AAB8; --chrome-text-3: #8E98A6;
  --chrome-hover: rgba(200, 220, 255, .05); --chrome-active: #1E2632; --chrome-active-shadow: none;
  --chrome-sunken: #1C232E; --chrome-icon-active: #F07D67;
  --chrome-tag-bg: #412E33; --chrome-tag-text: #F5A291;
  --hover: rgba(200, 220, 255, .05); --active: rgba(200, 220, 255, .09); --selected: #29323F;
  --text: #E5E9EF; --text-2: #AAB3C0; --text-3: #8E98A6; --text-faint: #5C6675;
  --accent: #F07D67; --accent-hover: #F49280; --accent-text: #F5A291; --accent-solid: #F07D67;
  --accent-soft: #412E33; --on-accent: #141921;
  --selection: rgba(240, 125, 103, .28);
  --highlight: #4A4631; --match: #5B3539;
  --danger: #F2766A; --danger-soft: #42292F;
  --focus-ring: #F07D67;
  --separator: rgba(200, 220, 255, .06);
  --scrim: rgba(4, 8, 14, .55);
  --shadow-card: 0 1px 3px rgba(0, 0, 0, .35);
  --shadow-sheet: 0 0 0 1px rgba(200, 220, 255, .04), 0 2px 16px rgba(0, 0, 0, .4);
  --shadow-pop: 0 0 0 1px rgba(200, 220, 255, .08), 0 16px 40px rgba(0, 0, 0, .55);
  --paper-line: color-mix(in oklab, var(--text) 8%, transparent);
  --paper-margin: color-mix(in oklab, #F07D67 38%, transparent);
  --sticker-shadow: drop-shadow(0 1px 1px rgba(0, 0, 0, .35)) drop-shadow(0 5px 8px rgba(0, 0, 0, .35));
  --sticker-shadow-lift: drop-shadow(0 2px 2px rgba(0, 0, 0, .35)) drop-shadow(0 12px 16px rgba(0, 0, 0, .45));
  --postit-yellow: #E3D490; --postit-pink: #DDBAC6; --postit-green: #B8D2B0; --postit-blue: #B4C9DF;
  --postit-shadow: 0 1px 1px rgba(0, 0, 0, .3), 0 12px 16px -8px rgba(0, 0, 0, .6);
  --postit-tape: rgba(255, 255, 255, .25);
}
```

### Tableau récapitulatif

| Groupe | Tokens |
|---|---|
| Fonds | `--bg-0` chrome + sidebar · `--bg-1` liste, sommaire, cartes inline · `--bg-2` éditeur · `--bg-raised` popovers/modales · `--bg-sunken` champs, pistes · `--bg-code` code |
| Interaction | `--hover` (overlay translucide, s'additionne à n'importe quel fond) · `--active` (pressé / item clavier courant) · `--selected` (item sélectionné, porte `--shadow-card` en clair) |
| Texte | `--text` primaire · `--text-2` secondaire (aperçus, icônes) · `--text-3` estompé (méta, dates, placeholders) · `--text-faint` **non textuel uniquement** (contours de checkbox, chevrons inactifs, désactivé) |
| Chrome | `--chrome-text`, `--chrome-text-2`, `--chrome-text-3` · `--chrome-hover` · `--chrome-active` + `--chrome-active-shadow` (item sélectionné) · `--chrome-sunken` (recherche) · `--chrome-icon-active` · `--chrome-tag-bg` / `--chrome-tag-text` |
| Accent | `--accent` (icônes, fonds, anneaux) · `--accent-hover` · `--accent-text` (texte coloré) · `--accent-solid` (fond du bouton principal, toggles on) · `--accent-soft` (fond de tag, sélection douce) · `--on-accent` (texte sur `--accent-solid`) |
| Sémantique | `--selection` (sélection de texte) · `--highlight` (`==surlignage==`) · `--match` (occurrence de recherche) · `--danger`, `--danger-soft` · `--focus-ring` · `--scrim` |
| Ombres | `--shadow-card` (item sélectionné) · `--shadow-sheet` (feuille liste+éditeur) · `--shadow-pop` (menus, popovers, modales) |

### Échelles

- **Typo UI** : 11 / 12 / 13 / 14 / 15 / 17 / 20 px. Corps UI = 14 px, méta = 12–12.5 px, titres de panneau = 17 px/700.
- **Graisses** : 400 texte, 500 items de navigation, 600 libellés/boutons/tags, 700 titres et titres de cartes.
- **Interlignes** : 1.2 (titres), 1.35 (titres de carte), 1.45 (UI multi‑lignes), 1.7 (éditeur).
- **Espacements** : multiples de 4 (`--sp-1` 4 px → `--sp-16` 64 px). Demi‑pas tolérés uniquement pour l'alignement optique d'icônes (2 px).
- **Rayons** : `--r-xs` 3 (code inline) · `--r-sm` 5 (kbd, segment interne) · `--r-md` 7 (items, boutons, champs) · `--r-lg` 10 (cartes, code block) · `--r-xl` 12 (feuille, modales, popovers) · `--r-pill` (tags, toggles).

### Layout

| Zone | Défaut | Min | Max | Notes |
|---|---|---|---|---|
| Titlebar | 46 px | — | — | `data-tauri-drag-region` sur tout sauf contrôles/recherche |
| Sidebar | 232 | 180 | 320 | repliable (Ctrl \\), fond `--bg-0` |
| Liste | 340 | 260 | 480 | fond `--bg-1`, coin supérieur gauche de la feuille arrondi `--r-xl` |
| Éditeur | flex | 420 | — | fond `--bg-2` |
| Sommaire | 248 | — | — | overlay flottant, fermé par défaut (2.15) |
| Colonne de texte | 660 | 560 | 860 | réglage utilisateur ; gouttière min. `--editor-pad-x` 48 px de chaque côté (accueille marqueurs H et chevrons) |

Redimensionnement : poignée invisible de 6 px centrée sur la jonction, curseur `col-resize`, ligne `--accent` 2 px visible uniquement pendant le drag. Double‑clic = valeur par défaut. Persister les largeurs.

---

## 2. Composants

Convention d'états pour tous les composants interactifs :
- **Survol** : fond `--hover` (ou couleur `-hover` pour les éléments pleins).
- **Actif / pressé** : fond `--active`.
- **Sélectionné** : voir chaque composant.
- **Focus clavier** (`:focus-visible` uniquement) : `box-shadow: 0 0 0 2px var(--bg-of-parent), 0 0 0 4px var(--focus-ring)` ; jamais d'`outline` navigateur par défaut, jamais de focus ring au clic souris.
- **Désactivé** : `opacity: .45`, `cursor: default`, aucun survol.

### 2.1 Titlebar
- Hauteur 46, fond `--bg-0`. Gauche (largeur = sidebar) : bouton `panel-left` 16 px + « Ursa » 13.5/700.
- Centre : champ de recherche (2.3). Droite : bouton primaire « New note » (marge droite 14) puis contrôles Windows.
- **Contrôles Windows** : 3 zones 46×46, icônes `minus`, `square` (13 px) / `copy` si maximisé, `x`, couleur `--text`. Survol `--hover` ; Fermer : survol `#C42B1C` + icône blanche, pressé `#B22A1C`. Fenêtre inactive : icônes `--text-3`.

### 2.2 Sidebar item
- 32 px de haut, padding 0 10, gap 11, rayon `--r-md`, 14/500 `--chrome-text`, icône 16 `--chrome-text-2`, compteur 12 `--chrome-text-3` aligné à droite.
- Survol `--chrome-hover`. **Sélectionné** : fond `--chrome-active` + `--chrome-active-shadow`, texte 600, icône `--chrome-icon-active`. Focus : ring standard. Glisser‑déposer d'une note sur un item : fond `--accent-soft`.
- Sections dans l'ordre : Notes, Untagged (`inbox`), Todo (`square-check`), Today (`calendar-days`), Pinned (`pin`), Archive (`archive`), Trash (`trash-2`). Compteurs masqués pour Archive/Trash.

### 2.3 Barre de recherche (titlebar)
- 460×32, rayon `--r-md`, fond `--bg-sunken`, padding 0 12, icône `search` 15 `--text-3`, placeholder 13.5 `--text-3`, raccourci `Ctrl K` en `--font-mono` 11.
- **Focus / saisie** : fond `--bg-2`, `box-shadow: 0 0 0 1.5px var(--accent)`, raccourci remplacé par « N results » 12 `--text-3` + bouton effacer `x` 22×22.
- **Opérateurs** reconnus et rendus en jetons inline dès qu'ils sont complets : `@todo`, `@done`, `@today`, `@images`, `@pdf`, `@untagged` → jeton mono 12/500, padding 2 6, rayon `--r-xs`, fond `--accent-soft`, texte `--accent-text`. `#tag` → même rendu que la pastille de tag (2.5). Retour arrière sur un jeton le sélectionne puis le supprime.
- Résultats : la liste passe en titre « Results » + compteur ; occurrences en `<mark>` fond `--match`. Correspondance trouvée par OCR : ligne méta `scan-text` + « Found in image » en `--accent-text`, et la zone détectée est indiquée sur la miniature (rectangle `--match` cerclé 1.5 px `--accent`).
- Dans l'éditeur : barre flottante « 3 matches ↑ ↓ » (28 px, fond `--bg-sunken`) ; occurrence courante = `--match` + ring 1.5 px `--accent`, autres = `--match` seul.

### 2.4 Carte de note (liste)
- Padding 14, gap 14, rayon `--r-lg`, espacement vertical entre cartes 4 px, marges latérales de liste 10.
- Contenu : ligne méta 11.5/600 `--text-3` (date relative + compteur `square-check` 12 « 4/7 ») → titre 15/700 `--text` (1 ligne, ellipsis) → aperçu 13/1.45 `--text-2`, **2 lignes** (`-webkit-line-clamp: 2`), syntaxe Markdown retirée.
- Miniature optionnelle 64×64, rayon `--r-md`, `object-fit: cover` (première image de la note).
- Compteur de todos : toujours `--text-3` ; masqué s'il n'y a aucune case.
- États : survol `--hover` · **sélectionné** fond `--selected` + `--shadow-card` · focus ring standard · multi‑sélection (Ctrl/Shift) : toutes les cartes en `--selected`, sans ombre sauf la dernière · épinglée : icône `pin` 12 `--text-3` dans la ligne méta.
- Dates relatives : « just now » < 1 min, « 12 min ago », « 2 h ago », « Yesterday », jour abrégé (< 7 j), « Sep 28 », « Sep 28, 2025 » (autre année).

### 2.5 Tag
**Pastille inline** (éditeur, carte, recherche) : 13/600 `--font-ui`, padding 1 9, rayon `--r-pill`, fond `--accent-soft`, texte `--accent-text`. Survol : fond `--active` superposé (cursor pointer, clic = filtre). Le `#` reste visible. Tags imbriqués affichés complets (`#voyages/japon-2026`).
**Tag épinglé (sidebar)** : même pastille en 26 px de haut, padding 0 10, icône du tag 13 px, wrap avec gap 6.
**Item d'arbre** : 30 px, rayon `--r-md`, padding 0 10 0 6, gap 9 ; zone chevron 12 px (`chevron-down` / `chevron-right` 12, `--text-faint`, survol `--text-2`) ; icône 15 `--text-2` (ou couleur choisie) ; libellé 14/500. Enfants indentés de **20 px par niveau** (enfant de 1er niveau : padding‑left 48 sans icône, 14/400 `--text-2`). États identiques au sidebar item. Renommage inline : champ dans l'item, fond `--bg-2`, ring `--accent` 1.5 px.

### 2.6 Sélecteur d'icône de tag (écran 06)
- Popover 344 px, rayon `--r-xl`, fond `--bg-raised`, `--shadow-pop`, ancré à 6 px à droite de l'item, aligné verticalement au mieux dans la fenêtre.
- En‑tête : aperçu 28×28 (`--accent-soft`) + « Icon for #tag » 14/700 + fermer.
- Recherche 32 px (focus auto). Couleurs : 9 pastilles 20 px (défaut = `--text-2`, puis la palette `--tag-colors`) ; sélectionnée = `0 0 0 2px var(--bg-raised), 0 0 0 3.5px var(--accent)`.
- Grille 8 colonnes × 36 px, gap 2, icônes 17 px ; groupe titré 11.5/600 `--text-3`. Sélectionnée : fond `--accent-soft`, ring inset 1.5 px `--accent`. Navigation flèches + Entrée. Pied : « Remove icon » / nombre d'icônes, 12.5 `--text-3`.
- L'item d'arbre concerné reste mis en évidence (ring focus) tant que le popover est ouvert.

### 2.7 Checkbox (todo)
- Cercle 18 px, contour `inset 0 0 0 1.5px var(--text-faint)` ; gap texte 12.
- Coché : fond `--text-3`, icône `check` 12 `--bg-2` (pas d'accent) ; texte passe en `--text-3` (pas de barré par défaut ; option dans les réglages).
- Survol : contour `--text-2`. Focus clavier : ring standard. Clic sur la case uniquement (pas sur le texte). Case dans les réglages (non‑todo) : carré 16 px rayon 4.

### 2.8 Code block
- Rayon `--r-lg`, fond `--bg-code`, marge basse 24.
- En‑tête 32 px : langue 11.5/500 `--text-3` à gauche, bouton `copy` 14 à droite (visible au survol du bloc, toujours visible au focus). Copié : icône `check` pendant 1.2 s.
- Code : `--font-mono` 13.5/1.65, padding 0 16 16, défilement horizontal (pas de wrap). Coloration : mots‑clés `--accent-text`, chaînes/nombres `--text-2`, commentaires `--text-3` italique, reste `--text`.
- Curseur dans le bloc : les clôtures ```` ``` ```` apparaissent à `--syntax-opacity`.

### 2.9 Citation
- Padding 14 18, rayon `--r-md`, fond `--bg-1`, italique, `--text-2`. Pas de barre latérale. Citations imbriquées : fond `--bg-sunken`.

### 2.10 Carte d'aperçu de lien
- Ligne seule contenant une URL → carte. Padding 14, gap 16, rayon `--r-lg`, fond `--bg-1`.
- Domaine 12 `--text-3` + favicon 14 px ; titre 14.5/700 ; description 13/1.45 `--text-2` 2 lignes ; vignette 120 px de large, pleine hauteur, rayon `--r-md`.
- Survol `--hover` superposé ; clic = ouvrir dans le navigateur ; curseur sur la ligne = l'URL brute s'affiche au‑dessus de la carte en `--text-3`. Chargement : squelette `--bg-sunken` sans animation de shimmer.

### 2.11 Carte PDF
- Padding 12 14, gap 14, rayon `--r-lg`, fond `--bg-1`.
- Aperçu première page 44×56 rayon 4, `--shadow-card`, badge « PDF » 9/700 `--on-accent` sur `--accent`.
- Nom 14.5/700, méta « 12 pages · 1,4 Mo » 12.5 `--text-3`, bouton `external-link` 32×32. Double‑clic = ouvrir avec l'app système.

### 2.12 Image avec poignées
- Rayon `--r-md`, largeur max = colonne. Sélectionnée (clic) : ring `0 0 0 2px var(--accent)` décalé de 3 px.
- 4 poignées d'angle 10×10, fond `--bg-2`, contour 1.5 px `--accent`, rayon 2 ; 2 poignées latérales 6×28 `--accent`. Redimensionnement proportionnel ; Shift = libre. Badge de taille « 560 × 315 » (mono 11, fond `rgba(20,16,12,.72)`, blanc) visible pendant le drag et la sélection.
- Barre flottante 44 px au‑dessus : S / M / L / Full (segment actif `--accent-soft`) + `scan-text` (texte OCR). La largeur est stockée dans le Markdown : `![alt](img.png){width=560}`.

### 2.13 Chevron de folding
- 18×18, rayon `--r-xs`, à **22 px à gauche** de la colonne de texte, aligné sur la première ligne du titre.
- Invisible par défaut ; visible au survol de la ligne de titre (`--text-faint`) ; survol du chevron : `--text-2` + fond `--hover`.
- Section repliée : `chevron-right` toujours visible (`--text-2` + fond `--hover`) et pastille après le titre : « ··· » ou résumé (« 7 items · 4 done » pour une checklist), 12/500 `--text-3`, fond `--bg-sunken`, rayon pill. Clic sur la pastille = déplier.
- Raccourcis : Ctrl Shift [ / ] (replier/déplier la section), Ctrl K Ctrl 0 / J (tout).

### 2.14 Marqueur de titre en marge
- « H1 »…« H6 » en 11/600 `--font-ui`, couleur `--accent` à **opacité .55** (décoratif, exempté de contraste), aligné à droite dans une boîte de 22 px placée à **48 px à gauche** de la colonne, centré sur la x‑height de la première ligne.
- Masqué si l'option est désactivée ou si la gouttière < 48 px. Ne se décale jamais quand la syntaxe `#` apparaît.

### 2.15 Panneau Sommaire
- **Fermé par défaut.** Ouvert : overlay flottant au‑dessus de l'éditeur (n'occupe pas de colonne, la colonne de texte ne bouge pas), `top` 8 px sous la barre de l'éditeur, `right` 16, largeur `--outline-w`, rayon `--r-xl`, fond `--bg-raised`, `--shadow-pop`, padding 4 8 10, hauteur max = éditeur − 24. Fermeture : bouton `x`, Esc, ou re‑clic sur `list-tree`. État ouvert/fermé mémorisé globalement.
- En‑tête « Contents » 12/600 `--text-3` + fermer.
- Items min 28 px, 13/1.35, rayon `--r-sm`, padding gauche 8 + 14 px par niveau ; H1 600 `--text`, autres 500 `--text-2`. Section repliée : `chevron-right` 12 `--text-faint` devant.
- **Section courante** (scroll‑spy) : fond `--accent-soft`, texte `--accent-text` 600. Survol `--hover`. Clic = scroll vers le titre (voir motion). Toggle via le bouton `list-tree` de la barre de l'éditeur (actif : fond `--accent-soft`, icône `--accent-text`).

### 2.16 Palette de commandes (Ctrl P)
- 640 px, centrée horizontalement, top 120 px, rayon `--r-xl`, `--bg-raised`, `--shadow-pop`, scrim `--scrim` derrière.
- Champ 56 px, 16 px, icône 18 ; séparé de la liste par `--separator`.
- Groupes (Commands, Notes, Tags) : titre 11.5/600 `--text-3`. Lignes 40 px, padding 0 12, rayon `--r-md`, icône 16 `--text-2`, caractères correspondants en 700 `--accent-text`, raccourcis en `kbd` (22 px, `--bg-sunken`, mono 11). Ligne courante : `--active`. Max 8 lignes visibles par groupe, 420 px de liste.
- Pied 40 px fond `--bg-1` : aides clavier 12 `--text-3`. Préfixe `>` = commandes uniquement, `#` = tags.

### 2.17 Modale
- Rayon `--r-xl`, `--bg-raised`, `--shadow-pop`, padding 24, centrée, largeur 560 (export) / 860×660 (réglages). Scrim `--scrim` ; clic scrim ou Esc = fermer ; focus piégé, focus initial sur le premier contrôle.
- En‑tête : titre 17/700, sous‑titre 13 `--text-3`, fermer 28×28. Pied : boutons alignés à droite, gap 8, marge haute 24.
- **Export** : 5 tuiles format (Markdown, HTML, PDF, DOCX, JPG) en grille de 5, 84 px de haut, rayon `--r-lg`, fond `--bg-sunken`, icône 22, libellé 13/600 ; sélectionnée : `--accent-soft` + ring inset 1.5 px `--accent`, texte `--accent-text`. Options contextuelles au format (lignes 40 px : segmented, toggles). Destination : champ `--bg-sunken` en mono + « Change… ». Bouton primaire libellé « Export PDF » selon le format.
- **Réglages** : nav gauche 200 px fond `--bg-1` (items = sidebar item) ; contenu padding 24 32, sections espacées de 22. Contenu : dossier des notes, thème (4 cartes aperçu 72 px, sélection = double ring), « suivre le thème Windows », police de l'éditeur (select), taille (stepper 14–22 px, pas 0.5), largeur de colonne (slider 560–860, pas 20), marqueurs de titre (toggle).

### 2.18 Bouton
| Variante | Hauteur | Padding | Fond | Texte | Survol | Pressé |
|---|---|---|---|---|---|---|
| Primaire | 30 (titlebar) / 34 | 0 12 / 0 16 | `--accent-solid` | `--on-accent` 13–13.5/600 | `--accent-hover` | `--accent-hover` + translateY(0.5px) |
| Secondaire | 34 | 0 14 | `--bg-sunken` | `--text` 600 | + `--hover` | + `--active` |
| Ghost / icône | 32×32 (icône 16) | — | transparent | `--text-2` ou `--text-3` | `--hover` | `--active` |
| Danger | 34 | 0 16 | `--danger` | `--on-accent` | luminosité −6 % | — |
Rayon `--r-md`, gap icône‑texte 6, icône 15. Focus ring standard. Désactivé : opacité .45.

### 2.19 Toggle
- Piste 34×20 rayon pill ; poignée 16 px blanche, `0 1px 2px rgba(0,0,0,.2)`, à 2 px du bord.
- Off : piste `--bg-sunken` + `inset 0 0 0 1px var(--separator)`. On : piste `--accent`, poignée à droite. Survol : piste + `--hover` (off) / `--accent-hover` (on). Focus : ring standard autour de la piste. Toute la ligne est cliquable.

### 2.20 Segmented control
- Conteneur padding 2, rayon `--r-md`, fond `--bg-sunken`, 12.5/600. Segment 4 12 ; actif : fond `--bg-2`, `--shadow-card`, rayon `--r-sm` ; inactif `--text-2`.

### 2.21 Menu contextuel
- Min 200 px, padding 4, rayon `--r-lg`, `--bg-raised`, `--shadow-pop`.
- Items 30 px, padding 0 10, rayon `--r-sm`, 13.5, icône 15 `--text-2`, raccourci 12 `--text-3` à droite. Survol / clavier : `--active`. Item danger : texte + icône `--danger`, survol `--danger-soft`. Séparateur : 1 px `--separator`, marge 4 6. Sous‑menu : `chevron-right` 12, ouverture après 120 ms de survol.

### 2.22 Tooltip
- Délai d'apparition 500 ms (0 ms si un autre tooltip vient d'être vu < 800 ms). Padding 4 8, rayon `--r-sm`, 12/500.
- Fond `--text`, texte `--bg-2` (inversé, lisible dans tous les thèmes). Raccourci en `--text-faint`. Pas de flèche. Décalage 6 px sous l'élément.

### 2.23 Scrollbar
- Overlay, 10 px de zone, pouce 6 px (8 px au survol de la zone), rayon pill, couleur `--text-faint` à 50 % (survol 80 %), pas de piste ni de flèches.
- Visible pendant le défilement et au survol du panneau, masquée après 800 ms d'inactivité. Implémentation : `::-webkit-scrollbar` (WebView2).

---

## 3. Rendu Markdown live (CodeMirror 6)

Règle générale : la syntaxe est **cachée hors de la ligne active** et **visible mais estompée** sur la ligne (ou le bloc) qui contient le curseur ou une sélection.
- Syntaxe visible : même police que le texte, `opacity: var(--syntax-opacity)` (.38), couleur héritée. Code inline et listes de tâches : syntaxe en `--font-mono` 0.86em.
- Le passage caché ↔ visible ne doit **pas** décaler la ligne verticalement ; un décalage horizontal est acceptable. Pas d'animation de cette bascule.
- Implémentation : `Decoration.replace` pour masquer, `Decoration.mark({class:"cm-syntax"})` pour estomper, recalculés sur `selectionSet`.

| Élément | Rendu hors ligne | Détails |
|---|---|---|
| Corps | `--font-editor`, `--editor-fs` (16.5), lh `--rhythm` 28 px fixe, `--text` | séparation de paragraphes = la ligne vide Markdown (28 px), aucune marge CSS |
| H1 | `--h1-fs` 33 / 700 / lh `--h1-lh` 56 (2 unités), letter‑spacing −0.015em, `--text` | texte décalé de +10 px (`position:relative; top:10px` sur le contenu) pour poser la ligne de base sur la 2ᵉ réglure |
| H2 | `--h2-fs` 23 / 700 / lh 28, **`--text`** | seul le marqueur de marge « H2 » est en accent |
| H3 | `--h3-fs` 19 / 700 / lh 28, `--text` | |
| H4 | `--h4-fs` 17 / 700 / lh 28, `--text` | |
| H5 | 1em / 700, `--text-2` | |
| H6 | 1em / 600, `--text-3`, small‑caps | |
| `**gras**` | 700 | |
| `_italique_` | italic | |
| `==surligné==` | fond `--highlight`, rayon 3, padding 0 2 | texte hérité |
| `` `code` `` | `--font-mono` 0.86em, fond `--bg-code`, `--accent-text`, padding 1 5, rayon `--r-xs` | |
| `~~barré~~` | line‑through, `--text-3` | |
| `#tag` | pastille inline (2.5) | rendu identique sur la ligne active (le `#` fait partie du tag) |
| `[texte](url)` | `--accent-text`, souligné 1.5 px `--accent-soft`, offset 3 px | survol : soulignement `--accent` ; Ctrl+clic = ouvrir |
| `[[Wiki‑link]]` | `--accent-text` 600, soulignement plein `inset 0 -1.5px 0 var(--accent-soft)` | lien cassé : `--text-3` + soulignement pointillé ; survol 400 ms = aperçu flottant |
| `- [ ]` / `- [x]` | checkbox 2.7 | |
| Listes | puces 5 px `--text-3`, numéros `--text-3` tabulaires | indentation 24 px |
| `> citation` | composant 2.9 | |
| ```` ``` ```` | composant 2.8 | |
| `---` | ligne 1 px `--separator`, marge 28 | |
| Image | composant 2.12 | |
| URL seule sur une ligne | composant 2.10 | |
| Lien vers `.pdf` local | composant 2.11 | |
| Sélection de texte | `--selection` | |
| Curseur | 2 px `--accent`, clignotement 1 s (désactivé si reduced motion) | |
| Ligne active | aucun fond | |

---

## 4. Motion

Principe : discret et fonctionnel. Rien ne rebondit, rien ne glisse sur plus de 12 px.

| Élément | Propriétés | Durée | Courbe |
|---|---|---|---|
| Survol / pressé (fonds, couleurs) | background, color | `--dur-fast` 100 ms (entrée), 0 ms (sortie instantanée acceptable) | `--ease-out` |
| Focus ring | box-shadow | `--dur-instant` 60 ms | linéaire |
| Toggle | left de la poignée, background | `--dur-base` 160 ms | `--ease-in-out` |
| Menu contextuel, popover, tooltip | opacity 0→1, translateY(−4px→0) | 120 ms entrée / 80 ms sortie | `--ease-out` / `--ease-in` |
| Palette, modale | opacity, scale(.98→1) ; scrim opacity | `--dur-base` 160 ms entrée / 100 ms sortie | `--ease-out` |
| Sidebar / sommaire (afficher‑masquer) | width (ou transform + clip) | `--dur-slow` 240 ms | `--ease-in-out` |
| Mode focus (entrée/sortie) | opacity du chrome | `--dur-slow` 240 ms | `--ease-in-out` |
| Folding | hauteur via repli CM6, + rotation chevron 90° | 160 ms (chevron uniquement) | `--ease-out` |
| Scroll vers un titre (sommaire, recherche) | scroll | ≤ 300 ms, `behavior: smooth` | natif |
| Case cochée | fond + check (scale .6→1) | 140 ms | `--ease-out` |

**Ne pas animer** :
- la bascule syntaxe cachée/visible de la ligne active ;
- la frappe, le curseur qui se déplace, la mise à jour de l'aperçu des cartes ;
- le changement de note sélectionnée (le contenu de l'éditeur s'échange instantanément) ;
- le tri, le filtrage et l'apparition des résultats de recherche ;
- le changement de thème (bascule instantanée) ;
- le redimensionnement des colonnes au drag ;
- aucun shimmer / skeleton animé, aucun parallaxe.

`@media (prefers-reduced-motion: reduce)` (et réglage Windows « Effets d'animation » off) : toutes les durées passent à 0 ms sauf les fondus d'opacité (ramenés à 80 ms), curseur sans clignotement, scroll instantané.

---

## 5. Accessibilité

### Contrastes (WCAG 2.1 AA) — calculés sur les tokens

| Paire | coral | sage | ink | kraft | graphite | blue |
|---|---|---|---|---|---|---|
| `--text` / `--bg-2` | 14.7 | 13.3 | 14.8 | 13.8 | 11.7 | 12.2 |
| `--text-2` / `--bg-2` | 7.0 | 7.0 | 7.3 | 7.6 | 6.7 | 7.0 |
| `--text-3` / `--bg-1` | 5.2 | 5.7 | 5.2 | 5.9 | 5.4 | 5.6 |
| `--text-3` / `--bg-sunken` | 4.6 | 5.1 | 4.7 | 5.2 | 4.6 | 4.7 |
| `--accent-text` / `--bg-2` | 5.7 | 6.1 | 5.8 | 6.6 | 7.0 | 7.4 |
| `--accent-text` / `--accent-soft` | 4.7 | 4.9 | 4.7 | 5.3 | 6.0 | 6.3 |
| `--on-accent` / `--accent-solid` | 4.9 | 4.9 | 4.9 | 5.2 | 6.2 | 6.6 |
| `--chrome-text` / `--bg-0` | 11.4 | 10.1 | 11.7 | 10.3 | 14.5 | 14.7 |
| `--chrome-text-2` / `--bg-0` | 4.8 | 5.7 | 5.9 | 5.6 | 7.1 | 7.6 |
| `--chrome-tag-text` / `--chrome-tag-bg` | 5.8 | 5.2 | 6.2 | 5.4 | 6.0 | 6.3 |
| `--postit-text` / `--postit-yellow` | 10.2 | 10.2 | 10.2 | 10.2 | 8.4 | 8.2 |
| `--postit-text` / `--postit-blue` | 9.3 | 9.3 | 9.3 | 9.3 | 7.4 | 7.2 |

Règles :
- Tout texte utile ≥ 4.5:1 : utiliser `--text`, `--text-2`, `--text-3` ou `--accent-text`. **`--accent` n'est jamais utilisé pour du texte de corps** (seulement icônes, fonds, bordures, H‑marqueurs décoratifs).
- `--text-faint` (≈ 2.5:1) est réservé aux éléments non textuels redondants (chevrons, contour de case vide doublé du libellé) et à l'état désactivé.
- Le marqueur « H1… » à 55 % d'opacité est décoratif (`aria-hidden="true"`).
- Composants d'interface (contours de champs actifs, focus, toggles on) ≥ 3:1.
- Tester aussi en **Contraste élevé Windows** (`forced-colors: active`) : rétablir des bordures `1px solid CanvasText` sur cartes, champs, modales ; le focus utilise `Highlight`.

### Focus et clavier
- Focus visible partout via `:focus-visible` (ring 2 px `--focus-ring` avec 2 px d'écart couleur du fond parent). Jamais supprimé.
- Ordre de tabulation : titlebar → sidebar → liste → éditeur → sommaire. F6 / Shift F6 : passer d'une zone à l'autre. Dans la sidebar et la liste, une seule tabulation par zone puis navigation aux flèches (roving tabindex) ; Entrée ouvre, Suppr met à la corbeille, F2 renomme (tag).
- Modales et palette : focus piégé, Esc ferme, focus rendu à l'élément d'origine.
- Rôles : sidebar `nav` + `tree` pour les tags (`aria-expanded`), liste `listbox` (`aria-selected`), palette `combobox` + `listbox`, toggles `role="switch"` + `aria-checked`, contrôles de fenêtre avec `aria-label`.
- Cibles cliquables ≥ 24×24 (WCAG 2.2) ; boutons icônes de 32×32.
- La taille de l'éditeur suit le réglage utilisateur ; l'UI respecte le facteur d'échelle Windows (pas de tailles en px figées côté OS, Tauri gère le DPI).

---

## 6. Rythme vertical de l'éditeur

Unité `--rhythm` = **28 px**. Toute ligne de l'éditeur (paragraphe, item de liste, case à cocher, H2–H6) a une hauteur de ligne de 28 px, quelle que soit la taille de police choisie (14–20 px).
- H1 : 56 px (2 unités), contenu décalé de +10 px pour que la ligne de base tombe sur la réglure.
- Espacements verticaux : uniquement des multiples de 28 (la ligne vide Markdown = 1 unité). Aucune marge CSS sur les paragraphes ni les titres.
- Blocs (code, citation, carte de lien, carte PDF, image) : hauteur totale arrondie **au multiple de 28 supérieur** (padding‑bottom compensatoire) ; bord supérieur aligné sur une unité.
- Images : hauteur affichée arrondie au multiple de 28 (`object-fit: cover` sur la différence, max 27 px de rognage) ; le badge de taille affiche les unités.
- Pastille de tag : 22 px de haut, centrée dans la ligne de 28.
- La ligne de base du corps (16.5 px) tombe à ≈ 20 px du haut de l'unité ; la réglure est tracée à `--paper-rule-y` = 24 px.

## 7. Fond de page (option par note)

Stocké dans le front matter : `page: plain | ruled | ruled-margin | grid | dots`. Défaut `plain`. Choix via menu `…` de l'éditeur › « Page background » (popover 288 px, 4 vignettes 52 px de haut, sélection = double anneau accent, toggle « Red margin »).

Le motif est peint sur le conteneur défilant de l'éditeur (`.cm-scroller` ou un calque derrière `.cm-content`), `background-attachment: local`, origine = haut du contenu, qui commence lui‑même sur une unité (padding‑top multiple de 28). Les traits ne passent jamais sous la barre d'outils de l'éditeur.

| Variante | CSS | Pas |
|---|---|---|
| Uni | aucun | — |
| Lignes | `linear-gradient(to bottom, transparent 24px, var(--paper-line) 24px 25px, transparent 25px)` · `background-size: 100% var(--paper-pitch)` | 28 px |
| Marge rouge | + trait vertical 1.5 px `--paper-margin`, à `--paper-margin-x` (36 px) à gauche de la colonne de texte, toute la hauteur | — |
| Quadrillage | 2 gradients 1 px `--paper-grid-line` (horizontal décalé de 10 px pour coïncider avec la réglure à 24 px) · `background-size: 14px 14px` | 14 px |
| Pointillés | `radial-gradient(circle at 14px 24px, var(--paper-dot) 1.1px, transparent 1.7px)` · `background-size: 28px 28px` | 28 px |

Couleurs dérivées du thème avec `color-mix(in oklab, var(--text) N%, transparent)` : lignes 9 % (8 % en sombre), quadrillage 6 %, points 24 %, marge = rouge #D9573F à 42 % (accent du thème à 38 % en sombre). Les motifs sont décoratifs : jamais d'exigence de contraste, masqués à l'export Markdown/HTML, conservés en PDF/JPG si « Use current theme » est actif. Vrai 5 mm ≈ 19 px, incompatible avec le pas de 28 ; le quadrillage utilise donc 14 px (demi‑unité).

## 8. Stickers

Visuels décoratifs posés librement sur la note (pack par défaut : Fluent Emoji 3D, licence MIT, PNG 256 px embarqués ; import utilisateur PNG / WebP / SVG / GIF fixe, copié dans `<dossier>/.ursa/stickers/`).
- **Stockage** : bloc invisible en fin de fichier `<!-- ursa:stickers [...] -->` (JSON : id, src, ancre = id de bloc + offset x/y en px, taille, rotation). Les stickers suivent le bloc d'ancrage quand le texte bouge ; ils ne modifient pas la mise en page (calque `position:absolute`, `pointer-events` uniquement sur l'image).
- **Taille** : 40–200 px, défaut 80 ; ratio verrouillé. **Rotation** à la pose : aléatoire uniforme dans **[−8°, +8°]**, éditable librement.
- **Ombre** : `filter: var(--sticker-shadow)` (suit la silhouette PNG). En glisser : `--sticker-shadow-lift` + `scale(1.06)`.
- **États** : repos (rien autour) · survol / sélection : cadre pointillé 1 px `--accent` à 6 px, 4 poignées d'angle 8×8 (fond `--bg-2`, contour 1.5 px `--accent`, rayon 2), poignée de rotation (tige 20 px + cercle 10 px au‑dessus) ; le tout tourne avec le sticker · glisser : curseur `grabbing`, ombre levée, badge d'angle « −2° » pendant la rotation (Shift = pas de 15°) · focus clavier : même cadre ; flèches = déplacer 1 px (Shift 10), `[` `]` = rotation ±1°, Suppr = retirer.
- Z‑order : au‑dessus du texte, sous les post‑it ; clic droit › Bring forward / Send back.
- Désactivables globalement (Réglages › Editor › « Show decorations ») et masqués en mode focus si l'option est cochée.

## 9. Mini post‑it

- **Tailles** : 148 ou 168 px (carré, multiples de 4) ; redimensionnable 120–240. Rayon 2 px. Padding 20 14 0.
- **Couleurs** : `--postit-yellow`, `--postit-pink`, `--postit-green`, `--postit-blue` (versions atténuées en sombre). Texte `--postit-text` (≥ 7:1 dans tous les thèmes).
- **Typo** : `--font-hand` (Caveat 500 embarqué ; fallback Windows « Ink Free », « Segoe Print ») 22 px / 28 px — même rythme que l'éditeur.
- **Rotation** à la pose : aléatoire **[−3°, +3°]**.
- **Ombre « papier collé »** : `--postit-shadow` (ombre portée courte + ombre basse décalée qui simule le bord décollé) ; dégradé 135° transparent → `rgba(0,0,0,.05)` sur le coin inférieur droit ; bande de scotch optionnelle 60×18 `--postit-tape` à −4°/+3°, centrée, dépassant de 9 px.
- **États** : repos · survol : barre flottante au‑dessus (fond `--bg-raised`, `--shadow-pop`, contre‑rotation pour rester horizontale) avec 4 pastilles couleur 16 px (courante = double anneau accent), « Replier » (`minimize-2`), « Supprimer » (`trash-2`) · édition (double‑clic ou Entrée) : anneau 2 px `--focus-ring` à 5 px, curseur 2 px `--postit-text` · **replié** : pastille 28 px de haut, rayon pill, même couleur, icône `sticky-note` 13 + premiers mots en `--font-hand` 17/600, ellipsis à 160 px, ombre réduite `0 1px 2px rgba(60,40,10,.18)` ; clic = déplier · glisser : comme les stickers.
- Stockage : même bloc JSON que les stickers (`type: "postit"`, texte, couleur, état replié). Contenu inclus dans la recherche plein texte.

## 10. Tiroir à stickers

- Ouverture : bouton `sticker` de la barre de l'éditeur (actif : `--accent-soft` / `--accent-text`) ou Ctrl Shift S. Overlay flottant à droite, `top` 8, `right` 16, `bottom` 16, largeur 320, rayon `--r-xl`, `--bg-raised`, `--shadow-pop`.
- Contenu : titre « Stickers » 15/700 + fermer · recherche 32 px · catégories en chips 26 px (Recent, Nature, Food, Travel, Objects, Mine ; active = `--accent-soft` / `--accent-text`, autres `--bg-sunken` / `--text-2`) · grille 4 colonnes, cellules 68 px, image 48 px avec `--sticker-shadow`, survol `--hover` · section « Sticky notes » : 4 carrés 48 px aux couleurs post‑it, icône `plus` · pied `--bg-1` : bouton secondaire « Import image… » (`image-plus`) + aide 12 `--text-3`.
- Interaction : glisser une cellule sur la note (aperçu fantôme à 70 % d'opacité) ou clic = pose au centre de la zone visible. Glisser un fichier image depuis l'Explorateur sur la note = import + pose.

## 11. Motion — ajouts

| Élément | Propriétés | Durée | Courbe |
|---|---|---|---|
| Pose d'un sticker / post‑it | scale .9→1, opacity 0→1 | 160 ms | `--ease-out` |
| Levée (début de glisser) | filter, scale 1→1.06 | 100 ms | `--ease-out` |
| Replier / déplier un post‑it | width/height (FLIP) | 160 ms | `--ease-in-out` |
| Ouverture tiroir / sommaire | opacity, translateX(8px→0) | 160 ms entrée / 100 ms sortie | `--ease-out` |

Ne pas animer : le changement de fond de page, l'apparition des stickers au chargement d'une note, le déplacement d'un sticker quand le texte se réorganise.

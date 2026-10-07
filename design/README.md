# design/

- `ursa-tokens.css` : tokens source (identiques au bloc CSS de `DESIGN.md`), copiés verbatim dans `src/styles/tokens.css` ; vérifié par `npm run check:tokens`.
- `maquettes/` : maquettes validées.
  - `Ursa Screens.dc.html`, `Ursa Paper and Stickers.dc.html` : sources des canevas (ils dépendent d'un `support.js` et d'un composant « Ursa Main » non fournis ; les écrans 02/02b sont du HTML statique rendable).
  - Captures PNG : `02-editeur.png`, `02b-rendu-live.png`, `A1-A2-papier-uni-ligne.png`, `A3-A4-papier-quadrillage-pointilles.png`, `10-tiroir-stickers.png`.
  - Les captures des écrans 04–09 (vue principale, sommaire, recherche, icône de tag, palette, export, réglages) ont été montrées en conversation mais ne sont pas encore dans le dépôt.
- `icone-coquelicot-reference.png` : référence de l'icône (coquelicot sur tuile crème).
- `app-icon-1024.png` : icône de l'application, tuile carrée recadrée de la référence ; toutes les tailles (`src-tauri/icons/`, `.ico` 16 à 256 px avec une variante plus pleine en 16–32 px) sont produites par `npm run icon` puis `npx tauri icon` (voir `scripts/make-app-icon.cjs`).
- Les noms « Ursa » des fichiers de design sont l'ancien nom de l'app (avant la 1.0).

# Ursa

[![Windows](https://github.com/shingao/Rhoda/actions/workflows/windows.yml/badge.svg?branch=claude/ursa-notes-app-j3yanr)](https://github.com/shingao/Rhoda/actions/workflows/windows.yml)

Application de prise de notes locale pour Windows : notes Markdown dans un dossier, éditeur live, tags, recherche, stickers et post-it. Tauri 2 + React + CodeMirror 6, 100 % local.

- Avancement, décisions et checklists : [`PROGRESS.md`](PROGRESS.md)
- Design : [`DESIGN.md`](DESIGN.md)
- Guide du projet et commandes : [`CLAUDE.md`](CLAUDE.md)

L'intégration continue (`.github/workflows/windows.yml`) tourne sur Windows à chaque push : `npm run check`, clippy, tests Rust, puis le build Tauri complet. L'installeur `.msi` est disponible en artefact du workflow.

## Tester une build

### 1. Télécharger l'installeur

1. Ouvrir l'onglet **Actions** du dépôt, workflow **[Windows](https://github.com/shingao/Rhoda/actions/workflows/windows.yml)** (il faut être connecté à GitHub).
2. Choisir le dernier run **vert** de la branche `claude/ursa-notes-app-j3yanr`. Un run vert garantit que les tests sont passés, OCR Windows réel compris.
3. En bas de la page du run, section **Artifacts** : télécharger **`ursa-msi`**. C'est un `.zip` contenant `Ursa_<version>_x64_en-US.msi` (artefact conservé 90 jours par défaut).
4. Extraire le `.zip` (clic droit › *Extraire tout…*).

### 2. Passer l'avertissement SmartScreen (installeur non signé)

L'installeur n'est pas signé numériquement : Windows le signale comme venant d'un « éditeur inconnu ».

- **Avant de lancer (recommandé)** : clic droit sur le `.msi` › *Propriétés* › onglet *Général* › cocher **Débloquer** en bas › *OK*. L'avertissement « fichier téléchargé » disparaît.
- **Sinon, au lancement** : sur l'écran bleu « Windows a protégé votre ordinateur », cliquer **Informations complémentaires**, puis **Exécuter quand même**.
- Windows demande ensuite l'autorisation administrateur (UAC). C'est normal, l'installation se fait dans `C:\Program Files\Ursa\`.
- Windows 11 avec le **Contrôle intelligent des applications** (Smart App Control) actif : un installeur non signé est bloqué sans option pour passer outre. Il faut alors construire l'app soi-même (`npm install` puis `npm run tauri build`) plutôt que désactiver cette protection.

Désinstaller : *Paramètres* › *Applications* › *Applications installées* › **Ursa** › *Désinstaller*. La désinstallation ne touche ni aux notes ni aux réglages.

### 3. Où sont les données, et repartir de zéro

| Quoi | Où | Contenu |
|---|---|---|
| Notes | `Documents\Ursa\` (par défaut ; Réglages › Général › Dossier des notes) | un `.md` par note, `assets\` pour les images, PDF et stickers importés |
| Données internes du dossier | `Documents\Ursa\.ursa\` (dossier caché) | `tags.json` (icônes, couleurs, épingles), `folds.json` (replis), `view.json` (stickers masqués), `thumbs\` et `previews\` (vignettes, aperçus de liens), `ocr\` (texte lu dans les images), `backups\` (sauvegardes avant les opérations en masse, gardées 30 jours) |
| Réglages de l'app | `%APPDATA%\com.ursa.notes\` | `settings.json` (thème, police, langue, OCR, emplacement du dossier des notes…) et `.window-state.json` (taille et position de la fenêtre) |
| Données de la WebView | `%LOCALAPPDATA%\com.ursa.notes\` | cache du moteur web, dont le thème mis en cache pour l'affichage au démarrage |

Coller `%APPDATA%\com.ursa.notes` dans la barre d'adresse de l'Explorateur pour y aller directement. Le dossier `.ursa` est caché : *Affichage* › *Afficher* › *Éléments masqués*.

Pour **repartir de zéro**, Ursa étant fermée :

- **Réglages seulement** : supprimer `%APPDATA%\com.ursa.notes\` et `%LOCALAPPDATA%\com.ursa.notes\`. Au prochain lancement, réglages par défaut et dossier `Documents\Ursa`.
- **Caches et données internes** (les notes restent intactes) : supprimer `Documents\Ursa\.ursa\`. Tout est reconstruit au lancement : vignettes, aperçus, OCR relu en arrière-plan. On perd seulement les réglages des tags, les replis, les « stickers masqués » et les sauvegardes.
- **Tout** : en plus, supprimer (ou mieux, déplacer ailleurs) `Documents\Ursa\`. Supprimé depuis l'Explorateur, il reste récupérable dans la Corbeille.

Pour essayer avec des notes d'exemple, copier le contenu de [`samples/`](samples) (les `.md` et `assets\`) dans `Documents\Ursa\`, Ursa fermée.

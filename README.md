# Bullshit

[![Windows](https://github.com/shingao/Rhoda/actions/workflows/windows.yml/badge.svg?branch=claude/ursa-notes-app-j3yanr)](https://github.com/shingao/Rhoda/actions/workflows/windows.yml)

Application de prise de notes locale pour Windows : notes Markdown dans un dossier, éditeur live, tags, recherche, stickers et post-it. Tauri 2 + React + CodeMirror 6, 100 % local. Version 1.0.0 ([`CHANGELOG.md`](CHANGELOG.md)) ; l'app s'appelait Ursa avant la 1.0, nom resté dans le code.

- Avancement, décisions et checklists : [`PROGRESS.md`](PROGRESS.md)
- Design : [`DESIGN.md`](DESIGN.md)
- Guide du projet et commandes : [`CLAUDE.md`](CLAUDE.md)

L'intégration continue (`.github/workflows/windows.yml`) tourne sur Windows à chaque push : `npm run check`, clippy, tests Rust, build Tauri complet, puis installation, lancement, mise à jour et désinstallation réelles de l'installeur. L'installeur est disponible en artefact du workflow ; un lancement manuel du workflow avec « release » (ou un tag `v*`) en fait une release GitHub brouillon.

## Tester une build

### 1. Télécharger l'installeur

Une version publiée se télécharge depuis l'onglet **Releases** du dépôt (`Bullshit_<version>_x64-setup.exe`). Pour une build de développement :

1. Ouvrir l'onglet **Actions** du dépôt, workflow **[Windows](https://github.com/shingao/Rhoda/actions/workflows/windows.yml)** (il faut être connecté à GitHub).
2. Choisir le dernier run **vert** de la branche `claude/ursa-notes-app-j3yanr`. Un run vert garantit que les tests sont passés, OCR Windows réel compris.
3. En bas de la page du run, section **Artifacts** : télécharger **`bullshit-setup`**. C'est un `.zip` contenant `Bullshit_<version>_x64-setup.exe` (artefact conservé 90 jours par défaut).
4. Extraire le `.zip` (clic droit › *Extraire tout…*).

### 2. Passer l'avertissement SmartScreen (installeur non signé)

L'installeur n'est pas signé numériquement : Windows le signale comme venant d'un « éditeur inconnu ».

- **Avant de lancer (recommandé)** : clic droit sur le `-setup.exe` › *Propriétés* › onglet *Général* › cocher **Débloquer** en bas › *OK*. L'avertissement « fichier téléchargé » disparaît.
- **Sinon, au lancement** : sur l'écran bleu « Windows a protégé votre ordinateur », cliquer **Informations complémentaires**, puis **Exécuter quand même**.
- Aucun droit administrateur n'est demandé : l'installation se fait pour l'utilisateur courant, dans `%LOCALAPPDATA%\Bullshit\`. L'installeur (en français) crée un raccourci dans le menu Démarrer et propose un raccourci sur le bureau. Sur un Windows 10 sans WebView2, il l'installe au passage (connexion Internet nécessaire).
- Une nouvelle version s'installe par-dessus l'ancienne : réglages et notes sont conservés.
- Windows 11 avec le **Contrôle intelligent des applications** (Smart App Control) actif : un installeur non signé est bloqué sans option pour passer outre. Il faut alors construire l'app soi-même (`npm install` puis `npm run tauri build`) plutôt que désactiver cette protection.

Désinstaller : *Paramètres* › *Applications* › *Applications installées* › **Bullshit** › *Désinstaller*. La désinstallation ne touche jamais au dossier des notes ; une case (décochée par défaut) propose de supprimer aussi les réglages et caches.

Relancer l'app quand elle est déjà ouverte ramène sa fenêtre au premier plan : une seule instance à la fois.

**Venant d'Ursa** (builds avant la 1.0) : au premier lancement, les réglages de `%APPDATA%\com.ursa.notes\` sont copiés (l'ancien dossier reste, il peut être supprimé ensuite) et le dossier `Documents\Ursa\` est renommé `Documents\Bullshit\` s'il était le dossier par défaut et que `Documents\Bullshit\` n'existe pas encore. Si le renommage échoue (fichier ouvert ailleurs), l'app continue sur `Documents\Ursa\` et réessaie au lancement suivant. L'ancienne version (`.msi`) se désinstalle par *Applications installées* › **Ursa**.

### 3. Où sont les données, et repartir de zéro

| Quoi | Où | Contenu |
|---|---|---|
| Notes | `Documents\Bullshit\` (par défaut ; Réglages › Général › Dossier des notes) | un `.md` par note, `assets\` pour les images, PDF et stickers importés |
| Données internes du dossier | `Documents\Bullshit\.ursa\` (dossier caché) | `tags.json` (icônes, couleurs, épingles), `folds.json` (replis), `view.json` (stickers masqués), `thumbs\` et `previews\` (vignettes, aperçus de liens), `ocr\` (texte lu dans les images), `backups\` (sauvegardes avant les opérations en masse, gardées 30 jours) |
| Réglages de l'app | `%APPDATA%\com.bullshit.notes\` | `settings.json` (thème, police, langue, OCR, emplacement du dossier des notes…) et `.window-state.json` (taille et position de la fenêtre) |
| Données de la WebView | `%LOCALAPPDATA%\com.bullshit.notes\` | cache du moteur web, dont le thème mis en cache pour l'affichage au démarrage |

Coller `%APPDATA%\com.bullshit.notes` dans la barre d'adresse de l'Explorateur pour y aller directement. Le dossier `.ursa` (nom interne, resté de l'ancien nom) est caché : *Affichage* › *Afficher* › *Éléments masqués*.

Pour **repartir de zéro**, Bullshit étant fermée :

- **Réglages seulement** : supprimer `%APPDATA%\com.bullshit.notes\` et `%LOCALAPPDATA%\com.bullshit.notes\`. Au prochain lancement, réglages par défaut et dossier `Documents\Bullshit`.
- **Caches et données internes** (les notes restent intactes) : supprimer `Documents\Bullshit\.ursa\`. Tout est reconstruit au lancement : vignettes, aperçus, OCR relu en arrière-plan. On perd seulement les réglages des tags, les replis, les « stickers masqués » et les sauvegardes.
- **Tout** : en plus, supprimer (ou mieux, déplacer ailleurs) `Documents\Bullshit\`. Supprimé depuis l'Explorateur, il reste récupérable dans la Corbeille.

Pour essayer avec des notes d'exemple, copier le contenu de [`samples/`](samples) (les `.md` et `assets\`) dans `Documents\Bullshit\`, Bullshit fermée.

# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions [SemVer](https://semver.org/lang/fr/).

## [1.0.0] — 2026-10-07

Première version publique. L'app s'appelait Ursa pendant le développement : réglages et dossier de notes d'Ursa sont repris automatiquement.

### Notes et fichiers
- Un fichier Markdown par note, dans un dossier au choix (`Documents\Bullshit` par défaut), lisible dans n'importe quel autre éditeur ; frontmatter YAML géré par l'app, clés inconnues préservées.
- Sauvegarde automatique, renommage du fichier d'après le titre, corbeille de Windows, archives, notes épinglées.
- Modifications faites hors de l'app suivies en direct ; un fichier verrouillé ne fait jamais perdre de texte.
- Sauvegardes automatiques avant chaque opération en masse, avec « Annuler » et restauration depuis les réglages (gardées 30 jours).

### Éditeur
- Markdown rendu en direct (CodeMirror 6) : titres, listes, tâches, citations, code, tableaux, liens `[[wiki]]` avec rétroliens.
- Tags `#tag/sous-tag` avec icônes, couleurs, épingles et arbre dans la barre latérale.
- Sommaire, replis de sections mémorisés, isolement d'une section, mode focus, comptage de mots et temps de lecture.
- Fonds de page (uni, ligné, quadrillé, pointillé, marge rouge) alignés sur un rythme vertical de 28 px, à toutes les échelles d'affichage de Windows.
- Images (coller, déposer, importer ; redimensionner, recadrer sans perte), cartes PDF, aperçus de liens (désactivables, seule requête réseau de l'app).
- Stickers (environ 200 Fluent Emoji et vos propres images) et post-it, ancrés au texte, annulables.

### Recherche
- Recherche instantanée dans tout le coffre : syntaxe (`#tag`, `"expression"`, `-exclusion`, `@images`…), insensible à la casse et aux accents, extraits.
- Rechercher / remplacer dans la note (Ctrl+F, Ctrl+H).
- Texte des images et des PDF lu en local par l'OCR de Windows, trouvable par la recherche et surligné dans les images.

### Export
- Markdown, HTML autonome, PDF, Word (.docx), PNG et JPG ; une ou plusieurs notes à la fois, stickers compris.

### Interface
- Six thèmes (quatre clairs, deux sombres), polices Hanken Grotesk, Newsreader, JetBrains Mono et Caveat embarquées.
- Palette de commandes (Ctrl+P), raccourcis personnalisables, interface en français ou en anglais.
- Accessibilité : contrastes AA vérifiés dans les six thèmes, navigation complète au clavier (F6 entre les zones), Narrateur, mouvement réduit, contraste élevé de Windows.
- Rapide sur de gros coffres : démarrage à 2 000 notes, liste fenêtrée, mémoire stable sur des centaines de notes ouvertes.
- Note de bienvenue au premier lancement, écrans vides explicatifs, écran de récupération en cas d'erreur (texte en attente écrit d'abord) et journal d'erreurs local, sans aucun texte de note.

### Installation
- Installeur Windows en français, pour l'utilisateur courant, sans droits administrateur ; installe WebView2 si besoin (Windows 10).
- Raccourci dans le menu Démarrer, raccourci sur le bureau en option ; pas d'association de fichiers `.md`.
- Une seule instance : relancer l'app ramène sa fenêtre au premier plan.
- Mise à jour par-dessus une version précédente, réglages et notes conservés.
- La désinstallation ne touche jamais au dossier des notes ; suppression des réglages et caches proposée, décochée par défaut.
- 100 % local, aucune télémétrie.

### Venant d'Ursa
- Réglages copiés depuis `%APPDATA%\com.ursa.notes` (l'ancien dossier reste en place).
- Le dossier `Documents\Ursa` devient `Documents\Bullshit` s'il était le dossier par défaut et que le nouveau n'existe pas ; en cas d'échec, l'app continue sur l'ancien.

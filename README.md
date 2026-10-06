# Ursa

[![Windows](https://github.com/shingao/Rhoda/actions/workflows/windows.yml/badge.svg?branch=claude/ursa-notes-app-j3yanr)](https://github.com/shingao/Rhoda/actions/workflows/windows.yml)

Application de prise de notes locale pour Windows : notes Markdown dans un dossier, éditeur live, tags, recherche, stickers et post-it. Tauri 2 + React + CodeMirror 6, 100 % local.

- Avancement, décisions et checklists : [`PROGRESS.md`](PROGRESS.md)
- Design : [`DESIGN.md`](DESIGN.md)
- Guide du projet et commandes : [`CLAUDE.md`](CLAUDE.md)

L'intégration continue (`.github/workflows/windows.yml`) tourne sur Windows à chaque push : `npm run check`, clippy, tests Rust, puis le build Tauri complet. L'installeur `.msi` est disponible en artefact du workflow.

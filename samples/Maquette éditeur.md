---
id: 0192f3a8-0000-7000-8000-000000000002
created: 2026-10-02T12:00:00+02:00
---
# Synchronisation des fichiers
#projets/ursa #recherche

L'index reste **local** : chaque note est un fichier `.md` dans le dossier choisi. On surveille le disque avec _notify_ et on ==réindexe uniquement les fichiers modifiés==.

Le format des en-têtes est décrit dans [[Format des métadonnées]], et l'API du watcher dans [la doc Tauri](https://v2.tauri.app/).

## Étapes
- [x] Watcher sur le dossier racine
- [x] Debounce à 150 ms
- [ ] Résolution des conflits d'écriture
- [ ] Test de charge sur 10 000 notes

### Debounce
```typescript
const queue = new Set<string>();
watcher.on("change", (path) => {
  queue.add(path);
  scheduleFlush(150);
});
```

> Un fichier, une note. L'utilisateur n'a rien d'autre à comprendre.

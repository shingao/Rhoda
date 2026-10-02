import type { RelativeKind } from "../core/dates";

/** French UI strings — the reference catalogue: every other language must provide the same keys. */
export const fr = {
  /** Fallback note title and file name. */
  untitled: "Sans titre",
  dates: {
    locale: "fr-FR",
    justNow: "à l'instant",
    minutesAgo: (n: number) => `il y a ${n} min`,
    hoursAgo: (n: number) => `il y a ${n} h`,
    yesterday: "hier",
  },
  keys: {
    Ctrl: "Ctrl",
    Shift: "Maj",
    Alt: "Alt",
    Delete: "Suppr",
    Enter: "Entrée",
    Escape: "Échap",
    Backslash: "\\",
  } as Record<string, string>,
  titlebar: {
    showSidebar: "Afficher la barre latérale",
    hideSidebar: "Masquer la barre latérale",
    newNote: "Nouvelle note",
    minimize: "Réduire",
    maximize: "Agrandir",
    restore: "Restaurer",
    close: "Fermer",
  },
  search: {
    placeholder: "Rechercher des notes, #tags, @todo…",
    label: "Rechercher dans les notes",
    clear: "Effacer la recherche",
  },
  sidebar: {
    label: "Sections",
    notes: "Notes",
    sections: {
      notes: "Notes",
      untagged: "Sans tag",
      todo: "À faire",
      today: "Aujourd'hui",
      pinned: "Épinglées",
      archive: "Archives",
      trash: "Corbeille",
    },
    pinnedTags: "Tags épinglés",
    tags: "Tags",
    expand: "Déplier",
    collapse: "Replier",
    noteCount: (n: number) => `${n} note${n > 1 ? "s" : ""}`,
  },
  tags: {
    changeIcon: "Changer l'icône…",
    pin: "Épingler en haut",
    unpin: "Désépingler",
    rename: "Renommer…",
    remove: "Supprimer le tag…",
    renameTitle: (tag: string) => `Renommer ${tag}`,
    renameBody: (n: number) =>
      n === 0 ? "Aucune note ne sera modifiée." : `${n} note${n > 1 ? "s seront modifiées" : " sera modifiée"} (sous-tags compris).`,
    renameTo: (tag: string) => `Nouveau nom : ${tag}`,
    renameConfirm: "Renommer",
    removeTitle: (tag: string) => `Supprimer ${tag} ?`,
    removeBody: (n: number) =>
      `Le tag et ses sous-tags seront retirés de ${n} note${n > 1 ? "s" : ""}. Le reste du texte est conservé.`,
    removeConfirm: "Supprimer le tag",
    renamed: (n: number) => `${n} note${n > 1 ? "s" : ""} mise${n > 1 ? "s" : ""} à jour`,
    picker: {
      title: (tag: string) => `Icône de ${tag}`,
      search: "Rechercher une icône",
      removeIcon: "Retirer l'icône",
      count: (n: string) => `Lucide · ${n} icônes`,
      defaultColor: "Couleur par défaut",
      color: (n: number) => `Couleur ${n}`,
      results: "Résultats",
      none: "Aucune icône",
      groups: {
        travel: "Voyages et lieux",
        work: "Travail et études",
        life: "Vie quotidienne",
        nature: "Nature",
        misc: "Divers",
      },
    },
  },
  dialog: {
    cancel: "Annuler",
  },
  list: {
    title: "Notes",
    empty: "Aucune note",
    sortBy: (field: string) => `Trier : ${field}`,
    sortMenu: "Trier les notes",
    sort: {
      modified: "Date de modification",
      created: "Date de création",
      title: "Titre",
    },
    /** Short label of the sort button in the list header. */
    sortShort: {
      modified: "Modification",
      created: "Création",
      title: "Titre",
    },
    pinned: "Épinglée",
    noteActions: "Actions de la note",
    moveToTrash: "Placer dans la corbeille",
    pin: "Épingler",
    unpin: "Désépingler",
    archive: "Archiver",
    unarchive: "Désarchiver",
    restore: "Restaurer",
    deletePermanently: "Supprimer définitivement…",
    emptyTrash: "Vider la corbeille",
    todos: (done: number, total: number) => `${done} tâche${done > 1 ? "s" : ""} faite${done > 1 ? "s" : ""} sur ${total}`,
    emptySection: {
      notes: "Aucune note",
      untagged: "Toutes les notes ont un tag",
      todo: "Aucune tâche en cours",
      today: "Aucune note modifiée aujourd'hui",
      pinned: "Aucune note épinglée",
      archive: "Aucune note archivée",
      trash: "La corbeille est vide",
    },
    emptyTag: "Aucune note avec ce tag",
    deleteTitle: (n: number) => (n === 1 ? "Supprimer définitivement cette note ?" : `Supprimer définitivement ${n} notes ?`),
    deleteBody: (n: number) =>
      `${n === 1 ? "Le fichier sera envoyé" : "Les fichiers seront envoyés"} dans la corbeille de Windows : ${n === 1 ? "il disparaît" : "ils disparaissent"} d'Ursa mais reste${n === 1 ? "" : "nt"} récupérable${n === 1 ? "" : "s"} depuis Windows.`,
    deleteConfirm: "Supprimer définitivement",
  },
  editor: {
    label: "Éditeur",
    textLabel: "Texte de la note",
    placeholder: "Commencez à écrire…",
    showList: "Afficher la liste des notes",
    hideList: "Masquer la liste des notes",
    more: "Plus d'actions",
    noSelection: "Aucune note sélectionnée",
    noSelectionHint: (shortcut: string) => `Appuyez sur ${shortcut} pour créer une note.`,
    copyCode: "Copier le code",
    copied: "Copié",
    typewriter: "Mode machine à écrire",
    /** "Modifié à l'instant", "Modifié hier", "Modifié le 28 sept."… */
    editedAt: (kind: RelativeKind, when: string) =>
      kind === "weekday" || kind === "date" ? `Modifié le ${when}` : `Modifié ${when}`,
  },
  layout: {
    resizeSidebar: "Redimensionner la barre latérale",
    resizeList: "Redimensionner la liste des notes",
  },
  errors: {
    vaultOpen: (message: string) => `Impossible d'ouvrir le dossier des notes : ${message}`,
    /** Why a write failed, completing "Non sauvegardé : …". */
    reasons: {
      locked: "le fichier est verrouillé par un autre programme",
      permissionDenied: "accès au fichier refusé",
      diskFull: "le disque est plein",
      readOnly: "le dossier est en lecture seule",
      notFound: "le dossier des notes est introuvable",
      alreadyExists: "un fichier du même nom existe déjà",
      invalidName: "nom de fichier invalide",
      other: "erreur d'écriture inattendue",
    },
  },
  saveStatus: {
    unsaved: "Non sauvegardé",
    tooltip: (reason: string) => `Non sauvegardé : ${reason}. Nouvel essai automatique.`,
  },
  modal: {
    close: "Fermer",
  },
  links: {
    updated: (links: number, notes: number) =>
      `${links} lien${links > 1 ? "s" : ""} mis à jour dans ${notes} note${notes > 1 ? "s" : ""}`,
    createTitle: (title: string) => `Créer la note « ${title} » ?`,
    createBody: "Aucune note ne porte ce titre. Le lien fonctionnera dès qu'elle existera.",
    createConfirm: "Créer la note",
    backlinks: (n: number) => `Mentionnée dans ${n} note${n > 1 ? "s" : ""}`,
    breadcrumb: "Tag principal",
  },
  closeDialog: {
    title: "Modifications non enregistrées",
    subtitle: (count: number) =>
      count === 1 ? "Une note n'a pas pu être enregistrée." : `${count} notes n'ont pas pu être enregistrées.`,
    reason: (reason: string) => `Cause : ${reason}.`,
    stillFailing: "Le nouvel essai a échoué.",
    copyFailed: "La copie n'a pas pu être enregistrée.",
    retry: "Réessayer",
    saveCopy: "Enregistrer une copie ailleurs…",
    saveCopyTitle: "Enregistrer une copie des notes non sauvegardées",
    quit: "Quitter quand même",
  },
};

export type Messages = typeof fr;

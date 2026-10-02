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
    placeholder: "Rechercher",
    label: "Rechercher dans les notes",
    clear: "Effacer la recherche",
  },
  sidebar: {
    label: "Sections",
    notes: "Notes",
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
    pinned: "Épinglée",
    noteActions: "Actions de la note",
    moveToTrash: "Placer dans la corbeille",
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

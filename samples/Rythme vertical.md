---
id: 0192f3a8-0000-7000-8000-000000000005
created: 2026-10-02T12:00:00+02:00
paper: lined
margin: true
stickers:
  - { id: rythme-1, type: sticker, asset: fluent/sparkles, anchor: { block: heading, text: rythme vertical, index: 0 }, dx: 104, dy: -10, rotation: 6, size: 64, z: 0 }
  - { id: rythme-2, type: sticker, asset: fluent/potted_plant, anchor: { block: paragraph, text: chaque ligne de cette note doit tomber sur la réglure, index: 2 }, dx: 40, dy: 10, rotation: -5, size: 96, z: 1 }
  - { id: rythme-3, type: postit, text: "Les stickers et post-it ne\ndécalent jamais le texte.", color: green, anchor: { block: paragraph, text: chaque ligne de cette note doit tomber sur la réglure, index: 2 }, dx: 104, dy: 0, rotation: -2, size: 168, z: 0 }
  - { id: rythme-4, type: postit, text: Replié, color: blue, collapsed: true, anchor: { block: heading, text: images, index: 20 }, dx: 104, dy: 0, rotation: 1.5, size: 148, z: 1 }
---
# Rythme vertical
#tests/rythme #bullshit

Chaque ligne de cette note doit tomber sur la réglure de 28 px, quels que soient la police et la taille choisies. Ce paragraphe est assez long pour revenir à la ligne plusieurs fois dans la colonne de texte, avec du **gras**, de l'_italique_, du `code inline`, un [lien](https://example.com), un [[Voyage au Japon]] et du ==surlignage==.

Une ligne avec des pastilles #idée #voyages/japon-2026 #liste de courses# et un emoji 🐻.

## Titre de niveau 2
### Titre de niveau 3
#### Titre de niveau 4
##### Titre de niveau 5
###### Titre de niveau 6

Titre Setext
============

Sous-titre Setext
-----------------

- Premier élément
- Deuxième élément, assez long pour revenir à la ligne dans la colonne et vérifier l'alignement des lignes de continuation
  - Sous-élément
    - Sous-sous-élément
1. Numéroté
2. Encore
   1. Imbriqué

- [ ] Tâche
- [x] Tâche faite
  - [ ] Sous-tâche

> Une citation d'une ligne.

> Une citation sur plusieurs lignes, assez longue pour revenir à la ligne dans la colonne de texte et vérifier son rembourrage.
> Deuxième ligne de la citation.
>
> > Citation imbriquée.

```ts
const rythme = 28;
// Une ligne de code très longue qui revient à la ligne dans le bloc pour vérifier que la hauteur totale reste un multiple de l'unité.
export function aligner(hauteur: number): number {
  return Math.ceil(hauteur / rythme) * rythme;
}
```

```
```

    code indenté
    sur deux lignes

---

***

Texte après le séparateur.

| Colonne | Valeur |
|---|---|
| Tableau | brut |

## Images

Une image plus large que la colonne, ramenée à sa largeur :

![Paysage au crépuscule](assets/paysage.png)

Une image verticale à 220 px, puis une petite image à sa taille naturelle, collées l'une à l'autre :

![Mer et sable](assets/portrait.png){width=220}
![Petite](assets/petite.png)

Un schéma SVG (affiché par une balise image, jamais injecté) :

![Schéma](assets/schema.svg){width=430}

Une URL seule sur sa ligne (carte d'aperçu si le réglage est activé) :

https://example.com/articles/rythme-vertical

Un PDF joint :

[devis-renovation.pdf](assets/devis-renovation.pdf)

Fin de la note.

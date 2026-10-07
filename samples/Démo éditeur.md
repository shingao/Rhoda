---
id: 0192f3a8-0000-7000-8000-00000000d3e0
created: 2026-10-02T12:00:00+02:00
---
# Démo éditeur

Cette note contient **chaque élément** de syntaxe reconnu par Bullshit, avec ses cas limites. Place le curseur sur une ligne : sa syntaxe apparaît, estompée. Ailleurs, elle est cachée.

## Titres

# Titre de niveau 1
## Titre de niveau 2
### Titre de niveau 3
#### Titre de niveau 4
##### Titre de niveau 5
###### Titre de niveau 6

## Un titre avec du **gras**, de l'_italique_ et un #tag (ignoré dans un titre)

### Un titre très long qui ne tient pas sur une seule ligne et doit revenir à la ligne proprement, sans casser le rythme vertical

## Texte

Du **gras**, de l'_italique_, de l'*italique aussi*, du ***gras italique***, du ~~barré~~, du ==surlignage== et du `code inline`.

Du `code inline contenant des **étoiles** et des _tirets_` qui ne doivent pas être interprétés.

Un échappement : \*pas d'italique ici\*.

Du texte avec des emoji 🐻✨ au milieu, un emoji composé 👩🏽‍💻 et un drapeau 🇫🇷, sans décalage du curseur.

## Liens

Un [lien Markdown](https://example.com) (Ctrl+clic pour l'ouvrir), une URL nue https://example.org et un lien interne [[Voyage au Japon]], ou avec un alias [[Voyage au Japon|mon voyage]], vers une ancre [[Voyage au Japon#Hakone]], et un lien cassé [[Note qui n'existe pas]] (Ctrl+clic propose de la créer).

## Tags

Des tags #idée, #voyages/japon-2026, #été et #liste de courses# (#Idée = #idée) — mais pas C#, ni le ticket #123, ni n°#3, ni les couleurs #FFF et #E0654A, ni `#code`, ni https://example.com/#ancre.

## Listes

- Premier élément
- Un élément avec un [lien](https://example.com) dans une liste
- Un élément très long qui doit revenir à la ligne en restant aligné sur le texte de la puce, et non sur la puce elle-même, pour que la lecture reste confortable
  - Un sous-élément
    - Un sous-sous-élément

1. Premier
2. Deuxième
3. Troisième

## Tâches

- [x] Tâche terminée
- [ ] Tâche à faire, avec du **gras**
  - [ ] Sous-tâche imbriquée
  - [x] Sous-tâche terminée
- [ ] Une tâche avec un #tag et du `code`

## Citations

> Une citation sur une seule ligne.

> Une citation sur
> plusieurs lignes, avec du **gras**.
>
> > Et une citation imbriquée.

## Code

```js
// Un commentaire
function saluer(nom) {
  const message = `Bonjour ${nom}`;
  return message.length > 42 ? null : message;
}
```

```
Bloc sans langage, avec une ligne très longue qui dépasse largement la largeur de la colonne de texte pour vérifier le retour à la ligne.
```

## Séparateur

Au-dessus du séparateur.

---

En dessous du séparateur.

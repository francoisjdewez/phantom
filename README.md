# PHANTOM

Un jeu contemplatif en 3D, jouable dans le navigateur.
Tu incarnes Phantom, une petite créature de lumière qui réveille un monde endormi en l'illuminant.

**[Jouer sur itch.io](https://phantomex2.itch.io/phantom-game)**

> Le jeu se joue pour l'instant **au clavier**. Il n'a pas encore de commandes tactiles :
> sur téléphone, il s'ouvre, mais Phantom ne peut pas se déplacer.

## Commandes

| Touche | Action |
|---|---|
| `Entrée` | Commencer |
| `Z` `Q` `S` `D` | Se déplacer |
| `Espace` | Illuminer |

## Technique

- **TypeScript**, construit avec **Vite**
- **Three.js** pour le rendu 3D
- **Vitest** pour les tests : 158 tests sur la logique du jeu
- **Tone.js** pour la musique (désactivée pour l'instant)

## Organisation du code

```text
index.html        page du jeu et interface
src/main3d.ts     point d'entrée et boucle de jeu
src/core/         logique du jeu, testable sans navigateur
src/regions/      contenu des régions 1 et 2
src/render3d/     rendu 3D
src/audio/        musique
test/             tests automatiques
```

La logique (`core`) ne connaît pas le rendu : c'est ce qui permet de la tester sans navigateur.

Quelques modules de `src/core/` (`stats/`, `reactions.ts`, `cendres.ts`) sont écrits et testés,
mais pas encore branchés au jeu.

## Lancer le projet

Il faut [Node.js](https://nodejs.org). Dans PowerShell, depuis ce dossier :

```powershell
npm install       # installer les dépendances (la première fois)
npm run dev       # lancer le jeu en local
npm test          # lancer les tests
npm run build     # construire la version finale dans dist\
```

## Droits

Code publié pour être consulté. Tous droits réservés.

// ════════════════════════════════════════════════════════════════════════
//  regions/region2.ts — DONNÉES de la Région 2 « La Clairière Oubliée » (Acte II).
//  On va ICI APRÈS avoir éveillé la Région 1. C'est une 2e zone à raviver :
//  même MOTEUR (Region.ts) → le rendu 3D reconstruit les nœuds à partir de leur `type`.
//
//  ÉQUILIBRAGE : on RÉUTILISE les taux validés en R1. Seules les positions et les
//  rêves changent.
//  CORRECTIF 19/08/2026 (playtest) : ce fichier disait déjà "on réutilise
//  les taux de R1" mais gardait les valeurs D'AVANT le rééquilibrage du 22/06 (gr/dc
//  jamais mis à jour ici quand R1 est passé de 0.07-0.08 à 0.13-0.14). Résultat : R2
//  s'éveillait ~32s contre ~12s pour R1 — "l'illumination moins forte" ressentie en
//  playtest. Valeurs alignées sur region1.ts (rythme RAPIDE assumé).
//  RETRAIT 21/06/2026 (choix de design) : la FLEUR et le CHAMPIGNON-CRISTAL sont
//  retirés du jeu. R2 ne garde que le Cœur + le Monument.
//  Repère monde : W=320, H=180, GY=144 (comme R1).
//  Ce fichier ne contient QUE des données — aucune logique, aucun rendu.
// ════════════════════════════════════════════════════════════════════════

import type { RegionData } from "../core/types.js";

const GY = 144; // ligne de sol logique (identique à R1)

export const region2: RegionData = {
  id: "region2",
  nom: "La Clairière Oubliée",
  acte: 2,

  // Le Cœur de région : LE FOYER COMMUN du Zurg (zone B). PHASE 2 (cosmétique) : SEUL
  // le `type` change (heart→foyer) ; il reste le Cœur, id et équilibrage IDENTIQUES.
  coeur: {
    id: "r2-heart",
    type: "foyer", // le Foyer commun (créature lovée en arc — un nid, pas un garde)
    pos: { x: 160, y: GY - 8 }, // un peu en retrait (plus loin que le Cœur de R1)
    v: 0.06,
    attR: 50,
    gr: 0.14, // aligné sur le Cœur de R1 rééquilibré (19/08, était resté à 0.06)
    dc: 0.04, // aligné sur R1 (19/08, était resté à 0.006) — on SENT le déclin
    ancree: 0.02,
    ancreeApresEveil: 0.66, // aligné sur R1 (19/08, était resté à 0.5)
    eveille: false,
    reve: "proteger", // le Cœur protège la clairière et tout ce qu'elle abrite
  },

  // Nœud secondaire. PHASE 2 (cosmétique) : il DEVIENT « le Chantier suspendu » (des
  // blocs qui s'assemblent en arche). SEULS id et type changent ; équilibrage IDENTIQUE.
  noeuds: [
    {
      id: "r2-chantier",
      type: "chantier", // blocs flottants qui s'assemblent en portail (kintsugi d'or)
      pos: { x: 270, y: GY }, // tout à droite
      v: 0.08,
      attR: 36,
      gr: 0.13, // aligné sur la maison de R1 rééquilibrée (19/08, était resté à 0.045)
      dc: 0.04, // aligné sur R1 (19/08, était resté à 0.025)
      ancree: 0.02,
      ancreeApresEveil: 0.62, // aligné sur R1 (19/08, était resté à 0.45)
      eveille: false,
      reve: "creer", // bâtir de nouveau sur les ruines
    },
  ],

  // Condition de victoire R2 : VRAIMENT identique à R1 désormais.
  // ALIGNEMENT 21/06/2026 (choix de design) : coeurMin 0.88→0.75 — la zone B
  // demandait plus d'effort que la zone A sans raison (ancienne valeur oubliée).
  victoire: {
    coeurMin: 0.75,
    noeudMin: 0.6,
  },
};

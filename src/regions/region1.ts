// ════════════════════════════════════════════════════════════════════════
//  regions/region1.ts — DONNÉES de la Région 1 « L'Arbre des Piuws » (Acte I).
//  Valeurs d'ÉQUILIBRAGE tranchées par la cellule Design :
//    cible : nœud 8–15 s, région ~60 s.
//  RÉÉQUILIBRAGE 21/06/2026 (game-designer + systems-designer) : R1 était INÉVEILLABLE
//  pour un vrai joueur (les nœuds éveillés s'ancraient à 0.45, SOUS le seuil de victoire
//  0.6 → acquis qui se re-perdaient). Correctif : `ancreeApresEveil` des nœuds → 0.62
//  (éveillé = ACQUIS), Cœur moins exigeant (coeurMin 0.88→0.75), montées plus rapides.
//  RETRAIT 21/06/2026 (choix de design) : la FLEUR et le CHAMPIGNON-CRISTAL sont
//  retirés du jeu. R1 ne garde que l'Arbre (Cœur) + le Monument.
//  Repère monde : W=320, H=180, GY=144, WW=640.
//  Ce fichier ne contient QUE des données — aucune logique, aucun rendu.
// ════════════════════════════════════════════════════════════════════════

import type { RegionData } from "../core/types.js";

const GY = 144; // ligne de sol logique

export const region1: RegionData = {
  id: "region1",
  nom: "L'Arbre des Piuws",
  acte: 1,

  // Le Cœur de région : l'arbre ancestral.
  // PLACEMENT « vue de face » (chantier UX 3) : PROGRESSION EN PROFONDEUR sur l'axe d'avancée
  // (+x), tout centré (z≈0) : départ → Piuw → Arbre (DEVANT) → Maison (DERRIÈRE). cf. §10.
  coeur: {
    id: "r1-tree",
    type: "heart",
    pos: { x: 188, y: GY },
    v: 0.06,
    attR: 50,
    gr: 0.14, // rééq. 22/06 (0.08→0.14) : l'Arbre montait trop lentement (playtest)
    dc: 0.04, // rééq. 22/06 (0.006→0.04) : retombait trop lentement → on SENT le déclin
    ancree: 0.02,
    ancreeApresEveil: 0.66, // rééq. 22/06 (0.5→0.66) : tient au-dessus de l'éveil malgré le dc plus fort
    eveille: false,
    reve: "transmettre", // l'Arbre des Piuws : Sonba y conte chaque soir
  },

  // Nœud d'attention secondaire. PHASE 2 (cosmétique) : ce nœud DEVIENT « la Maison »
  // de Phantom (zone A = le jardin intime). SEULS l'id et le type changent ; tout
  // l'équilibrage (pos/gr/dc/attR/ancree/ancreeApresEveil/reve) reste IDENTIQUE.
  noeuds: [
    {
      id: "r1-maison",
      type: "maison", // la maison de Phantom (ex-monument) — se rallume quand on la ravive
      // DERRIÈRE l'Arbre (plus loin sur l'axe +x = profondeur conservée), mais LÉGÈREMENT
      // décalée sur le côté (y > GY) pour qu'elle ne soit plus CACHÉE/bloquée par l'Arbre
      // (playtest 22/06 : on garde « Arbre devant / Maison derrière », sans occlusion).
      pos: { x: 328, y: 214 },
      v: 0.08,
      attR: 36,
      gr: 0.13, // rééq. 22/06 (0.07→0.13) : montée plus rapide (playtest)
      dc: 0.04, // rééq. 22/06 (0.018→0.04) : on SENT le déclin quand on s'éloigne
      ancree: 0.02,
      ancreeApresEveil: 0.62, // rééq. 21/06 (0.45→0.62) : éveillé = ACQUIS
      eveille: false,
      reve: "comprendre", // le monument : le passé, la civilisation, le savoir
    },
  ],

  // Condition de victoire R1. coeurMin abaissé 0.88→0.75 (rééq. 21/06) : le Cœur reste
  // clairement le plus vivant, mais on ne « grinde » plus 30 s dessus.
  victoire: {
    coeurMin: 0.75,
    noeudMin: 0.6,
  },
};

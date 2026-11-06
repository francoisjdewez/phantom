// ════════════════════════════════════════════════════════════════════════
//  core/flux.ts — LE FIL DU JEU (machine à états).
//
//  PHASE 2 « MONDE CONTINU » : il n'y a plus de bascule R1→R2 par écran. Les DEUX
//  régions coexistent dans une seule scène (zone A + zone B reliées par un pont).
//  Le fil se réduit donc à :  titre → on JOUE le monde → victoire finale → (rejouer).
//  (L'étape intermédiaire « victoire-region » a disparu avec le swap de région.)
//
//  PRINCIPE (comme tout core/) : AUCUN Three.js, AUCUN DOM ici.
//  Ce module ne fait que DIRE « on est dans tel écran ». C'est main3d (les yeux +
//  les mains) qui REGARDE cet état et affiche/masque les overlays ou bâtit le décor.
// ════════════════════════════════════════════════════════════════════════

import type { RegionData } from "./types.js";
import { region1 } from "../regions/region1.js";
import { region2 } from "../regions/region2.js";

/**
 * Les ÉCRANS possibles du jeu, dans l'ordre où on les traverse.
 *  - "titre"           : l'écran d'accueil (avant d'entrer dans le jeu).
 *  - "region"          : on JOUE le MONDE CONTINU (les deux zones en même temps).
 *  - "victoire-finale" : les DEUX zones sont éveillées → la fin heureuse.
 */
export type Etape = "titre" | "region" | "victoire-finale";

/** Les deux régions du monde continu (zone A = [0], zone B = [1]). */
const REGIONS: RegionData[] = [region1, region2];

/**
 * La machine à états du jeu. On l'interroge (`etape`) et on la fait avancer
 * (`commencer()`, `mondeEveille()`, `rejouer()`).
 */
export class Flux {
  /** L'écran courant. On démarre TOUJOURS sur le titre. */
  etape: Etape = "titre";

  /** Combien de régions au total (zone A + zone B). */
  get nbRegions(): number {
    return REGIONS.length;
  }

  /** Les données des deux régions du monde (A puis B). */
  get regions(): RegionData[] {
    return REGIONS;
  }

  /**
   * Depuis le TITRE : le joueur appuie pour entrer → on JOUE le monde continu.
   * (Si on n'est pas sur le titre, ne fait rien : transition ignorée.)
   */
  commencer(): void {
    if (this.etape !== "titre") return;
    this.etape = "region";
  }

  /**
   * Pendant le jeu : les DEUX zones viennent d'être éveillées → VICTOIRE FINALE.
   * (main3d ne l'appelle que lorsque les deux drapeaux `eveillee` sont latchés.)
   * Hors du jeu, ne fait rien.
   */
  mondeEveille(): void {
    if (this.etape !== "region") return;
    this.etape = "victoire-finale";
  }

  /**
   * Depuis la VICTOIRE FINALE : le joueur appuie pour rejouer → retour au titre,
   * tout est remis à zéro (rejouabilité voulue).
   */
  rejouer(): void {
    if (this.etape !== "victoire-finale") return;
    this.etape = "titre";
  }
}

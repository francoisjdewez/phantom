// ════════════════════════════════════════════════════════════════════════
//  core/phantom.ts — LA LUMIÈRE de Phantom (logique PURE, 100 % testable).
//
//  L'ILLUMINATION est le geste central du jeu :
//  Phantom projette sa lumière → ça fait grandir le vivant autour. Mais illuminer
//  PUISE dans sa propre lumière. Il se RECHARGE en restant près de la vie qu'il a
//  fait renaître (réciprocité : il donne la vie, la vie le nourrit).
//
//  Ce fichier ne gère QUE la réserve de lumière (un nombre entre 0 et 1) et ses
//  règles de dépense/recharge. Il ne sait rien du rendu ni des touches — c'est
//  `render3d` qui dira "le joueur appuie sur Espace", et `core/Region` qui utilisera
//  le résultat pour décider si les éléments grandissent.
// ════════════════════════════════════════════════════════════════════════

import { clamp01 } from "./attention.js";

/** Réserve de lumière au départ : Phantom commence PLEIN (1 = 100 %). */
export const LUMIERE_DEPART = 1;

/**
 * Coût de l'illumination, par seconde. Avec 0.15, illuminer SANS RIEN recharger
 * vide une réserve pleine en ~6-7 s → volontairement GÉNÉREUX (jamais anxiogène).
 * Valeur de départ, à régler en playtest.
 */
export const COUT_ILLUMINATION = 0.08;

/**
 * Recharge par seconde quand Phantom NE PAS illumine, PROPORTIONNELLE à la vie
 * proche (`vieProche` ∈ [0,1]). À 0.25 et près d'un élément bien vivant, on
 * recharge plus vite qu'on ne dépense → la boucle "donner / se ressourcer" tourne.
 * Valeur de départ, à régler en playtest.
 */
export const RECHARGE_PRES_DU_VIVANT = 0.6;

/**
 * L'état lumineux de Phantom. Une seule donnée : `lumiere` ∈ [0,1].
 * (On en fait une classe pour pouvoir, plus tard, y ajouter d'autres états de
 *  Phantom sans toucher au reste — ex. son halo, sa position logique.)
 */
export class Phantom {
  /** La réserve de lumière courante ∈ [0,1]. Commence pleine. */
  lumiere = LUMIERE_DEPART;

  /**
   * Avance la lumière d'un pas de temps.
   *
   * @param dt              secondes écoulées depuis la dernière frame.
   * @param illumineDemande le joueur tient-il la touche d'illumination ?
   * @param vieProche       quantité de vie autour de Phantom ∈ [0,1]
   *                        (0 = rien de vivant proche, 1 = entouré de vie).
   * @returns `illumineActif` : VRAI seulement si le joueur illumine ET qu'il
   *          reste de la lumière. C'est CE booléen que `Region` utilisera pour
   *          décider si les éléments à portée grandissent.
   */
  update(dt: number, illumineDemande: boolean, vieProche: number): boolean {
    // On illumine vraiment seulement s'il y a de la lumière à dépenser.
    const illumineActif = illumineDemande && this.lumiere > 0;

    // RECHARGE près du vivant — MÊME pendant qu'on illumine (rééq. 22/06, playtest :
    // donner la vie à ce qui vit te NOURRIT → illuminer un élément qu'on ravive ne vide plus
    // la réserve, donc la lumière ne te lâche plus jamais en plein geste). Loin de toute vie
    // (vieProche=0), il n'y a pas de recharge → illuminer DANS LE VIDE finit encore par puiser
    // (l'esprit « ressource » du mécanisme est conservé, sans jamais bloquer le jeu réel).
    const cout = illumineActif ? COUT_ILLUMINATION : 0;
    this.lumiere += (RECHARGE_PRES_DU_VIVANT * vieProche - cout) * dt;

    // Toujours borné dans [0,1].
    this.lumiere = clamp01(this.lumiere);
    return illumineActif;
  }
}

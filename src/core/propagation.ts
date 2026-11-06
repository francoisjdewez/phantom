// ════════════════════════════════════════════════════════════════════════
//  core/propagation.ts — LA PROPAGATION de l'attention de nœud à nœud.
//  Comportement vivant [CIBLE → CODÉ-R1, 2026-06-18] : un nœud DÉJÀ éveillé et
//  haut « contamine » doucement ses voisins proches, même sans le regard du
//  joueur. C'est le cœur émergent du jeu : la vie appelle la vie.
//  Logique PURE (100% testable).
//
//  Découpe des constantes (décision « constantes d'émergence PARTAGÉES »,
//  2026-06-17) : l'INTENTION/ordre de grandeur vient du systems-designer ;
//  la VALEUR exacte est posée ici (technical-designer) et ajustable au playtest.
// ════════════════════════════════════════════════════════════════════════

import type { AttentionNode } from "./types.js";
import { dist, clamp01 } from "./attention.js";

/** Portée (en coordonnées monde) sous laquelle un nœud en contamine un autre. */
export const PROPAGATION_RAYON = 110;

/** Taux de contamination par seconde, à PLEINE proximité et émetteur à v=1. */
export const PROPAGATION_GAIN = 0.025;

/**
 * Le flux d'attention RESPIRE plutôt que de couler à débit constant : un émetteur
 * envoie sa lumière par vagues douces. Lisibilité (« on VOIT le don passer ») +
 * organicité, sans changer le débit MOYEN (l'oscillation est centrée sur 1).
 *   - AMPLITUDE : profondeur de la pulsation (0 = plat, comme avant ; 0.4 = ±40%).
 *   - PERIODE : durée d'un cycle de respiration (secondes).
 * Réglages technical-designer, ajustables au playtest. La MOYENNE temporelle du
 * gain reste PROPAGATION_GAIN → l'équilibrage (vitesse d'éveil) est préservé.
 */
export const PROPAGATION_PULSE_AMPLITUDE = 0.35;
export const PROPAGATION_PULSE_PERIODE = 2.4;

/**
 * `v` minimal pour qu'un nœud éveillé RAYONNE. En dessous, il est vivant mais
 * trop fragile pour aider les autres (il a déjà du mal à se tenir lui-même).
 */
export const PROPAGATION_SEUIL_EMETTEUR = 0.6;

/**
 * Applique une passe de propagation sur l'ensemble des nœuds (Cœur compris).
 *
 * Règles :
 *   - SEUL un nœud `eveille` ET dont `v >= PROPAGATION_SEUIL_EMETTEUR` émet.
 *     → tant qu'aucun nœud n'est éveillé, la propagation ne fait RIEN
 *       (le joueur reste l'unique moteur du tout premier éveil).
 *   - chaque émetteur pousse un petit gain à ses voisins dans le rayon,
 *     proportionnel à sa propre vie, à la proximité et à `dt`.
 *   - les gains ne font que MONTER `v` (jamais descendre) : la propagation
 *     est une aide, pas une punition. Le clamp [0,1] est respecté.
 *
 * Indépendant de l'ordre : on calcule tous les gains à partir d'un instantané
 * des `v` AVANT de les appliquer (deux nœuds hauts s'entraident symétriquement).
 *
 * @param nodes tous les nœuds de la région (Cœur + secondaires).
 * @param dt    secondes écoulées depuis la dernière frame.
 * @param t     temps absolu écoulé (s) pour faire RESPIRER le flux. Optionnel :
 *              omis (ou 0), le débit est plat — strictement l'ancien comportement,
 *              donc rétrocompatible. Chaque émetteur pulse avec une phase liée à
 *              sa position → les nœuds ne « respirent » pas tous en même temps.
 */
export function propagerAttention(
  nodes: AttentionNode[],
  dt: number,
  t = 0,
): void {
  const n = nodes.length;
  const vAvant = nodes.map((node) => node.v);
  const gains = new Array<number>(n).fill(0);
  const omega = (2 * Math.PI) / PROPAGATION_PULSE_PERIODE;

  for (let i = 0; i < n; i++) {
    const emetteur = nodes[i];
    if (!emetteur.eveille || vAvant[i] < PROPAGATION_SEUIL_EMETTEUR) continue;

    // Pulsation propre à l'émetteur : la phase dépend de sa position pour que les
    // vagues se chevauchent au lieu de battre à l'unisson. Centrée sur 1 → le gain
    // MOYEN dans le temps reste PROPAGATION_GAIN (équilibrage intact).
    const phase = (emetteur.pos.x + emetteur.pos.y) * 0.05;
    const pulse = 1 + PROPAGATION_PULSE_AMPLITUDE * Math.sin(omega * t + phase);

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = dist(emetteur.pos, nodes[j].pos);
      if (d >= PROPAGATION_RAYON) continue;
      const proximite = 1 - d / PROPAGATION_RAYON; // 1 tout près → 0 au bord
      gains[j] += PROPAGATION_GAIN * vAvant[i] * proximite * pulse * dt;
    }
  }

  for (let j = 0; j < n; j++) {
    if (gains[j] > 0) nodes[j].v = clamp01(nodes[j].v + gains[j]);
  }
}

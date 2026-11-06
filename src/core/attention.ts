// ════════════════════════════════════════════════════════════════════════
//  core/attention.ts — LES FORMULES du système d'attention.
//  Extrait fidèlement du prototype `phantom.html` (fonctions `atn` + update
//  des nœuds), puis nettoyé et commenté. Logique PURE, 100% testable.
//
// ════════════════════════════════════════════════════════════════════════

import type { AttentionNode, Vec2 } from "./types.js";

/** Distance euclidienne entre deux points. */
export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Garde une valeur dans [0,1]. */
export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Force d'attention exercée par le regard sur une cible.
 * Reprend `atn(o,r)` du prototype : 1 quand le regard est pile dessus,
 * décroît linéairement jusqu'à 0 au bord du rayon `r`, et 0 au-delà.
 * @returns un facteur ∈ [0,1].
 */
export function attentionAt(regard: Vec2, cible: Vec2, rayon: number): number {
  const d = dist(regard, cible);
  return d < rayon ? 1 - d / rayon : 0;
}

/**
 * Met à jour la valeur `v` d'un nœud pour un pas de temps `dt` (secondes).
 * Reprend EXACTEMENT la règle du prototype :
 *   - regardé (a>0) : v += a * gr * dt        (croissance)
 *   - sinon         : v -= dc * (1 - v*0.8) * dt   (oubli ralenti = mémoire ancrée)
 * Puis on applique le plancher de mémoire ancrée et le clamp [0,1].
 *
 * @param attention facteur de regard ∈ [0,1] (issu de `attentionAt`).
 * @param plancher  plancher EFFECTIF sous lequel `v` ne descend pas. Optionnel :
 *                  par défaut `node.ancree` (= comportement historique exact).
 *                  La « peur de perdre » passe un plancher ÉRODÉ (cf. plancherErode)
 *                  pour qu'un nœud longtemps négligé puisse re-décliner doucement.
 */
export function updateNodeAttention(
  node: AttentionNode,
  attention: number,
  dt: number,
  plancher: number = node.ancree,
): void {
  if (attention > 0) {
    node.v = node.v + attention * node.gr * dt;
  } else {
    // (1 - v*0.8) : plus c'est ravivé, plus l'oubli est lent (mémoire ancrée).
    node.v = node.v - node.dc * (1 - node.v * 0.8) * dt;
  }
  // Plancher de mémoire (effectif) : les acquis ne s'effacent jamais TOUT à fait.
  node.v = Math.max(plancher, node.v);
  // Toujours dans [0,1].
  node.v = clamp01(node.v);
}

// ════════════════════════════════════════════════════════════════════════
//  LA « PEUR DE PERDRE » (re-déclin lent sur négligence prolongée).
//  Une fois éveillé, un nœud est ANCRÉ (plancher `ancreeApresEveil`) et ne peut
//  plus mourir → en fin de partie, plus aucune tension. Pour faire REVENIR
//  l'enjeu sans punir, on autorise le plancher d'un nœud LONGTEMPS négligé à
//  s'éroder TRÈS lentement vers un minimum (jamais 0 : un fil de mémoire reste).
//  Dès qu'on le regarde, la négligence se réinitialise (cf. Region) et le plancher
//  remonte. Logique PURE et SANS état : Region porte le compteur de négligence.
// ════════════════════════════════════════════════════════════════════════

/**
 * Délai de GRÂCE (s) : un nœud doit être négligé AU MOINS aussi longtemps avant
 * que son plancher commence à s'éroder. Assez long pour qu'une partie active
 * normale (éveil 60–120 s) n'érode jamais rien — l'équilibrage est préservé.
 */
export const PEUR_DELAI_GRACE = 25;

/**
 * Plancher minimum absolu : même totalement abandonné, un nœud éveillé ne retombe
 * jamais sous cette valeur — il « se rendort » sans jamais mourir. (Un nœud JAMAIS
 * éveillé garde son `ancree` d'origine, très bas : lui peut encore « mourir »
 * comme avant, ce qui sert le tutoriel de la Région 1.)
 */
export const PEUR_PLANCHER_MIN = 0.15;

/**
 * Vitesse d'érosion du plancher (par seconde) une fois le délai de grâce dépassé.
 * VOLONTAIREMENT lente : il faut plusieurs dizaines de secondes de négligence
 * TOTALE pour faire descendre sensiblement un nœud. Jamais punitif.
 */
export const PEUR_VITESSE_EROSION = 0.012;

/**
 * Plancher EFFECTIF d'un nœud compte tenu de sa négligence cumulée.
 *
 * Pédagogie : tant qu'on s'occupe (un peu) d'un nœud, son plancher est intact
 * (= `ancree`). S'il est négligé au-delà du délai de grâce, le plancher se met à
 * descendre, lentement, mais jamais sous `PEUR_PLANCHER_MIN`. C'est ce plancher
 * abaissé qu'on passe à `updateNodeAttention` → `v` peut alors re-décliner.
 *
 *   - negligeSecondes ≤ GRÂCE → plancher = ancree (rien ne change).
 *   - au-delà                 → plancher = ancree − érosion (borné à MIN).
 *
 * @param node            le nœud (on lit `ancree`).
 * @param negligeSecondes temps cumulé sans regard (s), géré par Region.
 * @returns le plancher effectif ∈ [min(ancree, PLANCHER_MIN), ancree].
 */
export function plancherErode(node: AttentionNode, negligeSecondes: number): number {
  if (negligeSecondes <= PEUR_DELAI_GRACE) return node.ancree;
  // Un nœud dont le plancher d'origine est déjà bas (jamais éveillé) n'est jamais
  // REMONTÉ : on borne par le plus petit des deux (ancree ou PLANCHER_MIN).
  const minimum = Math.min(node.ancree, PEUR_PLANCHER_MIN);
  const erosion = (negligeSecondes - PEUR_DELAI_GRACE) * PEUR_VITESSE_EROSION;
  return Math.max(minimum, node.ancree - erosion);
}

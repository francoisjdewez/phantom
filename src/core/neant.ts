// ════════════════════════════════════════════════════════════════════════
//  core/neant.ts — LE NÉANT qui efface (comportement vivant, 2026-06-18).
//  Le Néant est l'oubli rendu VISIBLE : une intensité de région ∈ [0,1] qui
//  « gagne du terrain » quand la zone est abandonnée, et RECULE quand la vie
//  y revient. Il ne touche PAS directement la vie des nœuds (l'oubli `dc` s'en
//  charge déjà) : il en est la manifestation atmosphérique que le rendu lit.
//  Logique PURE (100% testable).
//
//  Constantes : INTENTION/ordre de grandeur = systems-designer ; VALEUR exacte
//  posée ici (technical-designer), ajustable au playtest. Décision « constantes
//  d'émergence PARTAGÉES » du 2026-06-17.
// ════════════════════════════════════════════════════════════════════════

import { clamp01 } from "./attention.js";

/**
 * Vie moyenne (`progression`) au-dessus de laquelle le Néant ne peut plus tenir :
 * la région est assez vivante pour le repousser entièrement.
 */
export const NEANT_SEUIL_VIE = 0.55;

/** Vitesse (par seconde) à laquelle le Néant REVIENT quand on abandonne la zone (lent, sourd). */
export const NEANT_VITESSE_MONTEE = 0.08;

/** Vitesse (par seconde) à laquelle la lumière REPOUSSE le Néant quand on nourrit la zone.
 *  Baissé 0.5 → 0.28 (playtest 2026-06-18 : le vide reculait trop vite ; il s'attarde
 *  davantage = plus de tension/mélancolie). Reste > montée (0.08) : nourrir repousse bien le vide. */
export const NEANT_VITESSE_RECUL = 0.28;

/**
 * Intensité de Néant « visée » pour une vie moyenne donnée.
 *   - progression = 0            → Néant plein (1)
 *   - progression ≥ SEUIL_VIE    → Néant nul  (0)
 *   - entre les deux             → décroissance linéaire
 */
export function neantCible(progression: number): number {
  return clamp01(1 - progression / NEANT_SEUIL_VIE);
}

/**
 * Calcule l'intensité de Néant à la frame suivante : elle se rapproche de sa
 * cible, LENTEMENT quand elle monte (le Néant rampe), plus vite quand elle
 * recule (la lumière agit). Approche exponentielle stable même à grand `dt`
 * (`1 - exp(-k·dt)` ne diverge pas — cf. note de l'ai-programmer sur l'amortissement).
 *
 * @param neant       intensité courante ∈ [0,1].
 * @param progression vie moyenne courante de la région ∈ [0,1].
 * @param dt          secondes écoulées depuis la dernière frame.
 * @returns la nouvelle intensité ∈ [0,1].
 */
export function prochainNeant(neant: number, progression: number, dt: number): number {
  const cible = neantCible(progression);
  const vitesse = cible > neant ? NEANT_VITESSE_MONTEE : NEANT_VITESSE_RECUL;
  const k = 1 - Math.exp(-vitesse * dt);
  return clamp01(neant + (cible - neant) * k);
}

/**
 * Vie d'un nœud en-dessous de laquelle sa DÉTRESSE locale devient visible :
 * le vide commence vraiment à « se refermer » sur un nœud presque éteint.
 */
export const NEANT_DETRESSE_SEUIL = 0.4;

/**
 * DÉTRESSE LOCALE d'UN nœud, indépendante du Néant GLOBAL de la région (P1 du critic).
 * Un nœud isolé qui s'éteint doit TOUJOURS montrer son vide qui se referme, même si
 * la région va bien (neant global ≈ 0). Quand on le ravive, sa détresse retombe à 0.
 *
 *   - v ≥ SEUIL (0.4) → 0 (aucune détresse : le nœud tient).
 *   - v = 0           → 1 (détresse maximale : le vide l'absorbe).
 *   - entre les deux  → montée linéaire (de 0 au seuil vers 1 à vie nulle).
 *
 * Seuillé pour que la détresse n'apparaisse QUE sur les nœuds vraiment en danger
 * (un nœud à mi-vie ne « saigne » pas du vide), et reste lisible (assombrissement
 * progressif, pas un signal qui clignote partout).
 *
 * @param v vie du nœud ∈ [0,1].
 * @returns facteur de détresse ∈ [0,1].
 */
export function detresseLocale(v: number): number {
  return clamp01((NEANT_DETRESSE_SEUIL - v) / NEANT_DETRESSE_SEUIL);
}

/**
 * Durée (s) de détresse SOUTENUE au bout de laquelle les « vrilles du vide »
 * (doigts d'encre montant vers un nœud négligé) atteignent leur allongement
 * maximal. En-deçà, les vrilles sont courtes ; au-delà, saturées.
 * VISUEL uniquement (lu par le rendu) — ne touche jamais la vie des nœuds.
 */
export const NEANT_VRILLE_SATURATION = 5;

/**
 * Allongement ∈ [0,1] des vrilles du vide en fonction du TEMPS CUMULÉ de détresse
 * d'un nœud (`timer`, en secondes) et de l'intensité de sa détresse instantanée
 * (`det` ∈ [0,1], typiquement `detresseLocale(v)`).
 *
 * Pédagogie : c'est un simple « combien de doigt a poussé ». Deux conditions
 * doivent tenir pour qu'une vrille s'allonge :
 *   1) la détresse a DURÉ (timer monte vers la saturation → montée douce, ease-out),
 *   2) la détresse est ENCORE là MAINTENANT (det) — dès qu'on ravive, `det` chute
 *      et les vrilles se rétractent même si le timer met un instant à retomber.
 * Résultat borné [0,1] (longueur = ce facteur × longueur max, côté rendu).
 *
 * @param timer temps cumulé de détresse (s), ≥ 0.
 * @param det   détresse instantanée du nœud ∈ [0,1].
 * @returns facteur d'allongement ∈ [0,1] (0 = pas de vrille, 1 = vrille pleine).
 */
export function vrilleAllongement(timer: number, det: number): number {
  if (timer <= 0 || det <= 0) return 0;
  const t = clamp01(timer / NEANT_VRILLE_SATURATION);
  const pousse = 1 - (1 - t) * (1 - t); // ease-out : démarre vite, sature en douceur
  return clamp01(pousse * det);
}

/**
 * Amplitude de base du FRÉMISSEMENT du vide : de combien son bord « respire »
 * (en fraction de son intensité). VISUEL uniquement — ne touche jamais la vie.
 */
export const NEANT_FREMISSEMENT_AMPLITUDE = 0.06;

/**
 * FRÉMISSEMENT du Néant : un petit tremblement ∈ [-a, +a] à ajouter à l'intensité
 * de bord côté rendu, pour que le vide « ronge » de façon INÉGALE et vivante au
 * lieu d'avancer comme un mur parfaitement lisse.
 *
 * Pédagogie : c'est une vibration, pas une force. On superpose deux ondes de
 * fréquences différentes (une lente, une plus rapide) pour éviter un battement
 * trop régulier — l'œil ne doit pas pouvoir « prédire » le rythme. Et plus le
 * Néant est INTENSE, plus il frémit fort (l'oubli profond est plus avide, plus
 * agité) : à intensité 0, le frémissement est nul (rien à ronger).
 *
 * @param t          temps absolu (s).
 * @param intensite  intensité courante du Néant ∈ [0,1].
 * @returns un décalage ∈ [-NEANT_FREMISSEMENT_AMPLITUDE, +NEANT_FREMISSEMENT_AMPLITUDE]
 *          environ, mis à l'échelle de l'intensité (0 quand le vide est absent).
 */
export function neantFremissement(t: number, intensite: number): number {
  const onde = Math.sin(t * 2.3) * 0.6 + Math.sin(t * 5.1 + 1.7) * 0.4;
  return onde * NEANT_FREMISSEMENT_AMPLITUDE * clamp01(intensite);
}

// ════════════════════════════════════════════════════════════════════════
//  « L'EFFACEMENT » — le Néant n'AJOUTE rien (pas de virus, pas de glitch) :
//  il RETIRE. Un nœud négligé cesse simplement d'exister. Les fonctions ci-
//  dessous sont PURES (aucun Three.js) : elles calculent des facteurs ∈ [0,1]
//  que le rendu lit pour dématérialiser/délaver/trouer. (2026-06-20)
// ════════════════════════════════════════════════════════════════════════

/**
 * OPACITÉ d'une PIÈCE (sous-mesh) d'un objet qui s'efface.
 *
 * Pédagogie : quand un objet est très en détresse, ses morceaux « luttent pour
 * exister » — certains disparaissent par instants, comme une silhouette
 * incomplète. On donne à chaque pièce sa propre `phase` pour qu'elles oscillent
 * INDÉPENDAMMENT (l'objet ne clignote pas d'un bloc, il se troue par endroits).
 *
 * Le clignotement est DOUX (un sinus lent, jamais un stroboscope) et ne mord que
 * proportionnellement à la détresse : à `det = 0` l'opacité est toujours 1
 * (pièce pleine et opaque dès qu'on ravive), à `det = 1` elle peut descendre
 * jusqu'à `1 - profondeur` au creux du sinus.
 *
 * @param t          temps absolu (s).
 * @param phase      phase propre à la pièce (∈ [0, 2π]) → désynchronise les morceaux.
 * @param det        détresse instantanée du nœud ∈ [0,1].
 * @param profondeur creux maximal du clignotement à détresse pleine (défaut 0.7).
 * @returns opacité ∈ [1 - profondeur, 1] (vaut 1 quand det = 0).
 */
export function oscillationPiece(t: number, phase: number, det: number,
                                 profondeur = 0.7): number {
  const d = clamp01(det);
  if (d <= 0) return 1;
  // Sinus lent (fréquence 1.6 rad/s) ramené dans [0,1], puis on en retire une
  // fraction = profondeur × détresse. Plus la détresse est forte, plus le creux
  // est profond ET fréquent à l'œil (mais l'amplitude reste bornée).
  const creux = (0.5 - 0.5 * Math.sin(t * 1.6 + phase)) * profondeur * d;
  return clamp01(1 - creux);
}

/**
 * RAYON du TROU de vide sous un nœud effacé, en fraction de son rayon max.
 *
 * Pédagogie : sous un nœud qu'on laisse mourir, le décor lui-même « cesse
 * d'exister » — un disque de vide grandit au sol. Il reste nul tant que la
 * détresse est faible (pas de trou autour d'un nœud à mi-vie), puis grandit en
 * douceur (ease-in) pour que l'absence s'installe sans à-coup.
 *
 * @param det détresse instantanée du nœud ∈ [0,1].
 * @returns facteur ∈ [0,1] (0 = pas de trou, 1 = trou plein).
 */
export function trouVide(det: number): number {
  const d = clamp01(det);
  return d * d; // ease-in : discret au début, franc quand l'oubli s'installe
}

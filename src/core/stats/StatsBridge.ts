// ════════════════════════════════════════════════════════════════════════
//  core/stats/StatsBridge.ts — LE PONT stats → monde.
//  Traduit les réactions des spectateurs en coups de pouce d'attention sur
//  la Région. SEUL module qui connaît À LA FOIS StatsSource ET Region.
//  Region, elle, ignore TOUT des stats (dépendance à sens unique :
//  StatsBridge → Region, JAMAIS Region → stats).
//
// ════════════════════════════════════════════════════════════════════════

import type { Region } from "../Region.js";
import type { StatsSource, StatEvent } from "./StatsSource.js";
import type { ReactionTwitch } from "./StatsSource.js";
import type { PiuwSystem, Rng } from "../piuws.js";
import type { ReactionsVisuelles } from "../reactions.js";
import type { AttentionNode, Vec2 } from "../types.js";
import { dist, clamp01 } from "../attention.js";

/**
 * Couleur (string hex) d'une réaction Twitch, pour la lueur visible qui descend.
 * ⚠️ ARCHITECTURE : ce mapping vit ICI (et pas dans render/palette.ts) parce que
 * le core NE DOIT JAMAIS importer render/. Le pont est le SEUL module core qui
 * connaît les réactions Twitch : c'est donc le bon endroit. Une string "#RRGGBB"
 * est une DONNÉE pure → le core reste pur. Mapping validé :
 *   points→cyan, follow→vert-vie, cheer→or, sub→blanc, raid→violet.
 */
export function couleurReaction(type: ReactionTwitch): string {
  switch (type) {
    case "points":
      return "#00FFFF"; // cyan — Channel Points, la masse douce
    case "follow":
      return "#80FF80"; // vert vie — un nouvel arrivant
    case "cheer":
      return "#FFD580"; // or — des bits, ça chauffe
    case "sub":
      return "#FFFFFF"; // blanc — un sub, fort et net
    case "raid":
      return "#7A5CFF"; // violet — un raid, une vague qui déferle
  }
}

/**
 * Réglages de conversion stat → attention.
 * ⚠️ ZONE systems-designer : valeurs PLACEHOLDER, à régler en playtest.
 * SEUL le `plafond` est canon (principe « pas d'éveil seul » : < seuil d'éveil 0.6).
 */
export interface BridgeReglages {
  /** Coup de pouce d'attention pour une réaction de force 1. */
  poussee: number; // PLACEHOLDER ex. 0.03
  /**
   * PLAFOND : les stats ne montent JAMAIS un nœud au-dessus de ça.
   * CANON : un soutien « venu d'ailleurs » ne peut pas
   * éveiller seul. Identique à PIUW_PLAFOND_SOIN (0.55, sous le seuil d'éveil 0.6).
   */
  plafond: number; // CANON 0.55
  /** Au-dessus de cette force, la réaction fait aussi NAÎTRE un Piuw (pic d'enthousiasme). */
  seuilPiuw: number; // PLACEHOLDER ex. 0.8
  /**
   * Probabilité de cibler un nœud AU HASARD plutôt que près du regard.
   * CHOIX DE DESIGN : la foule aide SURTOUT là où le joueur regarde, mais
   * parfois (minorité) ailleurs. 0 = toujours près du regard, 1 = toujours au hasard.
   */
  probaHasard: number; // PLACEHOLDER ex. 0.25
}

/** Réglages par défaut (PLACEHOLDER, sauf le plafond = canon) — pour le câblage simple. */
export const REGLAGES_BRIDGE_DEFAUT: BridgeReglages = {
  poussee: 0.03,
  plafond: 0.55, // CANON — ne pas monter au-dessus sans changer le canon
  seuilPiuw: 0.8,
  probaHasard: 0.25,
};

/**
 * Réglages « LIVE ANIMÉ » (PLACEHOLDER) — chaque réaction pousse plus fort, pour
 * VOIR la foule nourrir le monde. Le plafond reste CANON (0.55) : même très
 * active, la foule ne peut JAMAIS éveiller seule — le joueur reste le moteur.
 */
export const REGLAGES_BRIDGE_LIVE: BridgeReglages = {
  // CHOIX DE DESIGN « densité équilibrée » : on calme la poussée (0.25 → 0.12).
  // La foule aide visiblement, mais c'est le JOUEUR qui fait grimper l'attention :
  // les stats accompagnent, elles ne portent plus le monde toutes seules.
  poussee: 0.12, // un coup de pouce sensible, sans voler le rôle du joueur
  plafond: 0.55, // CANON — inchangé, intouchable
  seuilPiuw: 0.8,
  probaHasard: 0.25,
};

export class StatsBridge {
  constructor(
    private source: StatsSource,
    private reglages: BridgeReglages = REGLAGES_BRIDGE_DEFAUT,
    private rng: Rng = Math.random,
  ) {}

  /**
   * Appelé une fois par frame, APRÈS region.update().
   * @param dt secondes (passé à la source pour qu'elle génère).
   * @param region la région à nourrir.
   * @param regard où regarde le joueur (Vec2 monde), ou null. Sert à cibler
   *               les réactions PRÈS du regard (choix de design).
   * @param piuws le système de Piuws (pour les réactions fortes). Optionnel.
   * @param reactions le système de réactions VISIBLES (la lueur qui descend). Optionnel.
   */
  update(
    dt: number,
    region: Region,
    regard: Vec2 | null,
    piuws?: PiuwSystem,
    reactions?: ReactionsVisuelles,
  ): void {
    this.source.update(dt);
    for (const ev of this.source.drainEvents()) {
      this.appliquer(ev, region, regard, piuws, reactions);
    }
  }

  /** Traduit UNE réaction en effet sur le monde. */
  private appliquer(
    ev: StatEvent,
    region: Region,
    regard: Vec2 | null,
    piuws?: PiuwSystem,
    reactions?: ReactionsVisuelles,
  ): void {
    // 0) BLINDAGE (P2 qa) : une VRAIE source Twitch pourrait envoyer une force hors
    //    borne (bug d'API, valeur brute non normalisée...). On la clampe DÈS l'entrée
    //    du pont, AVANT toute utilisation (poussée, seuil Piuw, taille de la lueur).
    //    Ainsi tout le reste du code travaille sur une force garantie ∈ [0,1].
    const force = clamp01(ev.force);

    // 1) Choisir le nœud cible. On ne nourrit que des nœuds déjà un peu vivants
    //    (v > 0.05) : la foule entretient ce qui existe, elle ne crée pas du néant.
    const cibles = region.tousLesNoeuds().filter((n) => n.v > 0.05);
    if (cibles.length === 0) return; // rien à nourrir → on ignore cette réaction

    const cible = this.choisirCible(cibles, regard);

    // 1bis) RÉACTION VISIBLE (pivot Twitch) : une lueur DESCEND du Voile vers le
    //       nœud nourri, à la couleur de la réaction. Le spectateur VOIT son action.
    //       On transmet aussi le TYPE (string pure `ev.type`) comme STYLE : c'est le
    //       rendu qui en fera une forme différente. Le core reste pur.
    if (reactions) {
      // On transmet aussi `ev.groupe` (lien de rafale, raid) : le rendu reliera
      // visuellement les réactions d'un même groupe. Pour une réaction isolée de
      // fond, `ev.groupe` est undefined → spawn sans lien (rétro-compat).
      reactions.spawn(cible.pos, couleurReaction(ev.type), force, ev.type, undefined, ev.groupe);
    }

    // 2) PRINCIPE CANON : un coup de pouce « venu d'ailleurs » ne dépasse JAMAIS le
    //    plafond. On ne touche v que si on est SOUS le plafond → jamais d'éveil par
    //    les seules stats. Le joueur reste le moteur du premier éveil.
    if (cible.v < this.reglages.plafond) {
      const gain = force * this.reglages.poussee;
      cible.v = Math.min(this.reglages.plafond, cible.v + gain);
    }

    // 3) Réaction FORTE (un pic d'enthousiasme) → naissance d'un Piuw qui PORTE le
    //    rêve du nœud nourri (choix de design). Manifestation visible de la foule.
    if (piuws && force >= this.reglages.seuilPiuw) {
      piuws.naitre(cible.pos, 1, cible.reve);
    }
  }

  /**
   * Choisit le nœud à nourrir : SURTOUT le plus proche du regard, PARFOIS au hasard
   * (choix de design). Sans regard, ou si le tirage le décide, c'est au hasard.
   */
  private choisirCible(cibles: AttentionNode[], regard: Vec2 | null): AttentionNode {
    const auHasard = regard === null || this.rng() < this.reglages.probaHasard;
    if (auHasard) {
      return cibles[Math.floor(this.rng() * cibles.length)];
    }
    // Sinon : le nœud (vivant) le plus proche du regard du joueur.
    return this.plusProche(cibles, regard);
  }

  /** Le nœud le plus proche d'un point (parmi une liste non vide). */
  private plusProche(cibles: AttentionNode[], point: Vec2): AttentionNode {
    let best = cibles[0];
    let bestD = dist(best.pos, point);
    for (let i = 1; i < cibles.length; i++) {
      const d = dist(cibles[i].pos, point);
      if (d < bestD) {
        bestD = d;
        best = cibles[i];
      }
    }
    return best;
  }
}

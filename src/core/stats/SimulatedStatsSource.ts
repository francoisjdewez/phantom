// ════════════════════════════════════════════════════════════════════════
//  core/stats/SimulatedStatsSource.ts — fausses réactions Twitch, pour dev/test.
//  Imite un chat Twitch : un fond régulier de réactions tirées au sort PAR POIDS,
//  chaque type ayant SA PROPRE plage de force. Un `raid` déclenche une RAFALE.
//  RNG INJECTABLE (type Rng de piuws.ts) → tests 100% reproductibles. AUCUN réseau.
//
// ════════════════════════════════════════════════════════════════════════

import type { StatsSource, StatEvent, ReactionTwitch } from "./StatsSource.js";
import type { Rng } from "../piuws.js";

/**
 * PROFIL d'un type de réaction Twitch : sa plage de force et son poids de tirage.
 * - `force` = [min, max] : intensité possible de CE type (ex. un `sub` tape fort).
 * - `poids` = chance relative d'être tiré (les `points` sont fréquents, les `raid` rares).
 * Mapping validé par le systems-designer (pivot Twitch).
 */
interface ProfilReaction {
  force: [number, number];
  poids: number;
}

/**
 * Table des 5 réactions Twitch. C'est LA source de vérité du simulateur :
 * qui tape fort, qui est fréquent. À régler en playtest par le systems-designer.
 *
 *   type     force[min,max]   poids   (couleur côté StatsBridge.couleurReaction)
 *   points   0.15–0.45        50      cyan    — la masse, douce
 *   follow   0.30–0.55        22      vert    — un nouvel arrivant
 *   cheer    0.50–1.0         18      or      — des bits, ça chauffe
 *   sub      0.80–1.0          8      blanc   — un sub, fort
 *   raid     0.90–1.0          2      violet  — rare, déclenche une RAFALE
 */
const PROFILS: Record<ReactionTwitch, ProfilReaction> = {
  points: { force: [0.15, 0.45], poids: 50 },
  follow: { force: [0.3, 0.55], poids: 22 },
  cheer: { force: [0.5, 1.0], poids: 18 },
  sub: { force: [0.8, 1.0], poids: 8 },
  raid: { force: [0.9, 1.0], poids: 2 },
};

/** Les types dans l'ordre, pré-calculés une fois (pour le tirage pondéré). */
const TYPES = Object.keys(PROFILS) as ReactionTwitch[];
/** Somme des poids (pour ramener le tirage à [0, total[). */
const POIDS_TOTAL = TYPES.reduce((s, t) => s + PROFILS[t].poids, 0);

/**
 * Réglages de cadence du simulateur.
 * ⚠️ ZONE systems-designer : ces valeurs sont des PLACEHOLDER, à régler en playtest.
 * Les FORCES par type ne sont plus ici : elles vivent dans PROFILS (table interne).
 * Ne restent ici que la CADENCE globale et le réglage de la rafale `raid`.
 */
export interface SimReglages {
  /** Réactions "de fond" par seconde en moyenne (le ronron du chat). */
  cadenceMoyenne: number; // PLACEHOLDER ex. 0.5 → ~1 réaction toutes les 2 s
  /** Taille de la rafale déclenchée par un `raid` (combien de réactions d'un coup). */
  tailleRafale: number; // PLACEHOLDER ex. 6
  /**
   * (Optionnel) Probabilité par seconde d'un raid SPONTANÉ, EN PLUS du tirage de fond.
   * Laisser 0 en général : un `raid` peut déjà sortir naturellement du tirage pondéré
   * (poids 2) et déclencher sa rafale. Sert juste à forcer des raids en test/démo.
   */
  probaRafale?: number; // PLACEHOLDER ex. 0
}

/** Réglages par défaut (PLACEHOLDER) — public calme, pour le câblage simple. */
export const REGLAGES_SIM_DEFAUT: SimReglages = {
  cadenceMoyenne: 0.5,
  tailleRafale: 6,
  probaRafale: 0,
};

/**
 * Réglages « LIVE ANIMÉ » (PLACEHOLDER) — un chat bien présent, visible à l'écran :
 * ~3.5 réactions/s. Sert à SENTIR la foule en démo. À régler finement au playtest.
 */
export const REGLAGES_SIM_LIVE: SimReglages = {
  // Playtest 2026-06-18 : 3.5/s c'était TROP en continu (ça mitraillait).
  // On calme à ~1.3/s : le chat respire, chaque réaction se remarque, le JOUEUR
  // reste clairement le moteur.
  cadenceMoyenne: 1.3, // ~1 réaction toutes les ~0,8 s : présent mais posé
  tailleRafale: 6,
  probaRafale: 0, // les raids sortent déjà du tirage pondéré (poids 2), plus rares
};

/** Plafond anti-fuite mémoire de la file (copié sur Region.pousserEvenement). */
const FILE_MAX = 200;

export class SimulatedStatsSource implements StatsSource {
  private file: StatEvent[] = [];
  private horloge = 0; // secondes écoulées depuis le début (pour l'horodatage)
  /**
   * Compteur de RAFALES (LIEN DE GROUPE). Incrémenté à chaque nouvelle rafale de
   * raid : toutes les réactions d'une même rafale reçoivent ce numéro → le rendu
   * sait qu'elles forment UN groupe (les viewers qui débarquent ensemble).
   */
  private prochainGroupe = 0;

  /**
   * @param reglages les chiffres de cadence (fournis par le designer).
   * @param rng fonction aléatoire ∈ [0,1[. INJECTABLE → en test on passe un RNG
   *            déterministe (graine fixe) pour des résultats reproductibles.
   *            Convention identique à core/piuws.ts (type Rng).
   */
  constructor(
    private reglages: SimReglages = REGLAGES_SIM_DEFAUT,
    private rng: Rng = Math.random,
  ) {}

  update(dt: number): void {
    this.horloge += dt;

    // 1) FOND : à chaque frame, une petite chance d'émettre UNE réaction.
    //    Le type est tiré PAR POIDS, et sa force dépend de SON profil.
    //    Si le hasard tombe sur un `raid`, ça déclenche directement une rafale.
    if (this.rng() < this.reglages.cadenceMoyenne * dt) {
      this.emettreReaction(this.typePondere());
    }

    // 2) RAID SPONTANÉ (optionnel) : force une rafale même hors tirage de fond.
    //    Sert surtout aux tests/démos. En prod probaRafale=0 → jamais déclenché ici.
    const probaRafale = this.reglages.probaRafale ?? 0;
    if (probaRafale > 0 && this.rng() < probaRafale * dt) {
      this.rafaleRaid();
    }
  }

  drainEvents(): StatEvent[] {
    const out = this.file;
    this.file = [];
    return out;
  }

  // ── helpers privés (purs, testables) ────────────────────────────────────

  /**
   * Émet une réaction du type donné. Cas spécial `raid` : au lieu d'UNE réaction,
   * on crache une RAFALE (un paquet) — c'est l'arrivée d'une vague de viewers.
   */
  private emettreReaction(type: ReactionTwitch): void {
    if (type === "raid") {
      this.rafaleRaid();
      return;
    }
    this.emettre(type, this.forcePour(type));
  }

  /**
   * Une RAFALE de raid : un petit paquet de réactions `raid` d'un coup. LIEN DE
   * GROUPE : on tire UN numéro de groupe (le même pour TOUTE la rafale) et on le
   * pose sur chaque réaction → le rendu les reliera par de fins fils violets.
   */
  private rafaleRaid(): void {
    const groupe = this.prochainGroupe++; // un numéro UNIQUE pour cette rafale
    for (let i = 0; i < this.reglages.tailleRafale; i++) {
      this.emettre("raid", this.forcePour("raid"), groupe);
    }
  }

  /**
   * Ajoute une réaction à la file (avec plafond anti-fuite).
   * @param groupe (optionnel) numéro de rafale partagé — absent pour une réaction
   *               isolée de fond (pas de lien de groupe).
   */
  private emettre(type: ReactionTwitch, force: number, groupe?: number): void {
    if (this.file.length < FILE_MAX) {
      this.file.push({ type, force, t: this.horloge * 1000, groupe });
    }
  }

  /**
   * Tire un type AU POIDS (roue de la fortune) : on tire un nombre dans [0, total[
   * et on avance dans les types jusqu'à tomber dans la "tranche" de l'un d'eux.
   * Les `points` (poids 50) sortent souvent, les `raid` (poids 2) rarement.
   */
  private typePondere(): ReactionTwitch {
    let r = this.rng() * POIDS_TOTAL;
    for (const t of TYPES) {
      r -= PROFILS[t].poids;
      if (r < 0) return t;
    }
    // Filet de sécurité (arrondis flottants) : renvoie le dernier type.
    return TYPES[TYPES.length - 1];
  }

  /** Force d'une réaction tirée DANS la plage propre à son type (cf. PROFILS). */
  private forcePour(type: ReactionTwitch): number {
    const [min, max] = PROFILS[type].force;
    return min + this.rng() * (max - min);
  }
}

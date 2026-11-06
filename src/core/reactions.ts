// ════════════════════════════════════════════════════════════════════════
//  core/reactions.ts — LES RÉACTIONS VISIBLES du public, en logique pure.
//  Pivot Twitch : quand un spectateur réagit, une petite lueur DESCEND du haut
//  de l'écran (le Voile) vers le nœud nourri, puis "arrive" et meurt en
//  déclenchant un pulse. But : un spectateur VOIT et RESSENT son action.
//  Logique pure (100% testable). La COULEUR arrive toute prête (string),
//  fournie par le pont — ce module ne connaît AUCUN code couleur.
//  Le dessin est ailleurs (render3d/Renderer3D.ts).
// ════════════════════════════════════════════════════════════════════════

import type { Vec2 } from "./types.js";
import { clamp01 } from "./attention.js";

/** Plafond anti-fuite : on ne garde jamais plus de réactions vivantes que ça. */
export const REACTIONS_MAX = 24;

/**
 * STYLE VISUEL d'une réaction = juste une STRING (donnée 100% pure).
 * C'est exactement le genre de réaction Twitch (points/follow/cheer/sub/raid).
 * Le core ne fait que TRANSPORTER ce mot ; c'est le rendu (render/Effects.ts) qui
 * décide quelle FORME dessiner pour chaque style. Ainsi le core reste pur, mais
 * chaque type a sa signature visible à l'écran.
 * "neutre" = valeur de repli si on ne connaît pas le type (rendu = orbe générique).
 */
export type ReactionStyle =
  | "points"
  | "follow"
  | "cheer"
  | "sub"
  | "raid"
  | "neutre";

/** Y de naissance en monde (au-dessus du cadre : le "Voile" d'où vient le public). */
const Y_NAISSANCE = -8;
/** Étalement horizontal aléatoire au départ (±, en unités monde). */
const ETALEMENT_X = 28;
/** Durée de chute mini/maxi (s) — chute douce, lisible. */
const CHUTE_MIN = 1.2;
const CHUTE_MAX = 1.8;
/** Amplitude de l'ondulation latérale pendant la chute (unités monde). */
const ONDULATION = 5;
/** Force à partir de laquelle la réaction est un PIC (plus gros, étincelle). */
const SEUIL_PIC = 0.8;
/** Durée du fondu d'apparition (s). */
const FONDU_IN = 0.3;
/** Opacité de croisière (avant le fondu de sortie). */
const OPACITE_MAX = 0.55;

/**
 * Une réaction visible : naît en haut, descend vers une cible, "arrive", meurt.
 * Tous les champs sont en logique pure (le rendu ne fait que LIRE).
 */
export interface Reaction {
  /** Position courante (coordonnées monde). */
  pos: Vec2;
  /** Cible (centre du nœud nourri, monde) vers laquelle on descend. */
  cible: Vec2;
  /** X de départ (sert à interpoler la descente). */
  departX: number;
  /** Couleur déjà prête (ex. "#00FFFF"), fournie par le pont. Pur transport. */
  couleur: string;
  /**
   * STYLE visuel (string pure) = le genre de réaction Twitch. Le rendu s'en sert
   * pour dessiner une FORME différente par type. Pur transport.
   */
  style: ReactionStyle;
  /** Force de la réaction ∈ [0,1] (taille/intensité du rendu). */
  force: number;
  /** Pic d'enthousiasme (force ≥ 0.8) → rendu plus spectaculaire. */
  pic: boolean;
  /** Âge en secondes. */
  age: number;
  /** Durée de la chute (s) — calculée à la naissance. */
  duree: number;
  /** Opacité courante ∈ [0,1] (fondu in → croisière → out vers l'arrivée). */
  opacite: number;
  /** A touché la cible (déclenche le pulse côté rendu, puis la réaction meurt). */
  arrive: boolean;
  /** Phase de l'ondulation latérale (rad), désynchronisée à la naissance. */
  phase: number;
  /**
   * LIEN DE GROUPE (optionnel) — numéro de rafale partagé par toutes les réactions
   * d'un même raid. Le rendu relie par de fins fils violets les réactions vivantes
   * qui partagent ce numéro (« elles arrivent ensemble »). Absent = réaction isolée.
   * Donnée pure (un nombre).
   */
  groupe?: number;
}

/**
 * Le système des réactions visibles : une liste plafonnée, qu'on fait naître
 * (spawn) et avancer (update). Pur et testable.
 */
export class ReactionsVisuelles {
  /** Les réactions vivantes (lecture seule pour le rendu). */
  readonly liste: Reaction[] = [];

  /**
   * @param rng aléatoire ∈ [0,1[ — INJECTABLE pour des tests reproductibles
   *            (même convention que core/piuws.ts, type Rng).
   */
  constructor(private rng: () => number = Math.random) {}

  /**
   * Fait naître une réaction qui DESCEND vers `targetPos`.
   * @param targetPos centre du nœud nourri (monde).
   * @param couleur   string déjà prête (ex. "#FF0050"), fournie par le pont.
   * @param force     intensité ∈ [0,1] (≥0.8 → pic).
   * @param style     genre de réaction (string pure) → forme au rendu. Défaut "neutre".
   * @param fromX     X de départ imposé (option) ; sinon autour de targetPos.x.
   * @param groupe    (optionnel) numéro de rafale (raid) — les réactions d'un même
   *                  groupe seront reliées visuellement. Absent = réaction isolée.
   */
  spawn(
    targetPos: Vec2,
    couleur: string,
    force: number,
    style: ReactionStyle = "neutre",
    fromX?: number,
    groupe?: number,
  ): void {
    // Anti-fuite : si la liste est pleine, on remplace la PLUS VIEILLE (FIFO doux)
    // plutôt que d'ignorer — la réaction la plus récente compte le plus pour le joueur.
    if (this.liste.length >= REACTIONS_MAX) {
      this.liste.shift();
    }

    const f = clamp01(force);
    // X de départ : soit imposé, soit autour de la cible avec un petit étalement.
    const departX =
      fromX ?? targetPos.x + (this.rng() - 0.5) * 2 * ETALEMENT_X;

    this.liste.push({
      pos: { x: departX, y: Y_NAISSANCE },
      cible: { x: targetPos.x, y: targetPos.y },
      departX,
      couleur,
      style,
      force: f,
      pic: f >= SEUIL_PIC,
      age: 0,
      duree: CHUTE_MIN + this.rng() * (CHUTE_MAX - CHUTE_MIN),
      opacite: 0,
      arrive: false,
      // ondulation désynchronisée + un peu plus rapide pour les pics (vibrants).
      phase: this.rng() * Math.PI * 2,
      groupe, // lien de groupe (raid) — undefined pour une réaction isolée
    });
  }

  /**
   * Avance toutes les réactions d'un pas de temps.
   * - Chute douce (easeIn) de Y_NAISSANCE vers cible.y.
   * - Ondulation latérale sinusoïdale (~5px) autour de la ligne de descente.
   * - Fondu in (0.3s → 0.55) puis fondu out à l'approche.
   * - À l'arrivée : `arrive = true` UNE frame (le rendu déclenche le pulse), puis mort.
   */
  update(dt: number): void {
    for (let i = this.liste.length - 1; i >= 0; i--) {
      const r = this.liste[i];

      // Une réaction marquée "arrive" la frame précédente a fait son pulse → elle meurt.
      if (r.arrive) {
        this.liste.splice(i, 1);
        continue;
      }

      r.age += dt;
      const t = clamp01(r.age / r.duree);

      // Chute douce : easeIn (accélère vers le bas, comme une goutte qui tombe).
      const tomb = t * t;
      const baseX = r.departX + (r.cible.x - r.departX) * t;
      const y = Y_NAISSANCE + (r.cible.y - Y_NAISSANCE) * tomb;

      // Ondulation latérale qui s'atténue à l'approche (pour viser juste la cible).
      r.phase += dt * 6;
      const onde = Math.sin(r.phase) * ONDULATION * (1 - t);
      r.pos.x = baseX + onde;
      r.pos.y = y;

      // Opacité : fondu in vers OPACITE_MAX, puis fondu out sur la fin de chute.
      const fin = clamp01((t - 0.75) / 0.25); // 0 jusqu'à 75% puis monte à 1
      const apparition = clamp01(r.age / FONDU_IN);
      r.opacite = OPACITE_MAX * apparition * (1 - fin);

      // Arrivée : on a atteint la fin de la chute → on marque `arrive` (le rendu
      // dessine le pulse cette frame), et la réaction sera retirée la frame suivante.
      if (t >= 1) {
        r.pos.x = r.cible.x;
        r.pos.y = r.cible.y;
        r.arrive = true;
      }
    }
  }
}

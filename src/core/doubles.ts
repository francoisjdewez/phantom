// ════════════════════════════════════════════════════════════════════════
//  core/doubles.ts — LES DOUBLES D'ATTENTION (comportement vivant, 2026-06-18).
//  Des échos contemplatifs : quand un nœud est BIEN éveillé, son attention
//  « déborde » en doubles fantomatiques qui ORBITENT doucement autour de lui,
//  puis s'estompent si le nœud faiblit. Contrairement aux Piuws, ils ne PARLENT
//  pas et ne SOIGNENT pas : ils ne touchent jamais la vie des nœuds (zéro effet
//  sur l'équilibrage). Purement atmosphériques — le rendu les lit (modèle « pull »).
//  Logique PURE (100% testable).
//
//  Constantes : INTENTION = systems-designer ; VALEUR exacte ici (technical-designer),
//  ajustable au playtest. Plafond global = anti-fuite mémoire (cf. piuws.ts).
// ════════════════════════════════════════════════════════════════════════

import type { AttentionNode, Vec2 } from "./types.js";
import { clamp01, dist } from "./attention.js";
import type { Rng } from "./piuws.js";

/** Un nœud doit être au moins aussi vivant pour ENFANTER des doubles. */
export const DOUBLE_SEUIL_NAISSANCE = 0.75;
/** En dessous de ce seuil, la source ne nourrit plus ses doubles : ils s'estompent. */
export const DOUBLE_SEUIL_MORT = 0.5;
/** Nombre de doubles visés autour d'UN nœud qualifié. */
export const DOUBLE_PAR_NOEUD = 2;
/** Cadence de naissance : on tente d'enfanter toutes les N secondes. */
export const DOUBLE_PROD_INTERVAL = 3;
/** Plafond global de doubles (perf + lisibilité + anti-fuite). */
export const DOUBLE_MAX = 24;
/** Vitesse d'apparition/disparition de l'intensité (par seconde). */
const DOUBLE_VITESSE_INTENSITE = 1.5;

/** Un Double d'Attention : un écho qui orbite autour de son nœud source. */
export interface DoubleAttention {
  /** L'id du nœud dont il est l'écho. */
  sourceId: string;
  /** Position courante (coordonnées monde), calculée depuis l'orbite. */
  pos: Vec2;
  /** Angle orbital courant (rad). */
  angle: number;
  /** Vitesse angulaire (rad/s), lente, signe = sens de rotation. */
  vitesseAngulaire: number;
  /** Rayon d'orbite de base (unités monde). */
  rayon: number;
  /** Phase d'ondulation du rayon (respiration de l'orbite). */
  phase: number;
  /** Présence/opacité ∈ [0,1] : monte tant que la source est forte, retombe sinon. */
  intensite: number;
  /** Âge en secondes depuis la naissance. */
  age: number;
}

/**
 * Gère TOUS les Doubles d'une région : naissance autour des nœuds bien éveillés,
 * orbite douce, estompement quand la source faiblit, mort (anti-fuite). Pur.
 */
export class DoublesSystem {
  /** Tous les doubles vivants (lecture seule depuis l'extérieur, ex. le rendu). */
  readonly liste: DoubleAttention[] = [];

  private readonly max: number;
  private prodAcc = 0;

  constructor(
    private readonly rng: Rng = Math.random,
    max = DOUBLE_MAX,
  ) {
    this.max = max;
  }

  /** Combien de doubles sont actuellement rattachés à ce nœud. */
  private compterPourNoeud(id: string): number {
    let n = 0;
    for (const d of this.liste) if (d.sourceId === id) n++;
    return n;
  }

  /** Fait naître un double autour d'un nœud (orbite aléatoire douce). */
  naitre(node: AttentionNode): void {
    if (this.liste.length >= this.max) return;
    this.liste.push({
      sourceId: node.id,
      pos: { ...node.pos },
      angle: this.rng() * Math.PI * 2,
      vitesseAngulaire: (0.3 + this.rng() * 0.4) * (this.rng() < 0.5 ? -1 : 1),
      rayon: 14 + this.rng() * 10,
      phase: this.rng() * Math.PI * 2,
      intensite: 0,
      age: 0,
    });
  }

  /**
   * Avance tous les doubles d'un pas de temps `dt` selon l'état des nœuds :
   *  - NAISSANCE : un nœud éveillé et haut (≥ SEUIL_NAISSANCE) enfante des doubles
   *    jusqu'à DOUBLE_PAR_NOEUD, toutes les ~DOUBLE_PROD_INTERVAL secondes.
   *  - ORBITE : chaque double tourne lentement autour de sa source, rayon qui respire.
   *  - ESTOMPEMENT/MORT : si la source tombe sous SEUIL_MORT (ou disparaît), son
   *    intensité retombe vers 0 ; à ~0, le double est retiré (anti-fuite mémoire).
   * @param noeuds tous les nœuds de la région (Cœur compris) — LUS seulement.
   */
  update(dt: number, noeuds: AttentionNode[] = []): void {
    const parId = new Map<string, AttentionNode>();
    for (const n of noeuds) parId.set(n.id, n);

    // 1) Naissance cadencée autour des nœuds bien éveillés.
    this.prodAcc += dt;
    if (this.prodAcc >= DOUBLE_PROD_INTERVAL) {
      this.prodAcc -= DOUBLE_PROD_INTERVAL;
      for (const n of noeuds) {
        if (
          n.eveille &&
          n.v >= DOUBLE_SEUIL_NAISSANCE &&
          this.compterPourNoeud(n.id) < DOUBLE_PAR_NOEUD
        ) {
          this.naitre(n);
        }
      }
    }

    // 2) Orbite + intensité + mort (itération à l'envers pour pouvoir retirer).
    const k = 1 - Math.exp(-DOUBLE_VITESSE_INTENSITE * dt); // lissage stable
    for (let i = this.liste.length - 1; i >= 0; i--) {
      const d = this.liste[i];
      d.age += dt;
      d.phase += dt * 1.5;
      d.angle += d.vitesseAngulaire * dt;

      const src = parId.get(d.sourceId);
      const vivante = src !== undefined && src.v >= DOUBLE_SEUIL_MORT;
      const cibleIntensite = vivante ? 1 : 0;
      d.intensite = clamp01(d.intensite + (cibleIntensite - d.intensite) * k);

      // Mort : source faible/absente ET devenu quasi invisible.
      if (!vivante && d.intensite < 0.02) {
        this.liste.splice(i, 1);
        continue;
      }

      // Position : orbite douce autour de la source (un peu au-dessus, aplatie).
      if (src) {
        const rayon = d.rayon * (1 + 0.15 * Math.sin(d.phase));
        d.pos.x = src.pos.x + Math.cos(d.angle) * rayon;
        d.pos.y = src.pos.y + Math.sin(d.angle) * rayon * 0.6 - 6;
      }
    }
  }

  /** Opacité d'un double pour le rendu = son intensité courante. */
  static opacite(d: DoubleAttention): number {
    return d.intensite;
  }

  /** Distance d'un double à un point (utilitaire de test/rendu). */
  static distanceA(d: DoubleAttention, p: Vec2): number {
    return dist(d.pos, p);
  }
}

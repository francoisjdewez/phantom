// ════════════════════════════════════════════════════════════════════════
//  core/cendres.ts — LES CENDRES DU VIDE (comportement vivant, logique pure).
//  Le Néant n'est pas un monstre : c'est une ABSENCE triste. Pour le rendre
//  « vivant » sans le rendre agressif, de fines cendres sombres montent en
//  dérivant depuis la marée du vide, comme des braises éteintes qui s'envolent.
//  Elles ne NAISSENT que quand le vide domine vraiment (n > SEUIL_NAISSANCE),
//  sont strictement PLAFONNÉES (anti-fuite mémoire), et meurent en quittant la
//  marée ou en vieillissant. Coordonnées MONDE (indépendant de l'échelle écran).
//  Logique pure (100% testable).
// ════════════════════════════════════════════════════════════════════════

import type { Rng } from "./piuws.js";
import type { Vec2 } from "./types.js";

/** Au-delà de cette intensité de Néant seulement, les cendres apparaissent. */
export const CENDRE_SEUIL_NAISSANCE = 0.5;
/** Plafond STRICT du nombre de cendres vivantes (anti-fuite mémoire). */
export const CENDRE_MAX = 12;
/** Cadence de naissance (cendres/seconde) à plein Néant. */
const CENDRE_DEBIT = 3;
/** Vitesse de montée (px monde/seconde) — lente, comme une braise qui flotte. */
const CENDRE_VY_MIN = 6;
const CENDRE_VY_MAX = 14;
/** Durée de vie (secondes). */
const CENDRE_VIE_MIN = 3;
const CENDRE_VIE_MAX = 6;
/**
 * Probabilité qu'une cendre naisse AUTOUR d'un foyer de détresse (sinon répartie
 * dans la marée comme avant). 0.7 = la majorité « part en poussière » près des
 * nœuds en détresse, tout en gardant un fond de cendres réparti. VISUEL seulement.
 */
const CENDRE_PART_FOYER = 0.7;
/** Rayon (px monde) du nuage de cendres autour d'un foyer en détresse. */
const CENDRE_RAYON_FOYER = 12;

/**
 * Un FOYER de détresse : un point du monde (un nœud presque éteint) autour
 * duquel les cendres se densifient. `det` ∈ [0,1] pondère le tirage (un nœud
 * plus en détresse attire davantage de cendres). Donnée fournie par le rendu.
 */
export interface FoyerCendre {
  pos: Vec2;
  det: number;
}

/** Une cendre : un grain sombre qui dérive vers le haut puis s'éteint. */
export interface Cendre {
  /** Position courante (coordonnées MONDE). */
  x: number;
  y: number;
  /** Vitesse verticale (px monde/s, toujours vers le haut → utilisée en y -= ). */
  vy: number;
  /** Léger ballottement horizontal (px monde/s). */
  vx: number;
  /** Âge depuis la naissance (s). */
  age: number;
  /** Durée de vie totale (s). */
  vie: number;
  /** Phase d'oscillation (pour un dérive horizontale douce). */
  phase: number;
}

/**
 * Système de cendres : un petit pool plafonné, piloté par l'intensité du Néant.
 * Logique pure ; le rendu (Effects) lit `liste` pour dessiner.
 */
export class CendreSystem {
  /** Les cendres vivantes (lecture seule côté rendu). */
  readonly liste: Cendre[] = [];
  /** Accumulateur de débit (pour cadencer la naissance indépendamment du dt). */
  private acc = 0;

  constructor(private readonly rng: Rng = Math.random) {}

  /**
   * Avance d'un pas de temps : fait naître, dériver et mourir les cendres.
   * @param dt           secondes écoulées.
   * @param neant        intensité du Néant ∈ [0,1].
   * @param solY         ordonnée MONDE du sol (bas de la marée, ex. ~180).
   * @param hMareeMonde  hauteur MONDE de la marée du vide (depuis le sol vers le haut).
   * @param largeurMonde largeur MONDE (ex. ~320) pour répartir les cendres en x.
   * @param foyers       OPTIONNEL — nœuds en détresse autour desquels DENSIFIER les
   *                     cendres (« ça part en poussière ici »). N'augmente PAS le débit
   *                     ni le plafond : déplace seulement le LIEU de naissance. VISUEL.
   */
  tick(
    dt: number,
    neant: number,
    solY: number,
    hMareeMonde: number,
    largeurMonde: number,
    foyers?: readonly FoyerCendre[],
  ): void {
    // 1) Naissance — uniquement si le vide domine et la marée a une épaisseur.
    if (neant > CENDRE_SEUIL_NAISSANCE && hMareeMonde > 1) {
      this.acc += CENDRE_DEBIT * neant * dt;
      while (this.acc >= 1 && this.liste.length < CENDRE_MAX) {
        this.acc -= 1;
        this.liste.push(this.naitre(solY, hMareeMonde, largeurMonde, foyers));
      }
      // Si on est au plafond, on ne laisse pas l'accumulateur exploser.
      if (this.liste.length >= CENDRE_MAX) this.acc = Math.min(this.acc, 1);
    } else {
      this.acc = 0; // pas de naissance → on n'accumule pas de « dette ».
    }

    // 2) Dérive + mort (parcours arrière pour pouvoir retirer en place).
    for (let i = this.liste.length - 1; i >= 0; i--) {
      const c = this.liste[i];
      c.age += dt;
      c.phase += dt * 1.5;
      c.y -= c.vy * dt; // monte
      c.x += Math.sin(c.phase) * c.vx * dt; // ballottement doux
      // Meurt si trop vieille, ou si elle s'est élevée bien au-dessus de la marée.
      const horsMaree = c.y < solY - hMareeMonde - 4;
      if (c.age >= c.vie || horsMaree) {
        this.liste.splice(i, 1);
      }
    }
  }

  /** Vide complètement le pool (ex. changement de région). */
  clear(): void {
    this.liste.length = 0;
    this.acc = 0;
  }

  /**
   * Fondu d'une cendre sur sa vie ∈ [0,1] : apparaît, tient, puis s'efface.
   * Utilisé par le rendu pour l'alpha (logique gardée ici, testable).
   */
  static fade(c: Cendre): number {
    const t = c.vie > 0 ? c.age / c.vie : 1;
    if (t < 0.2) return t / 0.2; // apparition douce
    if (t > 0.7) return (1 - t) / 0.3; // disparition douce
    return 1;
  }

  /**
   * Crée une cendre. Sans foyer (ou tirage défavorable) : dans la marée, répartie
   * sur la largeur (comportement historique). Avec foyer choisi : AUTOUR du nœud
   * en détresse (petit nuage), pour que l'œil sente que « ça part en poussière ici ».
   */
  private naitre(
    solY: number,
    hMareeMonde: number,
    largeurMonde: number,
    foyers?: readonly FoyerCendre[],
  ): Cendre {
    const foyer =
      foyers && foyers.length > 0 && this.rng() < CENDRE_PART_FOYER
        ? CendreSystem.choisirFoyer(foyers, this.rng())
        : null;

    let x: number;
    let y: number;
    if (foyer) {
      // Petit nuage centré sur le nœud (tirage radial doux), borné à la largeur.
      const ang = this.rng() * Math.PI * 2;
      const ray = this.rng() * CENDRE_RAYON_FOYER;
      x = Math.max(0, Math.min(largeurMonde, foyer.pos.x + Math.cos(ang) * ray));
      y = foyer.pos.y + Math.sin(ang) * ray;
    } else {
      x = this.rng() * largeurMonde; // répartie sur toute la largeur
      y = solY - this.rng() * hMareeMonde; // quelque part dans la marée
    }

    return {
      x,
      y,
      vy: CENDRE_VY_MIN + this.rng() * (CENDRE_VY_MAX - CENDRE_VY_MIN),
      vx: 2 + this.rng() * 3,
      age: 0,
      vie: CENDRE_VIE_MIN + this.rng() * (CENDRE_VIE_MAX - CENDRE_VIE_MIN),
      phase: this.rng() * Math.PI * 2,
    };
  }

  /**
   * Choisit un foyer pondéré par sa détresse (`det`) à partir d'un tirage `r` ∈ [0,1[.
   * Pur et déterministe (testable) : un nœud plus en détresse capte davantage de
   * cendres. Si toutes les détresses sont nulles, retourne le premier foyer.
   */
  static choisirFoyer(foyers: readonly FoyerCendre[], r: number): FoyerCendre {
    let total = 0;
    for (const f of foyers) total += Math.max(0, f.det);
    if (total <= 0) return foyers[0];
    let seuil = r * total;
    for (const f of foyers) {
      seuil -= Math.max(0, f.det);
      if (seuil < 0) return f;
    }
    return foyers[foyers.length - 1]; // garde-fou (arrondis flottants)
  }
}

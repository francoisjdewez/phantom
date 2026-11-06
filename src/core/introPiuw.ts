// ════════════════════════════════════════════════════════════════════════
//  core/introPiuw.ts — LE PIUW PERDU (première scène de R1), logique pure.
//  Adaptation wordless de la 1re scène du PDF : un petit Piuw perdu dans le
//  Néant, que le joueur "ressuscite" par son regard, et qui le guide ensuite
//  vers la fleur. Il devient le symbole récurrent du jeu. Onomatopées only.
//  Logique pure — le dessin est dans render3d/Renderer3D.ts.
// ════════════════════════════════════════════════════════════════════════

import type { Vec2 } from "./types.js";
import { clamp01, dist } from "./attention.js";
import type { Rng } from "./piuws.js";

/** Les beats de l'ouverture, dans l'ordre. */
export type EtatIntro = "perdu" | "sauve" | "guide" | "fini";

/** Onomatopées PLAINTIVES (perdu) vs JOYEUSES (sauvé) — jamais de vrais mots. */
export const PLAINTES = ["Piu…?", "…pwi ?", "Tii…", "…piu"] as const;
export const JOIES = ["Piuw !", "Wii !", "Tchip !", "Piuuu !"] as const;

/** Rayon sous lequel le regard "sauve" le Piuw perdu (unités monde). */
const RAYON_REGARD = 22;
/** Temps de regard nécessaire pour le sauver (s). */
const TEMPS_SAUVETAGE = 2.2;
/** COMPAGNON (chantier UX 4) : vitesse de vol du Piuw une fois sauvé (unités monde/s). */
const GUIDE_VITESSE = 45;
/** COMPAGNON : distance d'orbite autour de Phantom quand il le suit (unités monde). */
const COMPAGNON_ORBITE = 16;
/** COMPAGNON : de combien le Piuw dérive DEVANT Phantom vers la prochaine cible (max). */
const GUIDE_AVANCE = 60;

export class PiuwPerdu {
  pos: Vec2;
  etat: EtatIntro = "perdu";
  /** Avancement du sauvetage ∈ [0,1] (rempli par le regard proche). */
  sauveProgress = 0;
  /** Phase d'ondulation (flottaison, respiration). */
  phase: number;
  /** Onomatopée affichée, ou null. */
  mot: string | null = null;
  motTimer = 0;
  prochainMot: number;
  /** Énergie de bond (sursaut quand il parle / au sauvetage). */
  bond = 0;

  /** Petit minuteur interne (utilisé par l'état "sauve" avant de guider). */
  private t = 0;
  private readonly base: Vec2; // position d'origine (pour la dérive)

  constructor(
    pos: Vec2,
    private readonly rng: Rng = Math.random,
  ) {
    this.pos = { ...pos };
    this.base = { ...pos };
    this.phase = this.rng() * Math.PI * 2;
    this.prochainMot = 0.6 + this.rng() * 1.2;
  }

  /**
   * Avance la scène d'un pas de temps.
   * @param regard   position du regard (= position de Phantom) ou null.
   * @param cible    COMPAGNON (chantier UX 4) : la PROCHAINE chose à raviver (vers où
   *                 dériver quand le joueur hésite), ou null s'il n'y a plus rien.
   * @param illumine Phantom illumine-t-il ? Le Piuw ne se réveille QUE si on
   *                 l'ILLUMINE (geste actif) — la simple présence ne suffit pas
   *. Défaut `true` = historique.
   * @param joueurHesite le joueur est-il immobile/hésitant ? Si oui, le compagnon
   *                 dérive vers `cible` pour MONTRER la direction (guide non intrusif).
   */
  update(dt: number, regard: Vec2 | null, cible: Vec2 | null,
         illumine: boolean = true, joueurHesite: boolean = false): void {
    this.phase += dt * 2;
    if (this.bond > 0) this.bond = Math.max(0, this.bond - dt * 3.3);

    switch (this.etat) {
      case "perdu":
        this.majPerdu(dt, regard, illumine);
        break;
      case "sauve":
        this.majSauve(dt);
        break;
      case "guide":
      case "fini":
        // COMPAGNON : une fois sauvé, il suit Phantom et le guide (états fusionnés).
        this.majCompagnon(dt, regard, cible, joueurHesite);
        break;
    }

    this.majParole(dt);
  }

  private majPerdu(dt: number, regard: Vec2 | null, illumine: boolean): void {
    // Dérive lente autour de sa position d'origine (il est faible, perdu).
    this.pos.x = this.base.x + Math.sin(this.phase * 0.6) * 4;
    this.pos.y = this.base.y + Math.cos(this.phase * 0.4) * 3;

    // On ne le "sauve" que si on est proche ET qu'on ILLUMINE (présence seule
    // = il frémit mais ne revit pas → enseigne le geste, cf. §10 beats 2-3).
    if (regard && illumine && dist(regard, this.pos) < RAYON_REGARD) {
      this.sauveProgress = clamp01(this.sauveProgress + dt / TEMPS_SAUVETAGE);
      if (this.sauveProgress >= 1) {
        this.etat = "sauve";
        this.t = 0;
        this.bond = 1; // il sursaute de joie
      }
    } else {
      // S'il est délaissé, le sauvetage retombe lentement (il "re-meurt" un peu).
      this.sauveProgress = clamp01(this.sauveProgress - dt * 0.2);
    }
  }

  private majSauve(dt: number): void {
    // Petit instant de joie sur place avant de guider.
    this.t += dt;
    this.pos.y = this.base.y + Math.sin(this.phase * 2) * 3; // sautille
    if (this.t >= 1.0) {
      this.etat = "guide";
    }
  }

  /**
   * COMPAGNON (chantier UX 4) : une fois sauvé, le Piuw devient un guide VIVANT et non
   * intrusif (façon foulard de Journey). Il se tient près de Phantom ; quand le joueur
   * HÉSITE (immobile), il dérive doucement DEVANT lui, vers la prochaine chose à raviver
   * → il « montre le chemin » sans flèche ni texte. S'il n'y a plus rien (cible null) ou
   * que le joueur bouge, il revient simplement orbiter autour de Phantom.
   */
  private majCompagnon(dt: number, phantomPos: Vec2 | null,
                       cible: Vec2 | null, joueurHesite: boolean): void {
    if (!phantomPos) { this.pos.y += Math.sin(this.phase) * 2 * dt; return; }
    let tx: number, ty: number;
    if (joueurHesite && cible) {
      // Dérive DEVANT Phantom, dans la direction de la prochaine cible (montre où aller).
      const dx = cible.x - phantomPos.x, dy = cible.y - phantomPos.y;
      const d = Math.hypot(dx, dy) || 1;
      const avance = Math.min(d, GUIDE_AVANCE);
      tx = phantomPos.x + (dx / d) * avance;
      ty = phantomPos.y + (dy / d) * avance;
    } else {
      // SUIT Phantom : petite orbite douce (compagnon présent, jamais collé).
      tx = phantomPos.x + Math.cos(this.phase * 0.5) * COMPAGNON_ORBITE;
      ty = phantomPos.y + Math.sin(this.phase * 0.5) * (COMPAGNON_ORBITE * 0.75);
    }
    // Approche douce, vitesse plafonnée → mouvement vivant, jamais sec.
    const dx = tx - this.pos.x, dy = ty - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.3) {
      const step = Math.min(d, GUIDE_VITESSE * dt);
      this.pos.x += (dx / d) * step;
      this.pos.y += (dy / d) * step;
    }
  }

  private majParole(dt: number): void {
    if (this.motTimer > 0) {
      this.motTimer -= dt;
      if (this.motTimer <= 0) this.mot = null;
      return;
    }
    this.prochainMot -= dt;
    if (this.prochainMot > 0) return;
    // Plaintif tant qu'il n'est pas (presque) sauvé ; joyeux ensuite.
    const joyeux = this.etat !== "perdu" || this.sauveProgress > 0.6;
    const liste = joyeux ? JOIES : PLAINTES;
    this.mot = liste[Math.floor(this.rng() * liste.length)];
    this.motTimer = joyeux ? 1.0 : 1.4;
    this.prochainMot = joyeux ? 1.6 + this.rng() * 2 : 2.4 + this.rng() * 3;
    this.bond = Math.max(this.bond, joyeux ? 0.8 : 0.3);
  }
}

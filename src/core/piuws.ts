// ════════════════════════════════════════════════════════════════════════
//  core/piuws.ts — LES PIUWS en logique pure (100% testable).
//  Petites étoiles vivantes qui NAISSENT aux seuils d'éveil, PORTENT un Rêve
//, se rassemblent autour des nœuds vivants, et
//  SOUTIENNENT doucement la région (émergence/autonomie) — SANS jamais pouvoir
//  l'éveiller seuls (le joueur reste le moteur). Onomatopées uniquement.
//  Le dessin est ailleurs (render3d/Renderer3D.ts).
// ════════════════════════════════════════════════════════════════════════

import type { AttentionNode, Reve, Vec2 } from "./types.js";
import { clamp01, dist } from "./attention.js";

/** Le vocabulaire COMMUN des Piuws : QUE des onomatopées (jamais de vrais mots).
 *  Chaque rêve a EN PLUS son petit accent (cf. CARACTERE_REVE.onomatopees). */
export const ONOMATOPEES = [
  "Piuw !",
  "Tchip !",
  "Pwi…",
  "Tii !",
  "Piuuu",
  "Wii !",
] as const;

/**
 * LE CARACTÈRE DE CHAQUE RÊVE (les 8 « amis-rêves »).
 * Un Piuw PORTE un rêve : ce rêve lui donne un petit tempérament VISIBLE sans
 * texte — façon de dériver, façon de tournoyer, et son propre accent d'onomatopées.
 * Tout reste PUR et O(1) (simple lecture de table) → aucun coût perf.
 *
 *   - wanderMul : multiplie la fréquence d'errance (≈ nervosité du vol).
 *                 Explorateur frétille (1.5), Mémoire flâne (0.6).
 *   - orbiteMul : multiplie la vitesse d'orbite autour d'un nœud (≈ tempérament).
 *   - onomatopees : son vocabulaire propre (le rendu pourra aussi colorer par rêve).
 *
 * Réglages technical-designer, ajustables au playtest. L'INTENTION (qui est vif /
 * qui est calme) vient du game-design ; les VALEURS exactes sont posées ici.
 */
export interface CaractereReve {
  wanderMul: number;
  orbiteMul: number;
  onomatopees: readonly string[];
}

export const CARACTERE_REVE: Record<Reve, CaractereReve> = {
  // Répare/préserve : posé, rassurant, tournoie lentement.
  sauver: { wanderMul: 0.8, orbiteMul: 0.85, onomatopees: ["Piuw !", "Pwi…", "Pio…"] },
  // Art/beauté : joueur, virevolte avec entrain.
  creer: { wanderMul: 1.25, orbiteMul: 1.2, onomatopees: ["Tii !", "Wii !", "Tralii !"] },
  // Aventure/découverte : le plus frétillant, file dans tous les sens.
  explorer: { wanderMul: 1.5, orbiteMul: 1.3, onomatopees: ["Tchip !", "Tchii !", "Frtt !"] },
  // Renaissance/espoir : léger, montant, lumineux.
  esperer: { wanderMul: 1.1, orbiteMul: 1.0, onomatopees: ["Piuuu", "Wiii…", "Aïe-ouh !"] },
  // Stabilité/refuge : calme et régulier, orbite ample et lente.
  proteger: { wanderMul: 0.7, orbiteMul: 0.8, onomatopees: ["Boup", "Pomm", "Houp"] },
  // Connaissance/révélation : curieux, dérive en hésitant.
  comprendre: { wanderMul: 1.0, orbiteMul: 0.95, onomatopees: ["Tik ?", "Pwii ?", "Hmm…"] },
  // Traditions/partage : sociable, chante volontiers.
  transmettre: { wanderMul: 0.95, orbiteMul: 1.05, onomatopees: ["Lala !", "Diilo", "Toumti"] },
  // Souvenir/identité : le plus lent, flâne comme un écho ancien.
  "se-souvenir": { wanderMul: 0.6, orbiteMul: 0.75, onomatopees: ["Pwôô…", "Mémm…", "Ohh…"] },
};

// ── Réglages d'émergence (Systems Designer) ───────────────────────────────
/** Plafond de soutien : les Piuws maintiennent un nœud jusqu'ici, JAMAIS au-delà. */
export const PIUW_PLAFOND_SOIN = 0.55; // < seuil d'éveil (0.6) → ne gagne jamais seul
/** Soin apporté par UN Piuw proche, par seconde. */
const PIUW_SOIN = 0.006;
/** Distance sous laquelle un Piuw soutient un nœud (unités monde). */
const PIUW_RAYON_SOIN = 22;
/** Un nœud éveillé produit 1 Piuw toutes les N secondes (autonomie). */
const PIUW_PROD_INTERVAL = 6;
/** Un nœud est « vivant » (attire les Piuws) au-dessus de ce seuil. */
const SEUIL_VIVANT = 0.3;
/** Rayon « confortable » d'orbite autour d'un nœud : le Piuw tournoie ici au lieu de foncer dedans. */
const PIUW_RAYON_ORBITE = 16;
/** Force de l'errance (vagabondage) — petite dérive douce qui rend le vol non-robotique. */
const PIUW_FORCE_WANDER = 7;

// ── CORTÈGE : les Piuws attirés par la lumière de Phantom ──
/** En ILLUMINANT à moins de cette distance d'un Piuw, il s'ACCROCHE au cortège. */
const CORTEGE_RAYON_APPEL = 30;
/** Un Piuw accroché se DÉTACHE si Phantom s'éloigne au-delà de cette distance.
 *  (> APPEL : une fois accroché il suit même sans ré-illuminer, tant qu'on reste proche.) */
const CORTEGE_RAYON_LARGAGE = 60;

/** Un Piuw : une petite étoile vivante qui porte un rêve. */
export interface Piuw {
  /** Position courante (coordonnées monde). */
  pos: Vec2;
  /** Vitesse (unités monde / seconde). */
  vel: Vec2;
  /** Le Rêve porté (détermine sa couleur, côté rendu). */
  reve: Reve;
  /** Âge en secondes depuis la naissance. */
  age: number;
  /** Durée de vie totale (s) : au-delà, le Piuw disparaît (anti-fuite mémoire). */
  vie: number;
  /** Phase de l'ondulation (pour le balancement sinusoïdal du vol). */
  phase: number;
  /** Taille relative (∈ ~[0.7,1.3]) pour varier les silhouettes. */
  taille: number;
  /** Onomatopée affichée en ce moment, ou null s'il se tait. */
  mot: string | null;
  /** Temps restant d'affichage du mot courant (s). */
  motTimer: number;
  /** Temps avant la prochaine parole (s). */
  prochainMot: number;
  /** Temps avant le prochain clignement (s). */
  clignoteDans: number;
  /** Temps restant les yeux fermés (>0 = en train de cligner). */
  clignoteTimer: number;
  /** Énergie de "bond" ∈ [0,1] : monte à 1 quand il parle, retombe (petit sursaut). */
  bond: number;
  /** Phase de l'ERRANCE (vagabondage) — décorrélée de `phase` pour éviter un vol uniforme. */
  wanderPhase: number;
  /** Fréquence d'errance propre (rad/s) : donne à chaque Piuw un tempérament unique. */
  wanderFreq: number;
  /** Sens de tournoiement quand il orbite autour d'un nœud (+1 / -1). */
  sensOrbite: number;
  /** Multiplicateur de vitesse d'orbite, hérité du CARACTÈRE de son rêve. */
  orbiteMul: number;
  /** Accroché au CORTÈGE de Phantom ? (attiré par sa lumière, il le suit). */
  suit: boolean;
}

/** Une fonction qui renvoie un nombre ∈ [0,1[. Injectable pour des tests reproductibles. */
export type Rng = () => number;

/**
 * Gère TOUS les Piuws d'une région : naissance, rassemblement autour des nœuds,
 * parole, clignement, mort douce, ET la boucle d'autonomie (production + soutien).
 */
export class PiuwSystem {
  /** Tous les Piuws vivants (lecture seule depuis l'extérieur, ex. le rendu). */
  readonly liste: Piuw[] = [];

  /** Plafond de population (anti-surcharge : perf + lisibilité). */
  private readonly max: number;
  /** Accumulateur de production autonome (les nœuds éveillés enfantent des Piuws). */
  private prodAcc = 0;

  constructor(
    private readonly rng: Rng = Math.random,
    max = 40,
  ) {
    this.max = max;
  }

  /**
   * Fait naître `combien` Piuws portant `reve` autour d'un point (seuil d'éveil franchi).
   * Ils jaillissent vers le haut, en éventail, avec une petite variation.
   * @param vie durée de vie forcée (s) — optionnelle. Par défaut ~9–13 s (comportement
   *            historique testé). Le ZURG (village persistant) passe une vie plus longue.
   */
  naitre(centre: Vec2, combien: number, reve: Reve, vie?: number): void {
    const car = CARACTERE_REVE[reve];
    for (let i = 0; i < combien; i++) {
      if (this.liste.length >= this.max) break;
      const angle = -Math.PI / 2 + (this.rng() - 0.5) * 1.6; // surtout vers le haut
      const vitesse = 6 + this.rng() * 10;
      this.liste.push({
        pos: {
          x: centre.x + (this.rng() - 0.5) * 10,
          y: centre.y - this.rng() * 6,
        },
        vel: { x: Math.cos(angle) * vitesse, y: Math.sin(angle) * vitesse },
        reve,
        age: 0,
        vie: vie ?? 9 + this.rng() * 4, // défaut ~9–13 s (inchangé) ; forcé pour le village
        phase: this.rng() * Math.PI * 2,
        taille: 0.7 + this.rng() * 0.6,
        mot: null,
        motTimer: 0,
        prochainMot: 0.2 + this.rng() * 1.2,
        clignoteDans: 1 + this.rng() * 3,
        clignoteTimer: 0,
        bond: 0,
        wanderPhase: this.rng() * Math.PI * 2,
        // tempérament : base aléatoire (chaque Piuw est unique) × accent de son rêve.
        wanderFreq: (0.6 + this.rng() * 0.9) * car.wanderMul,
        sensOrbite: this.rng() < 0.5 ? -1 : 1,
        orbiteMul: car.orbiteMul,
        suit: false,
      });
    }
  }

  /**
   * Avance tous les Piuws d'un pas de temps `dt`, en tenant compte des nœuds :
   *  - AUTONOMIE : chaque nœud éveillé enfante un Piuw toutes les ~6 s.
   *  - RASSEMBLEMENT : chaque Piuw gravite vers le nœud vivant le plus proche.
   *  - SOUTIEN : un Piuw proche d'un nœud le maintient (jusqu'au PLAFOND, jamais au-delà).
   *  - vie : clignement, parole (+ bond), et mort (trop vieux / hors écran).
   * @param noeuds tous les nœuds de la région (Cœur compris) — lus ET soutenus.
   * @param village (optionnel) PERSISTANCE/VARIÉTÉ du ZURG : si fourni, la production
   *        autonome fait naître un MÉLANGE VARIÉ de rêves (`reves`), avec une `vie`
   *        allongée, et maintient une population-cible (`cible`). Sans cet objet, le
   *        comportement reste EXACTEMENT l'historique (1 Piuw du rêve du nœud, vie ~9-13 s).
   *        N'AFFECTE PAS l'équilibrage : le soutien reste plafonné à PIUW_PLAFOND_SOIN.
   */
  update(dt: number, noeuds: AttentionNode[] = [],
         village?: { reves: readonly Reve[]; vie: number; cible: number },
         phantom?: { pos: Vec2; illumine: boolean }): void {
    // 1) Autonomie : les nœuds éveillés produisent des Piuws (la région vit seule).
    this.prodAcc += dt;
    if (this.prodAcc >= PIUW_PROD_INTERVAL) {
      this.prodAcc -= PIUW_PROD_INTERVAL;
      const eveilles = noeuds.filter((n) => n.eveille);
      if (village && eveilles.length > 0) {
        // VILLAGE PERSISTANT (ZURG) : on naît en MÉLANGE VARIÉ de rêves, vie allongée,
        // jusqu'à approcher la population-cible. On peuple plus vite tant qu'on est sous
        // la cible (le village « se remplit » quand il revit), puis on régule.
        const manque = village.cible - this.liste.length;
        const lot = Math.max(1, Math.min(manque, 4));   // jusqu'à 4 par cycle quand ça manque
        for (let i = 0; i < lot && this.liste.length < this.max; i++) {
          // rêve VARIÉ + apparition près d'un nœud éveillé au hasard (répartition naturelle).
          const reve = village.reves[Math.floor(this.rng() * village.reves.length)];
          const place = eveilles[Math.floor(this.rng() * eveilles.length)].pos;
          this.naitre(place, 1, reve, village.vie);
        }
      } else {
        for (const n of eveilles) this.naitre(n.pos, 1, n.reve);
      }
    }

    // 2) Mouvement + soutien + vie (itération à l'envers pour pouvoir retirer).
    for (let i = this.liste.length - 1; i >= 0; i--) {
      const p = this.liste[i];
      p.age += dt;
      p.phase += dt * 3;
      p.wanderPhase += dt * p.wanderFreq;

      // Mort : trop vieux OU sorti par le haut du monde.
      if (p.age >= p.vie || p.pos.y < -12) {
        this.liste.splice(i, 1);
        continue;
      }

      // CORTÈGE : si Phantom illumine tout près, le Piuw s'ACCROCHE et le suit ;
      // il se détache s'il s'éloigne trop. Tant qu'accroché, il oublie les nœuds et
      // suit Phantom (sans le « soigner » — Phantom n'est pas un nœud à raviver).
      if (phantom) {
        const dP = dist(p.pos, phantom.pos);
        if (phantom.illumine && dP < CORTEGE_RAYON_APPEL) p.suit = true;
        else if (dP > CORTEGE_RAYON_LARGAGE) p.suit = false;
      } else {
        p.suit = false;
      }

      // Cible du Piuw : le CORTÈGE de Phantom (prioritaire) sinon le nœud vivant proche.
      const cibleNoeud = p.suit ? null : this.noeudVivantProche(p.pos, noeuds);
      const ciblePos: Vec2 | null =
        p.suit && phantom ? phantom.pos : (cibleNoeud ? cibleNoeud.pos : null);

      // Freinage doux de l'élan de naissance.
      p.vel.x *= 1 - Math.min(1, 1.5 * dt);
      p.vel.y *= 1 - Math.min(1, 1.5 * dt);

      // ERRANCE : une dérive douce et propre à chaque Piuw (deux sinus décalés sur
      // x et y) — c'est elle qui casse l'aspect « robotique » : même immobile, le
      // Piuw vagabonde un peu, comme une luciole qui hésite.
      const wanderX = Math.cos(p.wanderPhase) * PIUW_FORCE_WANDER;
      const wanderY = Math.sin(p.wanderPhase * 1.3 + 1.1) * PIUW_FORCE_WANDER * 0.6;

      if (ciblePos) {
        const d = dist(p.pos, ciblePos) || 1;
        // Vecteur unitaire Piuw → cible (un nœud OU Phantom s'il est dans le cortège).
        const ux = (ciblePos.x - p.pos.x) / d;
        const uy = (ciblePos.y - p.pos.y) / d;

        if (d > PIUW_RAYON_ORBITE) {
          // LOIN : on s'approche doucement (accélération radiale).
          p.vel.x += ux * 14 * dt;
          p.vel.y += uy * 14 * dt;
        } else {
          // PROCHE : au lieu de foncer dans la cible, on TOURNOIE autour d'elle.
          // Le vecteur tangent (perpendiculaire au radial) fait orbiter le Piuw ;
          // un léger ressort radial le ramène vers le rayon confortable s'il dérive.
          // La vitesse tangentielle dépend du CARACTÈRE du rêve (orbiteMul) :
          // un Explorateur tournoie plus vif qu'un Piuw de la Mémoire.
          const vitTangente = 16 * p.orbiteMul;
          const tx = -uy * p.sensOrbite;
          const ty = ux * p.sensOrbite;
          p.vel.x += tx * vitTangente * dt + ux * (d - PIUW_RAYON_ORBITE) * 1.5 * dt;
          p.vel.y += ty * vitTangente * dt + uy * (d - PIUW_RAYON_ORBITE) * 1.5 * dt;
        }

        p.pos.x += (p.vel.x + wanderX) * dt;
        p.pos.y += (p.vel.y + wanderY) * dt;

        // SOUTIEN plafonné : UNIQUEMENT pour un vrai nœud (on ne « soigne » jamais
        // Phantom — il n'est pas un élément à raviver, juste le centre du cortège).
        if (cibleNoeud && d < PIUW_RAYON_SOIN && cibleNoeud.v < PIUW_PLAFOND_SOIN) {
          cibleNoeud.v = Math.min(PIUW_PLAFOND_SOIN, cibleNoeud.v + PIUW_SOIN * dt);
        }
      } else {
        // Aucun nœud vivant : flottaison libre vers le haut, en vagabondant.
        p.pos.x += (p.vel.x + wanderX) * dt;
        p.pos.y += (p.vel.y + wanderY - 2) * dt;
      }

      this.majVie(p, dt);
    }
  }

  /** Le nœud « vivant » (v > seuil) le plus proche d'un point, ou null. */
  private noeudVivantProche(pos: Vec2, noeuds: AttentionNode[]): AttentionNode | null {
    let best: AttentionNode | null = null;
    let bestD = Infinity;
    for (const n of noeuds) {
      if (n.v <= SEUIL_VIVANT) continue;
      const d = dist(pos, n.pos);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  /** Clignement + parole (avec petit bond) — la "vie" intérieure d'un Piuw. */
  private majVie(p: Piuw, dt: number): void {
    if (p.bond > 0) p.bond = Math.max(0, p.bond - dt * 3.3);

    if (p.clignoteTimer > 0) {
      p.clignoteTimer -= dt;
    } else {
      p.clignoteDans -= dt;
      if (p.clignoteDans <= 0) {
        p.clignoteTimer = 0.12;
        p.clignoteDans = 2 + this.rng() * 3;
      }
    }

    if (p.motTimer > 0) {
      p.motTimer -= dt;
      if (p.motTimer <= 0) p.mot = null;
    } else {
      p.prochainMot -= dt;
      if (p.prochainMot <= 0) {
        // Vocabulaire = onomatopées COMMUNES + l'accent propre au rêve du Piuw.
        // (Un Piuw « se-souvenir » dit parfois "Pwôô…", un Explorateur "Frtt !".)
        const accent = CARACTERE_REVE[p.reve].onomatopees;
        const tirage = this.rng();
        p.mot =
          tirage < 0.5
            ? ONOMATOPEES[Math.floor((tirage / 0.5) * ONOMATOPEES.length)]
            : accent[Math.floor(((tirage - 0.5) / 0.5) * accent.length)];
        p.motTimer = 1.1;
        p.prochainMot = 2.5 + this.rng() * 4;
        p.bond = 1;
      }
    }
  }

  /**
   * Opacité d'un Piuw : fondu d'entrée (~0,5 s) ET fondu de sortie (dernière ~1 s de vie).
   */
  static opacite(p: Piuw): number {
    const entree = clamp01(p.age / 0.5);
    const sortie = clamp01((p.vie - p.age) / 1.0);
    return Math.min(entree, sortie);
  }
}

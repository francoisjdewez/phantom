// ════════════════════════════════════════════════════════════════════════
//  core/types.ts — les FORMES (structures de données), sans logique.
//  Logique PURE.
// ════════════════════════════════════════════════════════════════════════

/** Un point dans le monde (coordonnées logiques, pas pixels écran). */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Les types de nœuds connus.
 * - "heart"    : Cœur de région (l'arbre du jardin, en zone A).
 * - "monument" : ancien penseur (conservé pour compat ; plus utilisé en data).
 * - "maison"   : la MAISON de Phantom (zone A — ex r1-monument).
 * - "foyer"    : le FOYER COMMUN, Cœur du Zurg (zone B — ex arbre de R2).
 * - "chantier" : le CHANTIER SUSPENDU (zone B — ex r2-monument).
 * - "flower"/"crystal" : anciens types (retirés des data, gardés pour compat).
 * NB : purement COSMÉTIQUE (le type ne sert qu'au rendu). Aucun impact équilibrage.
 */
export type NodeType =
  | "flower" | "crystal" | "monument" | "heart"
  | "maison" | "foyer" | "chantier";

/**
 * Les 8 Rêves Fondateurs.
 * Un Piuw PORTE un rêve et l'amplifie dans la région. R1 n'en utilise que 4.
 */
export type Reve =
  | "sauver"
  | "creer"
  | "explorer"
  | "esperer"
  | "proteger"
  | "comprendre"
  | "transmettre"
  | "se-souvenir";

/**
 * Un Nœud d'attention : l'unité de base du monde.
 * Sa "vie" est `v` ∈ [0,1] : monte quand on l'observe, s'oublie sinon.
 *
 */
export interface AttentionNode {
  id: string;
  type: NodeType;
  pos: Vec2;
  /** Attention/vie courante ∈ [0,1]. */
  v: number;
  /** Rayon d'attention : distance sous laquelle le regard agit. */
  attR: number;
  /** Taux de croissance sous le regard (growth rate). */
  gr: number;
  /** Taux d'oubli quand personne ne regarde (decay rate). */
  dc: number;
  /** Plancher de mémoire ancrée COURANT : `v` ne redescend jamais sous cette valeur. */
  ancree: number;
  /**
   * Plancher de mémoire ancrée APRÈS le premier éveil (mémoire « à deux vitesses »).
   * Au tout début, `ancree` est bas (le nœud peut « mourir » → tutoriel/peur de perdre) ;
   * dès qu'il est éveillé une première fois, `ancree` monte à cette valeur (l'acquis est gravé).
   */
  ancreeApresEveil: number;
  /** Le nœud a-t-il franchi son seuil d'éveil ? */
  eveille: boolean;
  /** Le Rêve que ce nœud porte (les Piuws qu'il fait naître héritent de ce rêve). */
  reve: Reve;
}

/**
 * Un ÉVÉNEMENT émis par la logique quand un moment marquant se produit.
 * La logique (core) ne dessine RIEN : elle se contente de SIGNALER « il vient
 * de se passer ça, à cet endroit ». C'est le rendu (render) qui décide de
 * l'effet visuel/sonore. (état ↛ rendu).
 */
export interface RegionEvent {
  /** "noeud-eveille" : un nœud franchit son seuil pour la 1re fois.
   *  "region-eveillee" : la région entière vient de s'éveiller. */
  type: "noeud-eveille" | "region-eveillee";
  /** Où ça se passe (coordonnées monde) — pour centrer l'effet. */
  pos: Vec2;
  /** Le type du nœud concerné (pour choisir la couleur de l'effet). */
  nodeType: NodeType;
  /** Le Rêve du nœud concerné (les Piuws nés à l'éveil héritent de ce rêve). */
  reve: Reve;
}

/** Les données STATIQUES d'une région (le "moule" rempli). */
export interface RegionData {
  id: string;
  nom: string;
  acte: number;
  /** Le Cœur de région : l'éveiller = éveiller la région. */
  coeur: AttentionNode;
  /** Les nœuds secondaires qui alimentent le Cœur. */
  noeuds: AttentionNode[];
  /** Condition de victoire de la région. */
  victoire: {
    /** Seuil minimal de `v` pour le Cœur. */
    coeurMin: number;
    /** Seuil minimal de `v` pour CHAQUE nœud. */
    noeudMin: number;
  };
}

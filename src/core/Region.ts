// ════════════════════════════════════════════════════════════════════════
//  core/Region.ts — UNE région en logique pure (le "moteur" d'une zone).
//  Met à jour tous ses nœuds + le Cœur selon le regard du joueur, et sait
//  dire si la région est éveillée.
// ════════════════════════════════════════════════════════════════════════

import type { AttentionNode, RegionData, RegionEvent, Vec2 } from "./types.js";
import { attentionAt, updateNodeAttention, plancherErode } from "./attention.js";
import { propagerAttention } from "./propagation.js";
import { prochainNeant, neantCible } from "./neant.js";

export class Region {
  readonly id: string;
  readonly nom: string;
  readonly acte: number;
  readonly coeur: AttentionNode;
  readonly noeuds: AttentionNode[];
  private readonly coeurMin: number;
  private readonly noeudMin: number;

  /** Vrai dès que la région a atteint sa condition de victoire (verrouillé une fois acquis). */
  eveillee = false;

  /**
   * Intensité du NÉANT sur la région ∈ [0,1] : l'oubli rendu VISIBLE.
   * Monte quand la zone est abandonnée, recule quand la vie revient. Le rendu
   * la lit chaque frame pour faire avancer/reculer le vide (modèle « pull »).
   */
  neant: number;

  /**
   * File des événements survenus depuis le dernier `viderEvenements()`.
   * On NE dessine pas ici : on note juste « ça vient d'arriver ». Le rendu
   * viendra lire (et vider) cette file pour déclencher flashs, Piuws, sons.
   */
  private readonly fileEvenements: RegionEvent[] = [];

  /** Temps absolu écoulé (s) — alimente la respiration de la propagation. */
  private temps = 0;

  /**
   * Temps de NÉGLIGENCE cumulé par nœud (s), clé = id du nœud. Monte tant que le
   * nœud n'est pas regardé, retombe à 0 dès qu'on pose le regard dessus. C'est lui
   * qui pilote la « peur de perdre » (cf. plancherErode dans attention.ts) — état
   * porté par la Région pour garder attention.ts pur et types.ts intact.
   */
  private readonly negligence = new Map<string, number>();

  constructor(data: RegionData) {
    this.id = data.id;
    this.nom = data.nom;
    this.acte = data.acte;
    // On copie les nœuds pour ne PAS modifier les données d'origine (réutilisables).
    this.coeur = { ...data.coeur };
    this.noeuds = data.noeuds.map((n) => ({ ...n }));
    this.coeurMin = data.victoire.coeurMin;
    this.noeudMin = data.victoire.noeudMin;
    // Le Néant démarre à l'état dormant de la région (vie initiale faible → vide présent).
    this.neant = neantCible(this.progression());
  }

  /** Tous les nœuds, Cœur compris (pratique pour le rendu et les tests). */
  tousLesNoeuds(): AttentionNode[] {
    return [this.coeur, ...this.noeuds];
  }

  /**
   * Avance la logique de la région d'un pas de temps.
   * @param dt secondes écoulées depuis la dernière frame.
   * @param regard position du regard du joueur (= position de Phantom en 3D),
   *               ou `null` si le joueur ne regarde rien (ex : test/headless).
   * @param illumine Phantom illumine-t-il (geste actif) ? Un élément ne GRANDIT
   *                 QUE si Phantom l'illumine ET est à portée. La simple présence
   *                 (proximité sans illumination) ne ravive plus rien — elle reste
   *                 un feedback visuel.
   *                 Défaut `true` = comportement historique (préserve les tests).
   */
  update(dt: number, regard: Vec2 | null, illumine: boolean = true): void {
    this.temps += dt;
    const tous = this.tousLesNoeuds();

    // 1) Passe REGARD : chaque nœud croît s'il est observé, s'oublie sinon.
    //    On suit aussi sa NÉGLIGENCE (temps sans regard) : au-delà du délai de
    //    grâce, son plancher de mémoire s'érode lentement → la « peur de perdre »
    //    (un nœud trop longtemps abandonné peut se rendormir, jamais mourir).
    for (const node of tous) {
      // Croissance UNIQUEMENT si Phantom ILLUMINE (geste actif) ET est à portée.
      // Sans illumination, a=0 → pas de croissance, juste l'oubli normal. La simple
      // présence (proximité) ne ravive plus rien.
      const a = illumine && regard ? attentionAt(regard, node.pos, node.attR) : 0;
      // Mise à jour de la négligence : remise à 0 si regardé, sinon on cumule.
      const neglige = a > 0 ? 0 : (this.negligence.get(node.id) ?? 0) + dt;
      this.negligence.set(node.id, neglige);
      // Plancher effectif (intact tant que pas trop négligé) → re-déclin possible.
      const plancher = plancherErode(node, neglige);
      updateNodeAttention(node, a, dt, plancher);
    }

    // 2) Passe PROPAGATION : les nœuds déjà éveillés et hauts contaminent leurs
    //    voisins proches (la vie appelle la vie). Sans aucun nœud éveillé, ne
    //    fait rien → le joueur reste le moteur du tout premier éveil.
    propagerAttention(tous, dt, this.temps);

    // 3) Passe ÉVEIL : on grave les premiers éveils — qu'ils viennent du regard
    //    OU de la propagation. Premier éveil → le plancher de mémoire MONTE
    //    (mémoire « à deux vitesses » : peur de perdre au début, acquis ensuite).
    for (const node of tous) {
      if (!node.eveille && node.v >= this.noeudMin) {
        node.eveille = true;
        node.ancree = Math.max(node.ancree, node.ancreeApresEveil);
        // On SIGNALE l'éveil du nœud (le rendu en fera un flash + naissance de Piuws).
        this.pousserEvenement({
          type: "noeud-eveille",
          pos: { ...node.pos },
          nodeType: node.type,
          reve: node.reve,
        });
      }
    }

    // 4) Passe NÉANT : l'oubli rendu visible avance/recule selon la vie moyenne.
    this.neant = prochainNeant(this.neant, this.progression(), dt);

    // Transition false → true de la région entière : l'Éveil spectaculaire.
    if (!this.eveillee && this.estVictorieuse()) {
      this.eveillee = true;
      this.pousserEvenement({
        type: "region-eveillee",
        pos: { ...this.coeur.pos },
        nodeType: this.coeur.type,
        reve: this.coeur.reve,
      });
    }
  }

  /**
   * Ajoute un événement à la file, avec un PLAFOND de sécurité : si personne ne
   * vide la file (appelant qui oublie `viderEvenements()`), elle ne grossit pas
   * à l'infini (anti-fuite mémoire). Au-delà du plafond, on ignore les nouveaux.
   */
  private pousserEvenement(ev: RegionEvent): void {
    if (this.fileEvenements.length < 200) this.fileEvenements.push(ev);
  }

  /**
   * Récupère ET vide la file des événements survenus depuis le dernier appel.
   * Le rendu appelle ça une fois par frame pour déclencher ses effets.
   */
  viderEvenements(): RegionEvent[] {
    const evts = this.fileEvenements.slice();
    this.fileEvenements.length = 0;
    return evts;
  }

  /** Condition de victoire (extraite du prototype : `tree.v>=.88 && nodes.every(v>=.6)`). */
  estVictorieuse(): boolean {
    return (
      this.coeur.v >= this.coeurMin &&
      this.noeuds.every((n) => n.v >= this.noeudMin)
    );
  }

  /** Progression globale ∈ [0,1] (moyenne des nœuds + Cœur) — utile pour l'UI/feedback. */
  progression(): number {
    const all = this.tousLesNoeuds();
    return all.reduce((s, n) => s + n.v, 0) / all.length;
  }

  /**
   * Progression VERS LA VICTOIRE ∈ [0,1] — chaque nœud est mesuré par rapport à SON
   * propre seuil requis (coeurMin/noeudMin), plafonné à 1. Contrairement à `progression()`
   * (moyenne brute des `v`, qui dépasse rarement ~0.7 au moment de l'éveil puisque les
   * seuils de victoire sont < 1), CETTE valeur atteint pile 1.0 quand `estVictorieuse()`
   * devient vrai. Sert la barre d'éveil (correctif 19/08, playtest : « la barre
   * se finit avant que la barre soit remplie »).
   */
  progressionVersVictoire(): number {
    const ratioCoeur = Math.min(1, this.coeur.v / this.coeurMin);
    const ratiosNoeuds = this.noeuds.map((n) => Math.min(1, n.v / this.noeudMin));
    const all = [ratioCoeur, ...ratiosNoeuds];
    return all.reduce((s, r) => s + r, 0) / all.length;
  }
}

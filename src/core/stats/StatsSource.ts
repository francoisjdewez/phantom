// ════════════════════════════════════════════════════════════════════════
//  core/stats/StatsSource.ts — LE PORT (contrat) de la source de réactions.
//  "D'où viennent les réactions des spectateurs ?" — le moteur s'en fiche :
//  il sait juste lire celles survenues depuis la dernière frame. AUCUN réseau,
//  (Pattern jumeau de Region.viderEvenements().)
//
// ════════════════════════════════════════════════════════════════════════

/**
 * Le GENRE de réaction d'un spectateur.
 * PIVOT TWITCH (choix de design) : ce sont les 5 RÉACTIONS TWITCH NATIVES.
 * `points` = Channel Points (les points de chaîne que les viewers dépensent).
 * Les autres sont les interactions Twitch classiques (follow, cheer, sub, raid).
 */
export type ReactionTwitch =
  | "points" // Channel Points : la réaction la plus fréquente, douce
  | "follow" // un nouveau follower
  | "cheer" // bits envoyés (cheer)
  | "sub" // abonnement (sub)
  | "raid"; // un raid : une vague de viewers arrive d'un coup

/**
 * UNE réaction survenue, déjà NORMALISÉE (le jeu ne voit jamais l'API brute).
 * C'est l'équivalent, côté spectateurs, de RegionEvent côté monde.
 */
export interface StatEvent {
  /** Le genre de réaction (une des 5 réactions Twitch). */
  type: ReactionTwitch;
  /** Intensité normalisée ∈ [0,1] (1 = réaction forte, ex. gros pic). PAS un compteur brut. */
  force: number;
  /** Horodatage (ms, comme performance.now()) — pour ordonner/regrouper les rafales. */
  t: number;
  /**
   * IDENTIFIANT DE GROUPE (optionnel) — toutes les réactions d'UNE MÊME rafale (un
   * raid) partagent le MÊME nombre, pour qu'on lise « elles débarquent ENSEMBLE ».
   * Donnée 100% pure (juste un nombre) : le core la transporte, le rendu en fera un
   * lien visuel (fils violets). Absent (undefined) pour une réaction isolée de fond.
   */
  groupe?: number;
}

/**
 * LE CONTRAT. Une source de stats sait répondre à UNE question :
 * « quelles réactions sont survenues depuis mon dernier appel ? »
 * Modèle "PULL" identique à Region.viderEvenements() : on draine, ça vide.
 *
 * Aujourd'hui : SimulatedStatsSource (fausses réactions).
 * Demain : TwitchStatsSource (vraie API) — sans toucher au reste du jeu.
 */
export interface StatsSource {
  /**
   * Avance la source d'un pas de temps (le sim génère ; le réel poll).
   * @param dt secondes écoulées depuis la dernière frame.
   */
  update(dt: number): void;

  /**
   * Récupère ET vide les réactions accumulées depuis le dernier appel.
   * Le PONT appelle ça une fois par frame. (Jumeau de viderEvenements().)
   */
  drainEvents(): StatEvent[];
}

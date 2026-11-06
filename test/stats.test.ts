// ════════════════════════════════════════════════════════════════════════
//  Tests du SIMULATEUR de stats + du PONT (le "2e joueur invisible").
//  RNG figé → 100% reproductible, AUCUN écran (Node pur, comme tout core/).
//
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import { PiuwSystem } from "../src/core/piuws.js";
import { SimulatedStatsSource, type SimReglages } from "../src/core/stats/SimulatedStatsSource.js";
import { StatsBridge, type BridgeReglages } from "../src/core/stats/StatsBridge.js";
import type { StatEvent } from "../src/core/stats/StatsSource.js";
import { ReactionsVisuelles } from "../src/core/reactions.js";

/** RNG déterministe : renvoie en boucle la même séquence. */
function rngFixe(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

/** Une source bidon qui crache des events fixes une seule fois (pour tester le pont seul). */
class SourceManuelle {
  constructor(private aDrainer: StatEvent[]) {}
  update(): void {}
  drainEvents(): StatEvent[] {
    const out = this.aDrainer;
    this.aDrainer = [];
    return out;
  }
}

describe("SimulatedStatsSource", () => {
  it("produit des events au fil du temps (RNG fixe → reproductible)", () => {
    // rng=0 < cadenceMoyenne*dt → émet une réaction de fond à chaque frame.
    // Avec rng=0, typePondere() retire d'abord le poids de "points" → type "points".
    const sim = new SimulatedStatsSource(undefined, rngFixe([0]));
    for (let i = 0; i < 30; i++) sim.update(1 / 60);
    const evts = sim.drainEvents();
    expect(evts.length).toBeGreaterThan(0);
    // Toutes les forces sont bien normalisées dans [0,1].
    expect(evts.every((e) => e.force >= 0 && e.force <= 1)).toBe(true);
    // Le type est toujours une des 5 réactions Twitch.
    const types = ["points", "follow", "cheer", "sub", "raid"];
    expect(evts.every((e) => types.includes(e.type))).toBe(true);
  });

  it("drainEvents() VIDE la file (on ne relit pas deux fois)", () => {
    const sim = new SimulatedStatsSource(undefined, rngFixe([0]));
    for (let i = 0; i < 10; i++) sim.update(1 / 60);
    expect(sim.drainEvents().length).toBeGreaterThan(0);
    expect(sim.drainEvents()).toHaveLength(0); // déjà drainé → vide
  });

  it("tirage PONDÉRÉ : chaque type sort avec SA propre force [min,max]", () => {
    // On force le déclenchement du fond (1er rng=0 < cadence*dt) puis on PILOTE
    // le type tiré via le 2e rng, et la force via le 3e rng (=0 → borne min).
    // PROFILS (force min) : points 0.15, follow 0.30, cheer 0.50, sub 0.80.
    // typePondere() : r = rng2 * 100 (POIDS_TOTAL). Tranches cumulées :
    //   points [0,50[, follow [50,72[, cheer [72,90[, sub [90,98[, raid [98,100[.
    const reglages: SimReglages = { cadenceMoyenne: 1000, tailleRafale: 4 };
    const cas: Array<[number, string, number]> = [
      [0.0, "points", 0.15], // r=0   → points, force=min
      [0.6, "follow", 0.3], // r=60  → follow, force=min
      [0.8, "cheer", 0.5], // r=80  → cheer,  force=min
      [0.95, "sub", 0.8], // r=95  → sub,    force=min
    ];
    for (const [rType, attenduType, attenduForce] of cas) {
      // séquence rng : [déclenche fond=0, choix type=rType, force=0]
      const sim = new SimulatedStatsSource(reglages, rngFixe([0, rType, 0]));
      sim.update(1 / 60);
      const evts = sim.drainEvents();
      expect(evts).toHaveLength(1);
      expect(evts[0].type).toBe(attenduType);
      expect(evts[0].force).toBeCloseTo(attenduForce, 5);
    }
  });

  it("un RAID déclenche une RAFALE (paquet de réactions raid d'un coup)", () => {
    // rng2 ≥ 0.98 → typePondere() tombe sur "raid" → rafale de tailleRafale events.
    const reglages: SimReglages = { cadenceMoyenne: 1000, tailleRafale: 5 };
    // séquence : [fond=0, type=0.99 (raid), puis forces des 5 raids=0]
    const sim = new SimulatedStatsSource(reglages, rngFixe([0, 0.99, 0, 0, 0, 0, 0]));
    sim.update(1 / 60);
    const evts = sim.drainEvents();
    expect(evts).toHaveLength(5);
    expect(evts.every((e) => e.type === "raid")).toBe(true);
    // Force d'un raid ∈ [0.90, 1.0] (avec rng=0 → borne min = 0.90).
    expect(evts.every((e) => e.force >= 0.9 && e.force <= 1)).toBe(true);
  });

  it("LIEN DE GROUPE : une rafale de raid → tous les events ont le MÊME groupe", () => {
    // rng2 ≥ 0.98 → "raid" → rafale. Tous les events de CETTE rafale doivent
    // partager un même numéro de groupe (les viewers débarquent ENSEMBLE).
    const reglages: SimReglages = { cadenceMoyenne: 1000, tailleRafale: 4 };
    const sim = new SimulatedStatsSource(reglages, rngFixe([0, 0.99, 0, 0, 0, 0]));
    sim.update(1 / 60);
    const evts = sim.drainEvents();
    expect(evts).toHaveLength(4);
    // Le groupe est défini ET identique pour tous.
    expect(evts[0].groupe).toBeTypeOf("number");
    expect(evts.every((e) => e.groupe === evts[0].groupe)).toBe(true);
  });

  it("LIEN DE GROUPE : une réaction de fond (non-raid) n'a PAS de groupe", () => {
    // rng=0 → fond, type "points" (pas une rafale) → groupe absent (undefined).
    const sim = new SimulatedStatsSource(undefined, rngFixe([0]));
    sim.update(1 / 60);
    const evts = sim.drainEvents();
    expect(evts.length).toBeGreaterThan(0);
    expect(evts.every((e) => e.type === "points")).toBe(true);
    expect(evts.every((e) => e.groupe === undefined)).toBe(true);
  });

  it("LIEN DE GROUPE : deux rafales successives ont des groupes DISTINCTS", () => {
    // Deux rafales raid d'affilée → le compteur interne s'incrémente → groupes ≠.
    const reglages: SimReglages = { cadenceMoyenne: 1000, tailleRafale: 2 };
    const sim = new SimulatedStatsSource(reglages, rngFixe([0, 0.99, 0, 0]));
    sim.update(1 / 60); // 1re rafale
    const rafale1 = sim.drainEvents();
    sim.update(1 / 60); // 2e rafale (même séquence rng en boucle)
    const rafale2 = sim.drainEvents();
    expect(rafale1).toHaveLength(2);
    expect(rafale2).toHaveLength(2);
    // Chaque rafale est cohérente en interne, mais les deux groupes diffèrent.
    expect(rafale1.every((e) => e.groupe === rafale1[0].groupe)).toBe(true);
    expect(rafale2.every((e) => e.groupe === rafale2[0].groupe)).toBe(true);
    expect(rafale1[0].groupe).not.toBe(rafale2[0].groupe);
  });

  it("un RAID spontané (probaRafale) force aussi une rafale", () => {
    // cadence=0 (pas de fond) ; rng=1 ≥ cadence*dt → pas de fond. Puis le 2e rng
    // teste probaRafale : on veut le déclencher. rng séquence : [1 (pas fond), 0 (raid spontané), forces...].
    const reglages: SimReglages = { cadenceMoyenne: 0, tailleRafale: 3, probaRafale: 1000 };
    const sim = new SimulatedStatsSource(reglages, rngFixe([1, 0, 0, 0, 0]));
    sim.update(1 / 60);
    const evts = sim.drainEvents();
    expect(evts).toHaveLength(3);
    expect(evts.every((e) => e.type === "raid")).toBe(true);
  });
});

describe("StatsBridge", () => {
  /** Un nœud de départ déjà un peu vivant (v=0.3) pour qu'il soit éligible. */
  function regionAvecNoeudVivant(): Region {
    const region = new Region(region1);
    region.coeur.v = 0.3;
    return region;
  }

  it("nourrit un nœud : v MONTE après une réaction", () => {
    const region = regionAvecNoeudVivant();
    const avant = region.coeur.v;
    // Source qui crache 1 réaction de force 1 sur le Cœur (regard pile dessus).
    const source = new SourceManuelle([{ type: "follow", force: 1, t: 0 }]);
    const reglages: BridgeReglages = { poussee: 0.05, plafond: 0.55, seuilPiuw: 0.8, probaHasard: 0 };
    const bridge = new StatsBridge(source, reglages, rngFixe([0.5]));
    bridge.update(1 / 60, region, region.coeur.pos, undefined);
    expect(region.coeur.v).toBeGreaterThan(avant);
  });

  it("NE dépasse JAMAIS le plafond 0.55 (canon : pas d'éveil seul)", () => {
    const region = new Region(region1);
    region.coeur.v = 0.54; // juste sous le plafond
    // Une avalanche de réactions FORTES.
    const events: StatEvent[] = Array.from({ length: 100 }, () => ({
      type: "cheer" as const,
      force: 1,
      t: 0,
    }));
    const source = new SourceManuelle(events);
    const bridge = new StatsBridge(
      source,
      { poussee: 0.5, plafond: 0.55, seuilPiuw: 2, probaHasard: 0 }, // seuilPiuw=2 → jamais de Piuw ici
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, undefined);
    // Malgré 100 grosses réactions, v reste collé au plafond, JAMAIS au-dessus.
    expect(region.coeur.v).toBeLessThanOrEqual(0.55);
    expect(region.coeur.eveille).toBe(false); // 0.55 < 0.6 → toujours pas éveillé
  });

  it("une réaction FORTE fait NAÎTRE un Piuw (portant le rêve du nœud)", () => {
    const region = regionAvecNoeudVivant();
    const piuws = new PiuwSystem(rngFixe([0.5]));
    expect(piuws.liste).toHaveLength(0);
    const source = new SourceManuelle([{ type: "sub", force: 0.95, t: 0 }]);
    const bridge = new StatsBridge(
      source,
      { poussee: 0.03, plafond: 0.55, seuilPiuw: 0.8, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, piuws);
    expect(piuws.liste).toHaveLength(1);
    expect(piuws.liste[0].reve).toBe(region.coeur.reve); // le Piuw porte le rêve du nœud nourri
  });

  it("une réaction FAIBLE ne fait PAS naître de Piuw", () => {
    const region = regionAvecNoeudVivant();
    const piuws = new PiuwSystem(rngFixe([0.5]));
    const source = new SourceManuelle([{ type: "points", force: 0.1, t: 0 }]);
    const bridge = new StatsBridge(
      source,
      { poussee: 0.03, plafond: 0.55, seuilPiuw: 0.8, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, piuws);
    expect(piuws.liste).toHaveLength(0); // 0.1 < 0.8 → rien
  });

  it("cible le nœud le plus PROCHE du regard (choix de design)", () => {
    const region = new Region(region1);
    // On rend TOUS les nœuds éligibles (un peu vivants).
    for (const n of region.tousLesNoeuds()) n.v = 0.3;
    // Regard collé sur un nœud secondaire précis.
    const vise = region.noeuds[0];
    const vAvant = vise.v;
    const source = new SourceManuelle([{ type: "follow", force: 1, t: 0 }]);
    // probaHasard=0 → toujours près du regard.
    const bridge = new StatsBridge(
      source,
      { poussee: 0.05, plafond: 0.55, seuilPiuw: 2, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, { ...vise.pos }, undefined);
    expect(vise.v).toBeGreaterThan(vAvant); // c'est bien le nœud visé qui a monté
  });

  it("CLAMP défensif : une force HORS borne haute (1.5) agit comme force=1", () => {
    // Une vraie source Twitch boguée pourrait envoyer 1.5 (non normalisé). Le pont
    // doit la clamper à 1 → le gain ne dépasse JAMAIS 1×poussée.
    const region = regionAvecNoeudVivant(); // coeur.v = 0.3
    const vAvant = region.coeur.v;
    const poussee = 0.05;
    const source = new SourceManuelle([{ type: "follow", force: 1.5, t: 0 }]);
    const bridge = new StatsBridge(
      source,
      { poussee, plafond: 0.55, seuilPiuw: 2, probaHasard: 0 }, // seuilPiuw=2 → pas de Piuw
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, undefined);
    // Gain attendu = clamp01(1.5) × poussée = 1 × 0.05, et SURTOUT pas 1.5 × 0.05.
    expect(region.coeur.v).toBeCloseTo(vAvant + poussee, 6);
  });

  it("CLAMP défensif : une force NÉGATIVE (-0.2) agit comme force=0 (aucun effet)", () => {
    const region = regionAvecNoeudVivant(); // coeur.v = 0.3
    const vAvant = region.coeur.v;
    const piuws = new PiuwSystem(rngFixe([0.5]));
    const source = new SourceManuelle([{ type: "sub", force: -0.2, t: 0 }]);
    const bridge = new StatsBridge(
      source,
      { poussee: 0.05, plafond: 0.55, seuilPiuw: 0.8, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, piuws);
    // clamp01(-0.2) = 0 → aucun gain d'attention ET aucun Piuw (0 < seuilPiuw).
    expect(region.coeur.v).toBeCloseTo(vAvant, 6);
    expect(piuws.liste).toHaveLength(0);
  });

  it("LIEN DE GROUPE : le pont propage le `groupe` de l'event jusqu'à la réaction", () => {
    const region = regionAvecNoeudVivant();
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    // Deux events d'une même rafale (groupe 7) → leurs réactions doivent porter groupe 7.
    const source = new SourceManuelle([
      { type: "raid", force: 0.95, t: 0, groupe: 7 },
      { type: "raid", force: 0.95, t: 0, groupe: 7 },
    ]);
    const bridge = new StatsBridge(
      source,
      { poussee: 0.03, plafond: 0.55, seuilPiuw: 2, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, undefined, reactions);
    expect(reactions.liste).toHaveLength(2);
    expect(reactions.liste.every((r) => r.groupe === 7)).toBe(true);
  });

  it("LIEN DE GROUPE : une réaction de fond (sans groupe) donne une réaction sans groupe", () => {
    const region = regionAvecNoeudVivant();
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    const source = new SourceManuelle([{ type: "points", force: 0.3, t: 0 }]); // pas de groupe
    const bridge = new StatsBridge(
      source,
      { poussee: 0.03, plafond: 0.55, seuilPiuw: 2, probaHasard: 0 },
      rngFixe([0.5]),
    );
    bridge.update(1 / 60, region, region.coeur.pos, undefined, reactions);
    expect(reactions.liste).toHaveLength(1);
    expect(reactions.liste[0].groupe).toBeUndefined();
  });

  it("sans aucun nœud vivant, le pont n'a rien à nourrir (pas de crash)", () => {
    const region = new Region(region1);
    for (const n of region.tousLesNoeuds()) n.v = 0; // tout éteint
    const source = new SourceManuelle([{ type: "points", force: 1, t: 0 }]);
    const bridge = new StatsBridge(source, undefined, rngFixe([0.5]));
    expect(() => bridge.update(1 / 60, region, null, undefined)).not.toThrow();
  });
});

describe("Découplage (le core ignore les stats)", () => {
  it("Region tourne plusieurs frames SANS rien savoir des stats", () => {
    // Garde-fou anti "écran noir" : la boucle pure doit tourner sans planter.
    const region = new Region(region1);
    expect(() => {
      for (let i = 0; i < 60; i++) region.update(1 / 60, { x: 160, y: 90 });
    }).not.toThrow();
  });
});

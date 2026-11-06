// Tests du NÉANT qui efface (comportement vivant, 2026-06-18).
// Intensité de région ∈ [0,1] : monte quand on abandonne, recule quand la vie revient.
// Logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import {
  neantCible,
  prochainNeant,
  detresseLocale,
  vrilleAllongement,
  neantFremissement,
  NEANT_SEUIL_VIE,
  NEANT_DETRESSE_SEUIL,
  NEANT_VRILLE_SATURATION,
  NEANT_FREMISSEMENT_AMPLITUDE,
} from "../src/core/neant.js";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import type { Vec2 } from "../src/core/types.js";

const DT = 1 / 60;

function regarder(r: Region, regard: Vec2 | null, secondes: number): void {
  const frames = Math.round(secondes / DT);
  for (let i = 0; i < frames; i++) r.update(DT, regard);
}

describe("Néant — la cible", () => {
  it("vie nulle → Néant plein (1)", () => {
    expect(neantCible(0)).toBeCloseTo(1, 5);
  });

  it("vie au-dessus du seuil → Néant nul (0)", () => {
    expect(neantCible(NEANT_SEUIL_VIE)).toBe(0);
    expect(neantCible(0.9)).toBe(0);
  });

  it("la cible reste dans [0,1]", () => {
    for (const p of [-1, 0, 0.3, 0.55, 1, 2]) {
      const c = neantCible(p);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("Néant — la dynamique", () => {
  it("quand on abandonne (vie basse), le Néant MONTE vers sa cible", () => {
    let neant = 0;
    for (let i = 0; i < 600; i++) neant = prochainNeant(neant, 0, DT); // 10 s, vie nulle
    expect(neant).toBeGreaterThan(0.4);
  });

  it("quand la vie est haute, le Néant RECULE vers 0", () => {
    let neant = 1;
    for (let i = 0; i < 600; i++) neant = prochainNeant(neant, 0.9, DT); // 10 s, vie pleine
    expect(neant).toBeLessThan(0.1);
  });

  it("le recul est plus rapide que la montée (la lumière agit plus vite que le vide)", () => {
    // 1 s de montée depuis 0 (vie nulle) vs 1 s de recul depuis 1 (vie pleine).
    let monte = 0;
    let recule = 1;
    for (let i = 0; i < 60; i++) {
      monte = prochainNeant(monte, 0, DT);
      recule = prochainNeant(recule, 0.9, DT);
    }
    const gagneEnMontee = monte - 0; // combien le Néant a gagné
    const perduEnRecul = 1 - recule; // combien le Néant a perdu
    expect(perduEnRecul).toBeGreaterThan(gagneEnMontee);
  });

  it("reste toujours dans [0,1]", () => {
    let neant = 0.5;
    for (let i = 0; i < 1000; i++) {
      neant = prochainNeant(neant, Math.random(), DT);
      expect(neant).toBeGreaterThanOrEqual(0);
      expect(neant).toBeLessThanOrEqual(1);
    }
  });
});

describe("Néant — détresse LOCALE par nœud (P1 critic)", () => {
  it("un nœud presque éteint (v bas) → détresse HAUTE", () => {
    expect(detresseLocale(0)).toBeCloseTo(1, 5); // vie nulle = détresse maximale
    expect(detresseLocale(0.1)).toBeGreaterThan(0.5);
  });

  it("un nœud vivant (v = 1) → détresse NULLE", () => {
    expect(detresseLocale(1)).toBe(0);
  });

  it("au seuil (et au-dessus), la détresse est nulle (pas de vide sur un nœud qui tient)", () => {
    expect(detresseLocale(NEANT_DETRESSE_SEUIL)).toBe(0);
    expect(detresseLocale(0.6)).toBe(0);
  });

  it("la détresse reste toujours dans [0,1]", () => {
    for (const v of [-1, 0, 0.2, 0.4, 0.7, 1, 2]) {
      const d = detresseLocale(v);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("la détresse est indépendante du Néant global (juste fonction de v)", () => {
    // Même v → même détresse, quel que soit l'état de la région autour.
    expect(detresseLocale(0.2)).toBeCloseTo(detresseLocale(0.2), 10);
    // Et elle DÉCROÎT quand on ravive le nœud (v monte).
    expect(detresseLocale(0.1)).toBeGreaterThan(detresseLocale(0.3));
  });
});

describe("Néant — vrilles du vide (allongement, purement visuel)", () => {
  it("pas de vrille sans détresse OU sans durée (timer ou det nul → 0)", () => {
    expect(vrilleAllongement(0, 1)).toBe(0); // détresse mais pas encore soutenue
    expect(vrilleAllongement(10, 0)).toBe(0); // soutenue mais nœud ravivé (det=0)
    expect(vrilleAllongement(0, 0)).toBe(0);
  });

  it("plus la détresse DURE, plus la vrille s'allonge (monotone croissant)", () => {
    const a = vrilleAllongement(0.5, 1);
    const b = vrilleAllongement(2, 1);
    const c = vrilleAllongement(NEANT_VRILLE_SATURATION, 1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("sature à 1 au-delà du seuil de saturation (det plein)", () => {
    expect(vrilleAllongement(NEANT_VRILLE_SATURATION, 1)).toBeCloseTo(1, 5);
    expect(vrilleAllongement(NEANT_VRILLE_SATURATION * 3, 1)).toBeCloseTo(1, 5);
  });

  it("reste borné [0,1] et se rétracte quand la détresse baisse (det plus faible)", () => {
    for (const timer of [0, 1, 3, 5, 20]) {
      for (const det of [0, 0.2, 0.5, 1]) {
        const v = vrilleAllongement(timer, det);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    // À durée égale, moins de détresse → vrille plus courte (rétractation au réveil).
    expect(vrilleAllongement(5, 0.3)).toBeLessThan(vrilleAllongement(5, 0.9));
  });
});

describe("Néant — intégré à la Région 1", () => {
  it("une région fraîche démarre avec du Néant présent (zone dormante)", () => {
    const r = new Region(region1);
    expect(r.neant).toBeGreaterThan(0.5);
  });

  it("abandonnée longtemps, la région voit son Néant grimper", () => {
    const r = new Region(region1);
    const avant = r.neant;
    regarder(r, null, 20);
    expect(r.neant).toBeGreaterThanOrEqual(avant);
    expect(r.neant).toBeGreaterThan(0.8);
  });

  it("jouée jusqu'à l'éveil, la région a chassé le Néant (proche de 0)", () => {
    const r = new Region(region1);
    // joueur auto éprouvé (cf. region.test) : remplir À FOND le retardataire par
    // salves, puis nourrir le Cœur — sinon ça oscille sans jamais finir le Cœur.
    let t = 0;
    while (!r.estVictorieuse() && t < 240) {
      const enRetard = r.noeuds.filter((n) => n.v < 0.75).sort((a, b) => a.v - b.v)[0];
      if (enRetard) {
        while (enRetard.v < 0.99 && t < 240) {
          r.update(DT, enRetard.pos);
          t += DT;
        }
      } else {
        r.update(DT, r.coeur.pos);
        t += DT;
      }
    }
    expect(r.estVictorieuse()).toBe(true);
    expect(r.neant).toBeLessThan(0.15);
  });
});

describe("Frémissement du Néant (vide qui ronge de façon inégale)", () => {
  it("vide ABSENT (intensité 0) → aucun frémissement", () => {
    for (const t of [0, 1, 3.7, 10]) {
      // toBeCloseTo (et non toBe) car 0 × onde peut produire -0 en JS, ce qui est
      // bien « aucun frémissement » mais n'est pas strictement === 0.
      expect(neantFremissement(t, 0)).toBeCloseTo(0, 10);
    }
  });

  it("le frémissement VARIE dans le temps (il tremble, pas un mur lisse)", () => {
    const a = neantFremissement(0.4, 1);
    const b = neantFremissement(1.9, 1);
    expect(a).not.toBeCloseTo(b, 3); // deux instants → deux valeurs distinctes
  });

  it("plus le Néant est INTENSE, plus il frémit fort (oubli profond plus avide)", () => {
    // À un instant où l'onde est franchement non nulle, l'amplitude croît avec
    // l'intensité. On prend la valeur absolue (le signe de l'onde importe peu).
    const t = 0.4;
    const faible = Math.abs(neantFremissement(t, 0.2));
    const fort = Math.abs(neantFremissement(t, 1));
    expect(fort).toBeGreaterThan(faible);
  });

  it("reste BORNÉ par l'amplitude (le tremblement ne s'emballe jamais)", () => {
    // On échantillonne finement sur plusieurs secondes : |frémissement| à pleine
    // intensité ne dépasse jamais l'amplitude déclarée (somme des deux ondes ≤ 1).
    let maxAbs = 0;
    for (let t = 0; t < 30; t += 0.01) {
      maxAbs = Math.max(maxAbs, Math.abs(neantFremissement(t, 1)));
    }
    expect(maxAbs).toBeLessThanOrEqual(NEANT_FREMISSEMENT_AMPLITUDE + 1e-9);
  });
});

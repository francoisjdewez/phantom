// Tests des DOUBLES D'ATTENTION (comportement vivant, 2026-06-18).
// Échos qui orbitent autour des nœuds bien éveillés et s'estompent s'ils faiblissent.
// Logique pure, sans navigateur. RNG injecté pour des tests reproductibles.
import { describe, it, expect } from "vitest";
import {
  DoublesSystem,
  DOUBLE_PAR_NOEUD,
  DOUBLE_PROD_INTERVAL,
  DOUBLE_SEUIL_NAISSANCE,
} from "../src/core/doubles.js";
import type { AttentionNode } from "../src/core/types.js";

const DT = 1 / 60;

/** RNG déterministe (suite fixe) pour des tests reproductibles. */
function rngFixe(): () => number {
  let s = 0.123;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function noeud(over: Partial<AttentionNode> = {}): AttentionNode {
  return {
    id: "n1",
    type: "flower",
    pos: { x: 100, y: 100 },
    v: 0.9,
    attR: 30,
    gr: 0.06,
    dc: 0.02,
    ancree: 0.02,
    ancreeApresEveil: 0.45,
    eveille: true,
    reve: "esperer",
    ...over,
  };
}

/** Avance le système `secondes` avec les mêmes nœuds. */
function avancer(sys: DoublesSystem, noeuds: AttentionNode[], secondes: number): void {
  const frames = Math.round(secondes / DT);
  for (let i = 0; i < frames; i++) sys.update(DT, noeuds);
}

describe("Doubles d'Attention", () => {
  it("un nœud bien éveillé finit par enfanter des doubles (jusqu'au plafond par nœud)", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: 0.9, eveille: true });
    avancer(sys, [n], DOUBLE_PROD_INTERVAL * (DOUBLE_PAR_NOEUD + 1));
    expect(sys.liste.length).toBe(DOUBLE_PAR_NOEUD);
  });

  it("un nœud sous le seuil de naissance n'enfante aucun double", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: DOUBLE_SEUIL_NAISSANCE - 0.05, eveille: true });
    avancer(sys, [n], 10);
    expect(sys.liste.length).toBe(0);
  });

  it("un nœud non éveillé (même haut) n'enfante aucun double", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: 0.95, eveille: false });
    avancer(sys, [n], 10);
    expect(sys.liste.length).toBe(0);
  });

  it("les doubles orbitent AUTOUR de leur source (restent dans un voisinage borné)", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: 0.9 });
    avancer(sys, [n], 8);
    expect(sys.liste.length).toBeGreaterThan(0);
    for (const d of sys.liste) {
      expect(DoublesSystem.distanceA(d, n.pos)).toBeLessThan(40); // jamais loin du nœud
    }
  });

  it("quand la source faiblit, ses doubles s'estompent puis disparaissent", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: 0.9 });
    avancer(sys, [n], 8);
    expect(sys.liste.length).toBeGreaterThan(0);
    // La source s'effondre : plus rien ne nourrit les doubles.
    n.v = 0.2;
    avancer(sys, [n], 12);
    expect(sys.liste.length).toBe(0);
  });

  it("respecte un plafond global (anti-fuite mémoire)", () => {
    const sys = new DoublesSystem(rngFixe(), 5); // plafond bas pour le test
    // beaucoup de nœuds qualifiés
    const noeuds = Array.from({ length: 10 }, (_, i) =>
      noeud({ id: `n${i}`, pos: { x: i * 30, y: 100 }, v: 0.9 }),
    );
    avancer(sys, noeuds, 30);
    expect(sys.liste.length).toBeLessThanOrEqual(5);
  });

  it("l'intensité (opacité) reste dans [0,1]", () => {
    const sys = new DoublesSystem(rngFixe());
    const n = noeud({ v: 0.9 });
    avancer(sys, [n], 6);
    for (const d of sys.liste) {
      const op = DoublesSystem.opacite(d);
      expect(op).toBeGreaterThanOrEqual(0);
      expect(op).toBeLessThanOrEqual(1);
    }
  });
});

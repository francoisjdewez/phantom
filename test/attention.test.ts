// Tests des FORMULES d'attention (core/attention.ts) — logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import {
  attentionAt,
  clamp01,
  dist,
  updateNodeAttention,
} from "../src/core/attention.js";
import type { AttentionNode } from "../src/core/types.js";

function nodeTest(over: Partial<AttentionNode> = {}): AttentionNode {
  return {
    id: "t",
    type: "flower",
    pos: { x: 0, y: 0 },
    v: 0.1,
    attR: 30,
    gr: 0.45,
    dc: 0.05,
    ancree: 0.02,
    ancreeApresEveil: 0.45,
    eveille: false,
    reve: "esperer",
    ...over,
  };
}

describe("attentionAt (force du regard)", () => {
  it("vaut 1 quand le regard est pile sur la cible", () => {
    expect(attentionAt({ x: 5, y: 5 }, { x: 5, y: 5 }, 30)).toBe(1);
  });
  it("décroît avec la distance et vaut 0 au bord", () => {
    expect(attentionAt({ x: 0, y: 0 }, { x: 15, y: 0 }, 30)).toBeCloseTo(0.5);
    expect(attentionAt({ x: 0, y: 0 }, { x: 30, y: 0 }, 30)).toBe(0);
  });
  it("vaut 0 au-delà du rayon", () => {
    expect(attentionAt({ x: 0, y: 0 }, { x: 100, y: 0 }, 30)).toBe(0);
  });
});

describe("updateNodeAttention (croissance / oubli / mémoire ancrée)", () => {
  it("v MONTE quand on observe (attention > 0)", () => {
    const n = nodeTest({ v: 0.1 });
    updateNodeAttention(n, 1, 1 / 60);
    expect(n.v).toBeGreaterThan(0.1);
  });

  it("un nœud observé en continu atteint 1 (et n'overshoot pas)", () => {
    const n = nodeTest({ v: 0.07, gr: 0.45 });
    for (let i = 0; i < 60 * 5; i++) updateNodeAttention(n, 1, 1 / 60);
    expect(n.v).toBe(1);
  });

  it("v BAISSE quand personne ne regarde (oubli)", () => {
    const n = nodeTest({ v: 0.8 });
    updateNodeAttention(n, 0, 1 / 60);
    expect(n.v).toBeLessThan(0.8);
  });

  it("l'oubli est PLUS LENT quand v est haut (mémoire ancrée via 1 - v*0.8)", () => {
    const haut = nodeTest({ v: 0.9 });
    const bas = nodeTest({ v: 0.3 });
    const avantHaut = haut.v;
    const avantBas = bas.v;
    updateNodeAttention(haut, 0, 1);
    updateNodeAttention(bas, 0, 1);
    const perteHaut = avantHaut - haut.v;
    const perteBas = avantBas - bas.v;
    expect(perteHaut).toBeLessThan(perteBas);
  });

  it("v ne descend JAMAIS sous le plancher `ancree`", () => {
    const n = nodeTest({ v: 0.05, ancree: 0.02, dc: 0.5 });
    for (let i = 0; i < 1000; i++) updateNodeAttention(n, 0, 1 / 60);
    expect(n.v).toBeGreaterThanOrEqual(0.02);
  });
});

describe("utilitaires", () => {
  it("clamp01 borne dans [0,1]", () => {
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(-0.3)).toBe(0);
    expect(clamp01(0.42)).toBe(0.42);
  });
  it("dist calcule la distance euclidienne", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

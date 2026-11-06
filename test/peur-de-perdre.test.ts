// Tests de la « PEUR DE PERDRE » — re-déclin LENT d'un nœud négligé (enjeu de fin
// de partie), sans jamais le tuer ni casser l'équilibrage. Logique pure.
import { describe, it, expect } from "vitest";
import {
  plancherErode,
  PEUR_DELAI_GRACE,
  PEUR_PLANCHER_MIN,
  PEUR_VITESSE_EROSION,
} from "../src/core/attention.js";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import type { AttentionNode } from "../src/core/types.js";

const DT = 1 / 60;

/** Un nœud éveillé typique (plancher ancré haut, comme après le 1er éveil). */
function noeudAncre(ancree = 0.45): AttentionNode {
  return {
    id: "n",
    type: "monument",
    pos: { x: 0, y: 0 },
    v: 0.8,
    attR: 34,
    gr: 0.06,
    dc: 0.05,
    ancree,
    ancreeApresEveil: 0.45,
    eveille: true,
    reve: "esperer",
  };
}

describe("plancherErode (le plancher d'un nœud négligé)", () => {
  it("AVANT le délai de grâce, le plancher est INTACT (rien ne change)", () => {
    const n = noeudAncre(0.45);
    expect(plancherErode(n, 0)).toBe(0.45);
    expect(plancherErode(n, PEUR_DELAI_GRACE)).toBe(0.45);
    expect(plancherErode(n, PEUR_DELAI_GRACE - 1)).toBe(0.45);
  });

  it("APRÈS le délai de grâce, le plancher s'érode LENTEMENT", () => {
    const n = noeudAncre(0.45);
    const apres10 = plancherErode(n, PEUR_DELAI_GRACE + 10);
    // 10 s au-delà de la grâce × vitesse → petite érosion (lente, pas brutale).
    expect(apres10).toBeCloseTo(0.45 - 10 * PEUR_VITESSE_EROSION, 6);
    expect(apres10).toBeLessThan(0.45);
    expect(apres10).toBeGreaterThan(PEUR_PLANCHER_MIN);
  });

  it("ne descend JAMAIS sous le plancher minimum (un nœud se rendort, ne meurt pas)", () => {
    const n = noeudAncre(0.45);
    // Négligence énorme : le plancher sature à PEUR_PLANCHER_MIN.
    expect(plancherErode(n, 10_000)).toBe(PEUR_PLANCHER_MIN);
  });

  it("un nœud au plancher déjà BAS (jamais éveillé) n'est jamais REMONTÉ par l'érosion", () => {
    // ancree 0.02 < PLANCHER_MIN : la fonction ne doit pas le faire remonter à 0.15.
    const n = noeudAncre(0.02);
    expect(plancherErode(n, 10_000)).toBe(0.02);
    expect(plancherErode(n, 0)).toBe(0.02);
  });

  it("l'érosion est monotone : plus c'est négligé, plus le plancher est bas", () => {
    const n = noeudAncre(0.45);
    const a = plancherErode(n, PEUR_DELAI_GRACE + 5);
    const b = plancherErode(n, PEUR_DELAI_GRACE + 20);
    expect(b).toBeLessThanOrEqual(a);
  });
});

describe("Peur de perdre, intégrée à la Région (sans casser l'équilibrage)", () => {
  it("ÉQUILIBRAGE PRÉSERVÉ : la région reste gagnable en jouant normalement", () => {
    // Joueur auto : on sécurise le nœud le plus bas, puis on nourrit le Cœur.
    // Avec la peur de perdre active, la victoire doit RESTER atteignable < 240 s.
    const r = new Region(region1);
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
    expect(t).toBeLessThan(240);
  });

  it("une négligence COURTE (sous la grâce) ne fait pas re-décliner un nœud éveillé", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;
    for (let i = 0; i < Math.round(12 / DT); i++) r.update(DT, monument.pos); // éveil
    const apresEveil = monument.v;
    // 20 s ignorée (< 25 s de grâce) : le plancher tient, v ne descend pas dessous.
    for (let i = 0; i < Math.round(20 / DT); i++) r.update(DT, null);
    expect(monument.v).toBeGreaterThanOrEqual(0.45);
    expect(monument.v).toBeLessThanOrEqual(apresEveil + 1e-6);
  });

  it("RE-DÉCLIN puis RÉPARATION : longue négligence baisse v, le regard la restaure", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;
    for (let i = 0; i < Math.round(12 / DT); i++) r.update(DT, monument.pos); // éveil
    // Longue négligence → re-déclin (mais jamais sous le plancher minimum).
    for (let i = 0; i < Math.round(90 / DT); i++) r.update(DT, null);
    expect(monument.v).toBeLessThan(0.45); // l'enjeu est revenu
    expect(monument.v).toBeGreaterThanOrEqual(PEUR_PLANCHER_MIN - 1e-6); // pas mort
    // Le regard répare aussitôt.
    const bas = monument.v;
    for (let i = 0; i < Math.round(6 / DT); i++) r.update(DT, monument.pos);
    expect(monument.v).toBeGreaterThan(bas);
  });
});

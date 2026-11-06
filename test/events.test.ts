// Tests des ÉVÉNEMENTS d'Éveil (P1-1/P1-2) — la logique SIGNALE les moments
// marquants pour que le rendu déclenche flashs + naissance de Piuws.
// Logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import type { Vec2 } from "../src/core/types.js";

const DT = 1 / 60;

function regarder(r: Region, regard: Vec2 | null, secondes: number): void {
  const frames = Math.round(secondes / DT);
  for (let i = 0; i < frames; i++) r.update(DT, regard);
}

describe("Événements d'Éveil", () => {
  it("au démarrage, aucun événement", () => {
    const r = new Region(region1);
    expect(r.viderEvenements()).toHaveLength(0);
  });

  it("raviver un nœud émet UN événement 'noeud-eveille' avec sa position et son type", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;
    regarder(r, monument.pos, 12);

    const evts = r.viderEvenements();
    const eveilFleur = evts.find((e) => e.type === "noeud-eveille" && e.nodeType === "maison");
    expect(eveilFleur).toBeDefined();
    expect(eveilFleur!.pos).toEqual(monument.pos);
  });

  it("un nœud n'émet son éveil QU'UNE fois (pas à chaque frame)", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;
    regarder(r, monument.pos, 12);
    r.viderEvenements(); // on vide le premier éveil
    // On continue de la regarder : elle reste éveillée mais ne ré-émet rien.
    regarder(r, monument.pos, 5);
    const reEmis = r.viderEvenements().filter((e) => e.nodeType === "maison");
    expect(reEmis).toHaveLength(0);
  });

  it("viderEvenements() vide bien la file (pas de doublon au prochain appel)", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;
    regarder(r, monument.pos, 14);
    expect(r.viderEvenements().length).toBeGreaterThan(0);
    expect(r.viderEvenements()).toHaveLength(0);
  });

  it("éveiller toute la région émet un événement 'region-eveillee'", () => {
    const r = new Region(region1);
    const tousLesEvts: string[] = [];
    const collecter = () => {
      for (const e of r.viderEvenements()) tousLesEvts.push(e.type);
    };
    // Joueur auto (même stratégie que region.test) : remplir À FOND le nœud le
    // plus en retard par salves, puis nourrir le Cœur.
    let t = 0;
    while (!r.estVictorieuse() && t < 240) {
      const enRetard = r.noeuds.filter((n) => n.v < 0.75).sort((a, b) => a.v - b.v)[0];
      if (enRetard) {
        while (enRetard.v < 0.99 && t < 240) {
          r.update(DT, enRetard.pos);
          collecter();
          t += DT;
        }
      } else {
        r.update(DT, r.coeur.pos);
        collecter();
        t += DT;
      }
    }
    expect(r.eveillee).toBe(true);
    expect(tousLesEvts).toContain("region-eveillee");
  });
});

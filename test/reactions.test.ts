// ════════════════════════════════════════════════════════════════════════
//  Tests des RÉACTIONS VISIBLES du public (la lueur qui descend du Voile).
//  Logique PURE, RNG figé → reproductible, AUCUN écran (Node pur).
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { ReactionsVisuelles, REACTIONS_MAX } from "../src/core/reactions.js";

/** RNG déterministe : renvoie en boucle la même séquence. */
function rngFixe(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

/** Avance le système de `n` frames de `dt` secondes. */
function avancer(r: ReactionsVisuelles, n: number, dt = 1 / 60): void {
  for (let i = 0; i < n; i++) r.update(dt);
}

describe("ReactionsVisuelles", () => {
  it("naît EN HAUT (y négatif) puis se RAPPROCHE de la cible au fil du temps", () => {
    // rng=0.5 → pas d'étalement (départX = cible.x), durée = milieu de [1.2,1.8].
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    const cible = { x: 160, y: 120 };
    reactions.spawn(cible, "#00FFFF", 0.4);

    const r = reactions.liste[0];
    expect(r.pos.y).toBeLessThan(0); // naît au-dessus du cadre (le Voile)

    const yDepart = r.pos.y;
    avancer(reactions, 20); // ~0.33s
    const yMilieu = reactions.liste[0].pos.y;
    expect(yMilieu).toBeGreaterThan(yDepart); // descend (y monde croît vers le bas)
    expect(yMilieu).toBeLessThan(cible.y); // pas encore arrivée
  });

  it("ARRIVE à la cible puis MEURT (la liste se vide)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    const cible = { x: 100, y: 90 };
    reactions.spawn(cible, "#FF0050", 0.5);

    // Durée max possible = 1.8s ; on avance largement au-delà.
    avancer(reactions, 130); // ~2.16s

    // Au moment de l'arrivée, `arrive` est passé true et la pos est pile sur la cible,
    // puis la frame suivante la retire → la liste finit vide.
    expect(reactions.liste).toHaveLength(0);
  });

  it("passe par l'état `arrive` (pile sur la cible) avant de mourir", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    const cible = { x: 50, y: 70 };
    reactions.spawn(cible, "#FFD580", 0.3);

    // On avance frame par frame et on capture l'instant `arrive`.
    let vuArrive = false;
    for (let i = 0; i < 130; i++) {
      reactions.update(1 / 60);
      const r = reactions.liste[0];
      if (r && r.arrive) {
        vuArrive = true;
        expect(r.pos.x).toBeCloseTo(cible.x, 5);
        expect(r.pos.y).toBeCloseTo(cible.y, 5);
        break;
      }
    }
    expect(vuArrive).toBe(true);
  });

  it("PLAFOND 24 : la liste ne dépasse jamais REACTIONS_MAX (anti-fuite)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    for (let i = 0; i < 200; i++) {
      reactions.spawn({ x: 160, y: 90 }, "#80FF80", 0.4);
    }
    expect(REACTIONS_MAX).toBe(24);
    expect(reactions.liste.length).toBeLessThanOrEqual(REACTIONS_MAX);
  });

  it("OPACITÉ toujours dans [0,1] tout au long de la vie", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    reactions.spawn({ x: 160, y: 120 }, "#7A5CFF", 0.6);
    for (let i = 0; i < 130; i++) {
      reactions.update(1 / 60);
      const r = reactions.liste[0];
      if (!r) break;
      expect(r.opacite).toBeGreaterThanOrEqual(0);
      expect(r.opacite).toBeLessThanOrEqual(1);
    }
  });

  it("un PIC (force ≥ 0.8) est marqué `pic`, une réaction douce ne l'est pas", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    reactions.spawn({ x: 10, y: 10 }, "#00FFFF", 0.85); // pic
    reactions.spawn({ x: 20, y: 20 }, "#00FFFF", 0.3); // doux
    expect(reactions.liste[0].pic).toBe(true);
    expect(reactions.liste[1].pic).toBe(false);
  });

  it("`fromX` impose le X de départ (utile pour viser une colonne du Voile)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    // Signature : spawn(cible, couleur, force, style, fromX). fromX est en 5e position.
    reactions.spawn({ x: 160, y: 90 }, "#00FFFF", 0.4, "points", 42);
    expect(reactions.liste[0].departX).toBe(42);
    expect(reactions.liste[0].pos.x).toBe(42);
  });

  it("le STYLE est PORTÉ tel quel par la réaction (string pure, pour le rendu)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    reactions.spawn({ x: 10, y: 10 }, "#FFD580", 0.5, "cheer");
    reactions.spawn({ x: 20, y: 20 }, "#7A5CFF", 0.9, "raid");
    expect(reactions.liste[0].style).toBe("cheer");
    expect(reactions.liste[1].style).toBe("raid");
  });

  it("sans style fourni, la réaction retombe sur `neutre` (rendu générique)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    reactions.spawn({ x: 10, y: 10 }, "#00FFFF", 0.4); // pas de style → défaut
    expect(reactions.liste[0].style).toBe("neutre");
  });

  it("LIEN DE GROUPE : `groupe` (6e param) est PORTÉ par la réaction", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    // Signature : spawn(cible, couleur, force, style, fromX, groupe). groupe en 6e position.
    reactions.spawn({ x: 10, y: 10 }, "#7A5CFF", 0.95, "raid", undefined, 3);
    expect(reactions.liste[0].groupe).toBe(3);
  });

  it("LIEN DE GROUPE : sans `groupe`, la réaction n'en a pas (undefined)", () => {
    const reactions = new ReactionsVisuelles(rngFixe([0.5]));
    reactions.spawn({ x: 10, y: 10 }, "#00FFFF", 0.4, "points"); // pas de groupe
    expect(reactions.liste[0].groupe).toBeUndefined();
  });
});

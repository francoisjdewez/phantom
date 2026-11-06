// Tests de la RÉGION 1 — équilibrage tranché par le design
// + mémoire « à deux vitesses » (P0-3). Logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import { PEUR_PLANCHER_MIN } from "../src/core/attention.js";
import type { AttentionNode, Vec2 } from "../src/core/types.js";

const DT = 1 / 60;

/** Fait tourner la logique en regardant `regard` pendant `secondes`. */
function regarder(r: Region, regard: Vec2 | null, secondes: number): void {
  const frames = Math.round(secondes / DT);
  for (let i = 0; i < frames; i++) r.update(DT, regard);
}

/** Mesure le temps (s) pour amener un nœud précis à `cible`, en le regardant en continu. */
function tempsPourRaviver(r: Region, n: AttentionNode, cible: number): number {
  let t = 0;
  while (n.v < cible && t < 120) {
    r.update(DT, n.pos);
    t += DT;
  }
  return t;
}

/**
 * "Joueur automatique" réaliste : remplit À FOND le nœud le plus en retard (par
 * salves), puis nourrit le Cœur — comme un humain qui sécurise un nœud avant de
 * passer au suivant. Tourne jusqu'à la victoire ou l'épuisement du temps.
 */
function autoPlay(r: Region, maxSecondes = 240): number {
  let t = 0;
  while (!r.estVictorieuse() && t < maxSecondes) {
    // Un nœud secondaire qui a faibli sous .75 ? On le remonte à fond (.99) d'un coup.
    const enRetard = r.noeuds
      .filter((n) => n.v < 0.75)
      .sort((a, b) => a.v - b.v)[0];
    if (enRetard) {
      while (enRetard.v < 0.99 && t < maxSecondes) {
        r.update(DT, enRetard.pos);
        t += DT;
      }
    } else {
      // Tous les nœuds sont hauts → on nourrit le Cœur.
      r.update(DT, r.coeur.pos);
      t += DT;
    }
  }
  return t;
}

describe("Région 1 — L'Arbre des Piuws", () => {
  it("démarre NON éveillée et non victorieuse", () => {
    const r = new Region(region1);
    expect(r.eveillee).toBe(false);
    expect(r.estVictorieuse()).toBe(false);
  });

  it("sans aucun regard, la région ne s'éveille pas (le joueur est le moteur)", () => {
    const r = new Region(region1);
    regarder(r, null, 30);
    expect(r.eveillee).toBe(false);
  });

  it("ÉQUILIBRAGE : raviver un nœud est RÉACTIF (~3–9 s, rééq. 22/06 playtest)", () => {
    // Rééquilibrage 22/06 : la montée était trop lente au ressenti (gr 0.07→0.13) → on vise
    // un geste réactif (quelques secondes), pas un grind. Borne basse = ça reste un effort.
    for (const id of ["r1-maison"]) {
      const r = new Region(region1);
      const n = r.noeuds.find((x) => x.id === id)!;
      const t = tempsPourRaviver(r, n, region1.victoire.noeudMin);
      expect(t).toBeGreaterThanOrEqual(2);
      expect(t).toBeLessThanOrEqual(9);
    }
  });

  it("MÉMOIRE À 2 VITESSES : avant éveil la fleur peut mourir ; après éveil l'acquis est gravé", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;

    // Avant éveil : plancher bas → on l'ignore, elle décline (tutoriel/peur de perdre).
    regarder(r, null, 5);
    expect(monument.eveille).toBe(false);
    expect(monument.v).toBeLessThan(0.07); // elle a bel et bien décliné

    // On la ravive au-delà du seuil → premier éveil.
    regarder(r, monument.pos, 12);
    expect(monument.eveille).toBe(true);
    expect(monument.ancree).toBeGreaterThanOrEqual(0.45); // acquis gravé (le DRAPEAU reste)

    // Négligée un PEU (sous le délai de grâce) : elle tient à son plancher ancré.
    regarder(r, null, 20);
    expect(monument.v).toBeGreaterThanOrEqual(0.45);
  });

  it("PEUR DE PERDRE : un nœud éveillé puis LONGTEMPS négligé se rendort (mais ne meurt jamais)", () => {
    const r = new Region(region1);
    const monument = r.noeuds.find((n) => n.id === "r1-maison")!;

    // On l'éveille bien.
    regarder(r, monument.pos, 12);
    expect(monument.eveille).toBe(true);
    const vApresEveil = monument.v;

    // Négligence PROLONGÉE (bien au-delà du délai de grâce) : le plancher s'érode,
    // la fleur RE-DÉCLINE — l'enjeu de fin de partie revient.
    regarder(r, null, 90);
    expect(monument.v).toBeLessThan(vApresEveil); // elle a bel et bien re-décliné
    // … mais jamais sous le plancher minimum : elle se rendort, ne meurt pas.
    expect(monument.v).toBeGreaterThanOrEqual(PEUR_PLANCHER_MIN - 1e-6);
    // Le drapeau d'éveil, lui, reste acquis (c'est `v` qui baisse, pas l'Histoire).
    expect(monument.eveille).toBe(true);

    // On revient s'en occuper : elle remonte aussitôt (l'attention répare).
    const avantSoin = monument.v;
    regarder(r, monument.pos, 6);
    expect(monument.v).toBeGreaterThan(avantSoin);
  });

  it("en jouant (auto), la région S'ÉVEILLE dans une durée raisonnable", () => {
    const r = new Region(region1);
    const t = autoPlay(r);
    expect(r.estVictorieuse()).toBe(true);
    expect(r.eveillee).toBe(true);
    expect(t).toBeLessThan(240);
    // eslint-disable-next-line no-console
    console.log(`[INFO] R1 éveillée en ~${t.toFixed(0)} s (cible : 60–120 s)`);
  });

  it("une fois éveillée, le drapeau reste (verrou)", () => {
    const r = new Region(region1);
    autoPlay(r);
    expect(r.eveillee).toBe(true);
    regarder(r, null, 30);
    expect(r.eveillee).toBe(true);
  });
});

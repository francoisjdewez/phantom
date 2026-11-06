// Tests des CENDRES DU VIDE (comportement vivant, 2026-06-18).
// Grains sombres qui montent depuis la marée du Néant. Logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import {
  CendreSystem,
  CENDRE_MAX,
  CENDRE_SEUIL_NAISSANCE,
} from "../src/core/cendres.js";
import type { FoyerCendre } from "../src/core/cendres.js";

const DT = 1 / 60;
const SOL_Y = 180;
const H_MAREE = 100;
const LARGEUR = 320;

/** RNG déterministe minimal (suite cyclique) pour des tests reproductibles. */
function rngSeq(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

describe("Cendres — naissance", () => {
  it("ne naît JAMAIS quand le Néant est sous le seuil", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 600; i++) {
      sys.tick(DT, CENDRE_SEUIL_NAISSANCE - 0.01, SOL_Y, H_MAREE, LARGEUR);
    }
    expect(sys.liste.length).toBe(0);
  });

  it("naît quand le Néant domine (n élevé), dans la marée", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 120; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeGreaterThan(0);
    for (const c of sys.liste) {
      // Née dans la bande de la marée (entre le sol et le sommet de la marée), à peu près.
      expect(c.y).toBeLessThanOrEqual(SOL_Y + 1);
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThanOrEqual(LARGEUR);
    }
  });

  it("respecte le PLAFOND strict, même après un long abandon", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 6000; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeLessThanOrEqual(CENDRE_MAX);
  });
});

describe("Cendres — vie et mort", () => {
  it("monte vers le haut au fil du temps", () => {
    const sys = new CendreSystem(rngSeq([0.5]));
    // Quelques frames pour qu'au moins une cendre naisse (débit cadencé < 1/frame).
    for (let i = 0; i < 30; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeGreaterThan(0);
    const c = sys.liste[0];
    const y0 = c.y;
    for (let i = 0; i < 30; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    // la cendre suivie (toujours vivante car vie ~4.5s) est montée (y a diminué).
    expect(c.y).toBeLessThan(y0);
  });

  it("finit par mourir (vieillesse) → pool borné dans le temps", () => {
    const sys = new CendreSystem();
    // On laisse vivre, puis on coupe le Néant : plus de naissance, tout doit mourir.
    for (let i = 0; i < 120; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeGreaterThan(0);
    for (let i = 0; i < 600; i++) sys.tick(DT, 0, SOL_Y, H_MAREE, LARGEUR); // 10 s sans vide
    expect(sys.liste.length).toBe(0);
  });

  it("le fondu reste borné dans [0,1]", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 300; i++) {
      sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
      for (const c of sys.liste) {
        const f = CendreSystem.fade(c);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("clear() vide le pool", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 120; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeGreaterThan(0);
    sys.clear();
    expect(sys.liste.length).toBe(0);
  });
});

describe("Cendres — densification autour des FOYERS de détresse (visuel)", () => {
  const foyer: FoyerCendre = { pos: { x: 50, y: 120 }, det: 1 };

  it("choisirFoyer pondère par la détresse (le plus en détresse capte plus)", () => {
    const foyers: FoyerCendre[] = [
      { pos: { x: 0, y: 0 }, det: 0.1 },
      { pos: { x: 100, y: 0 }, det: 0.9 },
    ];
    // Tirage haut (0.99) tombe dans la grosse part (le 2e, det=0.9).
    expect(CendreSystem.choisirFoyer(foyers, 0.99)).toBe(foyers[1]);
    // Tirage très bas (0.0) tombe dans la 1re part.
    expect(CendreSystem.choisirFoyer(foyers, 0)).toBe(foyers[0]);
  });

  it("choisirFoyer reste sûr si toutes les détresses sont nulles", () => {
    const foyers: FoyerCendre[] = [
      { pos: { x: 0, y: 0 }, det: 0 },
      { pos: { x: 1, y: 1 }, det: 0 },
    ];
    expect(CendreSystem.choisirFoyer(foyers, 0.5)).toBe(foyers[0]);
  });

  it("avec un foyer, des cendres naissent À PROXIMITÉ (pas juste réparties au hasard)", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 200; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR, [foyer]);
    expect(sys.liste.length).toBeGreaterThan(0);
    // Au moins une cendre est née tout près du foyer (rayon ~12 px monde).
    const proche = sys.liste.some(
      (c) => Math.hypot(c.x - foyer.pos.x, c.y - foyer.pos.y) <= 14,
    );
    expect(proche).toBe(true);
  });

  it("les foyers NE CASSENT PAS le plafond global (on déplace, on ne cumule pas)", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 6000; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR, [foyer]);
    expect(sys.liste.length).toBeLessThanOrEqual(CENDRE_MAX);
  });

  it("sans foyer (paramètre omis), le comportement reste l'ancien (rétro-compat)", () => {
    const sys = new CendreSystem();
    for (let i = 0; i < 120; i++) sys.tick(DT, 1, SOL_Y, H_MAREE, LARGEUR);
    expect(sys.liste.length).toBeGreaterThan(0);
    expect(sys.liste.length).toBeLessThanOrEqual(CENDRE_MAX);
  });
});

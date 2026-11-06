// Test de la RÈGLE D'ILLUMINATION dans Region (Brique 2) — logique pure.
// Vérifie le cœur du nouveau game design : un élément ne grandit QUE si Phantom
// illumine ; la simple présence (proximité sans illumination) ne ravive plus rien.
import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";
import { PiuwPerdu } from "../src/core/introPiuw.js";
import { PiuwSystem } from "../src/core/piuws.js";

describe("Région — la croissance exige l'ILLUMINATION", () => {
  it("À PORTÉE mais SANS illuminer → le Cœur NE grandit PAS", () => {
    const region = new Region(region1);
    const surLeCoeur = { ...region.coeur.pos }; // regard pile sur le Cœur
    const vDepart = region.coeur.v;

    // 2 secondes de présence proche, mais SANS illuminer (illumine = false).
    for (let i = 0; i < 120; i++) region.update(1 / 60, surLeCoeur, false);

    expect(region.coeur.v).toBeLessThanOrEqual(vDepart); // n'a pas monté
  });

  it("À PORTÉE et EN illuminant → le Cœur grandit", () => {
    const region = new Region(region1);
    const surLeCoeur = { ...region.coeur.pos };
    const vDepart = region.coeur.v;

    // 2 secondes de présence proche EN illuminant (illumine = true).
    for (let i = 0; i < 120; i++) region.update(1 / 60, surLeCoeur, true);

    expect(region.coeur.v).toBeGreaterThan(vDepart); // a bien monté
  });

  it("LOIN du Cœur, même en illuminant → il ne grandit pas (hors de portée)", () => {
    const region = new Region(region1);
    const tresLoin = { x: 9999, y: 9999 };
    const vDepart = region.coeur.v;

    for (let i = 0; i < 120; i++) region.update(1 / 60, tresLoin, true);

    expect(region.coeur.v).toBeLessThanOrEqual(vDepart);
  });
});

describe("Piuw perdu — se réveille par ILLUMINATION, pas par présence seule", () => {
  const surLePiuw = { x: 0, y: 0 };
  const cible = { x: 100, y: 100 };

  it("proche SANS illuminer → reste perdu (la présence ne suffit pas)", () => {
    const piuw = new PiuwPerdu({ x: 0, y: 0 });
    for (let i = 0; i < 240; i++) piuw.update(1 / 60, surLePiuw, cible, false); // 4 s
    expect(piuw.etat).toBe("perdu");
    expect(piuw.sauveProgress).toBeLessThan(0.01);
  });

  it("proche ET en illuminant → il finit par être sauvé", () => {
    const piuw = new PiuwPerdu({ x: 0, y: 0 });
    for (let i = 0; i < 240; i++) piuw.update(1 / 60, surLePiuw, cible, true); // 4 s
    expect(piuw.etat).not.toBe("perdu"); // sauvé → guide → ...
  });
});

describe("Cortège — les Piuws s'accrochent à la lumière de Phantom", () => {
  it("Phantom illumine tout près → le Piuw s'accroche (suit = true)", () => {
    const sys = new PiuwSystem(() => 0.5);
    sys.naitre({ x: 0, y: 0 }, 1, "esperer");
    const p = sys.liste[0];
    for (let i = 0; i < 30; i++)
      sys.update(1 / 60, [], undefined, { pos: { x: 5, y: 0 }, illumine: true });
    expect(p.suit).toBe(true);
  });

  it("Phantom proche mais N'illumine PAS → le Piuw ne s'accroche pas", () => {
    const sys = new PiuwSystem(() => 0.5);
    sys.naitre({ x: 0, y: 0 }, 1, "esperer");
    const p = sys.liste[0];
    for (let i = 0; i < 30; i++)
      sys.update(1 / 60, [], undefined, { pos: { x: 5, y: 0 }, illumine: false });
    expect(p.suit).toBe(false);
  });
});

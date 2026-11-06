// Tests de la LUMIÈRE de Phantom (core/phantom.ts) — logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import {
  Phantom,
  LUMIERE_DEPART,
  COUT_ILLUMINATION,
  RECHARGE_PRES_DU_VIVANT,
} from "../src/core/phantom.js";

describe("Phantom — réserve de lumière", () => {
  it("démarre PLEIN (lumiere = 1)", () => {
    expect(new Phantom().lumiere).toBe(LUMIERE_DEPART);
  });

  it("illuminer DÉPENSE de la lumière et renvoie illumineActif=true", () => {
    const p = new Phantom();
    const actif = p.update(1, true, 0); // illumine 1 s, peu importe la vie autour
    expect(actif).toBe(true);
    expect(p.lumiere).toBeCloseTo(1 - COUT_ILLUMINATION); // 1 - 0.15 = 0.85
  });

  it("la lumière se dépense MÊME dans le vide (rien à portée)", () => {
    const p = new Phantom();
    p.update(1, true, 0);
    expect(p.lumiere).toBeLessThan(1);
  });

  it("NE PAS illuminer + vivant proche → RECHARGE", () => {
    const p = new Phantom();
    p.lumiere = 0.3;
    p.update(1, false, 1); // au repos, entouré de vie (vieProche=1)
    expect(p.lumiere).toBeCloseTo(0.3 + RECHARGE_PRES_DU_VIVANT); // 0.3 + 0.6 = 0.9
  });

  it("illuminer PRÈS du vivant NE VIDE PAS (la vie nourrit même en illuminant)", () => {
    const p = new Phantom();
    p.lumiere = 0.5;
    const actif = p.update(1, true, 0.5); // illumine un élément à demi-vivant
    expect(actif).toBe(true);
    // recharge (0.6×0.5=0.3) > coût (0.08) → la réserve MONTE même en illuminant.
    expect(p.lumiere).toBeGreaterThan(0.5);
  });

  it("NE PAS illuminer mais RIEN de vivant proche → aucune recharge", () => {
    const p = new Phantom();
    p.lumiere = 0.5;
    p.update(1, false, 0); // vieProche = 0
    expect(p.lumiere).toBe(0.5);
  });

  it("réserve VIDE : on a beau demander, illumineActif=false (faut se recharger)", () => {
    const p = new Phantom();
    p.lumiere = 0;
    const actif = p.update(1, true, 0);
    expect(actif).toBe(false);
    expect(p.lumiere).toBe(0); // on est tombé dans la recharge (mais vieProche=0 → reste 0)
  });

  it("la lumière reste TOUJOURS bornée dans [0,1]", () => {
    const p = new Phantom();
    // Recharge énorme : ne dépasse jamais 1.
    p.lumiere = 0.95;
    p.update(1, false, 1);
    expect(p.lumiere).toBeLessThanOrEqual(1);
    // Dépense énorme : ne descend jamais sous 0.
    p.lumiere = 0.05;
    p.update(1, true, 0);
    expect(p.lumiere).toBeGreaterThanOrEqual(0);
  });
});

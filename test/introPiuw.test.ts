// Tests de la première scène : le Piuw perdu (machine à états, logique pure).
import { describe, it, expect } from "vitest";
import { PiuwPerdu, PLAINTES, JOIES } from "../src/core/introPiuw.js";

function rngFixe(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

const DT = 1 / 60;
const DEPART = { x: 160, y: 64 };
const FLEUR = { x: 200, y: 144 };

describe("PiuwPerdu (première scène)", () => {
  it("démarre PERDU et plaintif", () => {
    const pp = new PiuwPerdu({ ...DEPART }, rngFixe([0.5]));
    expect(pp.etat).toBe("perdu");
    expect(pp.sauveProgress).toBe(0);
  });

  it("le REGARD le sauve (perdu → sauvé)", () => {
    const pp = new PiuwPerdu({ ...DEPART }, rngFixe([0.5]));
    // On le regarde (regard ≈ sa position) pendant ~2,4 s (> temps de sauvetage).
    for (let i = 0; i < 60 * 2.4; i++) pp.update(DT, { ...DEPART }, FLEUR);
    expect(pp.sauveProgress).toBe(1);
    expect(pp.etat).not.toBe("perdu");
  });

  it("délaissé, le sauvetage RETOMBE (il re-meurt un peu)", () => {
    const pp = new PiuwPerdu({ ...DEPART }, rngFixe([0.5]));
    for (let i = 0; i < 30; i++) pp.update(DT, { ...DEPART }, FLEUR); // un peu de regard
    const avant = pp.sauveProgress;
    expect(avant).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) pp.update(DT, null, FLEUR); // on détourne le regard
    expect(pp.sauveProgress).toBeLessThan(avant);
  });

  it("une fois sauvé, il devient COMPAGNON : suit Phantom, et guide quand le joueur hésite", () => {
    const pp = new PiuwPerdu({ ...DEPART }, rngFixe([0.5]));
    for (let i = 0; i < 60 * 2.4; i++) pp.update(DT, { ...DEPART }, FLEUR); // sauvetage
    expect(pp.etat).not.toBe("perdu");

    // 1) SUIT Phantom : le joueur BOUGE (pas d'hésitation) → le Piuw se tient PRÈS de lui.
    const PH = { x: 50, y: 50 };
    for (let i = 0; i < 60 * 4; i++) pp.update(DT, { ...PH }, FLEUR, true, false);
    expect(Math.hypot(pp.pos.x - PH.x, pp.pos.y - PH.y)).toBeLessThan(30);

    // 2) GUIDE à l'hésitation : joueur immobile + cible loin → le Piuw DÉRIVE vers la cible.
    const CIBLE = { x: PH.x + 100, y: PH.y }; // prochaine chose à raviver, à droite
    for (let i = 0; i < 60 * 4; i++) pp.update(DT, { ...PH }, CIBLE, true, true);
    expect(pp.pos.x).toBeGreaterThan(PH.x + 10); // il s'est avancé DU CÔTÉ de la cible
  });

  it("parle en onomatopées connues (plaintes ou joies)", () => {
    const pp = new PiuwPerdu({ ...DEPART }, rngFixe([0.0]));
    const tous = [...PLAINTES, ...JOIES];
    let aParle = false;
    for (let i = 0; i < 60 * 4; i++) {
      pp.update(DT, { ...DEPART }, FLEUR);
      if (pp.mot) {
        aParle = true;
        expect(tous).toContain(pp.mot as (typeof tous)[number]);
      }
    }
    expect(aParle).toBe(true);
  });
});

// Tests du FIL DU JEU (core/flux.ts) — PHASE 2 « MONDE CONTINU ».
//   Le swap R1→R2 par écran a disparu : les deux régions coexistent dans une seule
//   scène. Le fil se réduit à : titre → on JOUE le monde → victoire finale → (rejouer).
// Logique 100 % pure (aucun DOM, aucun Three.js) → testable directement.
import { describe, it, expect } from "vitest";
import { Flux } from "../src/core/flux.js";
import { region1 } from "../src/regions/region1.js";
import { region2 } from "../src/regions/region2.js";

describe("Flux — le fil du jeu (monde continu)", () => {
  it("démarre sur l'écran-titre, avec les deux régions du monde", () => {
    const f = new Flux();
    expect(f.etape).toBe("titre");
    expect(f.nbRegions).toBe(2);
    // Les deux régions du monde sont exposées dans l'ordre A puis B.
    expect(f.regions.map((r) => r.id)).toEqual([region1.id, region2.id]);
  });

  it("titre → on commence → on joue le monde continu", () => {
    const f = new Flux();
    f.commencer();
    expect(f.etape).toBe("region");
  });

  it("les DEUX zones éveillées → VICTOIRE FINALE", () => {
    const f = new Flux();
    f.commencer();
    f.mondeEveille();   // main3d ne l'appelle que quand les 2 drapeaux sont latchés
    expect(f.etape).toBe("victoire-finale");
  });

  it("victoire finale → on rejoue → retour au titre", () => {
    const f = new Flux();
    f.commencer();
    f.mondeEveille();
    f.rejouer();
    expect(f.etape).toBe("titre");
  });

  it("les transitions HORS-contexte sont ignorées (machine robuste)", () => {
    const f = new Flux();
    // Sur le titre : rejouer / mondeEveille ne doivent RIEN faire.
    f.rejouer();
    f.mondeEveille();
    expect(f.etape).toBe("titre");

    // En jeu : commencer ne doit rien refaire.
    f.commencer();
    f.commencer();
    expect(f.etape).toBe("region");

    // Pendant le jeu, rejouer ne fait rien (on n'est pas en victoire finale).
    f.rejouer();
    expect(f.etape).toBe("region");
  });

  it("le cycle complet : titre → jeu → fin → titre", () => {
    const f = new Flux();
    const ordre: string[] = [f.etape];
    f.commencer();      ordre.push(f.etape);
    f.mondeEveille();   ordre.push(f.etape);
    f.rejouer();        ordre.push(f.etape);
    expect(ordre).toEqual(["titre", "region", "victoire-finale", "titre"]);
  });
});

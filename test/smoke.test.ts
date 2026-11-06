// Test de fumée — le "détecteur d'écran noir".
// Fait tourner 60 frames de la LOGIQUE de la Région 1, sans navigateur.
// S'il passe, le cerveau du jeu tient debout.

import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region1 } from "../src/regions/region1.js";

describe("socle PHANTOM — test de fumée", () => {
  it("la logique de la Région 1 tourne 60 frames sans planter", () => {
    const r = new Region(region1);
    const regard = { x: 285, y: 144 }; // on regarde vers le monument
    expect(() => {
      for (let i = 0; i < 60; i++) r.update(1 / 60, regard);
    }).not.toThrow();

    // Le monde est cohérent après coup.
    expect(r.tousLesNoeuds()).toHaveLength(2); // Cœur + 1 nœud (fleur+cristal retirés)
    for (const n of r.tousLesNoeuds()) {
      expect(n.v).toBeGreaterThanOrEqual(0);
      expect(n.v).toBeLessThanOrEqual(1);
    }
  });
});

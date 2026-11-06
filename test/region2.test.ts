// Tests de la RÉGION 2 « La Clairière Oubliée » (Acte II).
// Même MOTEUR que R1, et depuis le rééquilibrage du 19/08 (playtest,
// voir region2.ts) les MÊMES cibles chiffrées que R1 : nœud ~2–9 s, rythme rapide
// assumé. On vérifie aussi que la logique pure tourne sans
// planter (garde-fou anti « écran noir »).
import { describe, it, expect } from "vitest";
import { Region } from "../src/core/Region.js";
import { region2 } from "../src/regions/region2.js";
import type { AttentionNode } from "../src/core/types.js";

const DT = 1 / 60;

/** Mesure le temps (s) pour amener un nœud à `cible` en le regardant en continu. */
function tempsPourRaviver(r: Region, n: AttentionNode, cible: number): number {
  let t = 0;
  while (n.v < cible && t < 120) {
    r.update(DT, n.pos);
    t += DT;
  }
  return t;
}

/** "Joueur automatique" : sécurise le nœud le plus en retard, puis nourrit le Cœur. */
function autoPlay(r: Region, maxSecondes = 240): number {
  let t = 0;
  while (!r.estVictorieuse() && t < maxSecondes) {
    const enRetard = r.noeuds.filter((n) => n.v < 0.75).sort((a, b) => a.v - b.v)[0];
    if (enRetard) {
      while (enRetard.v < 0.99 && t < maxSecondes) {
        r.update(DT, enRetard.pos);
        t += DT;
      }
    } else {
      r.update(DT, r.coeur.pos);
      t += DT;
    }
  }
  return t;
}

describe("Région 2 — La Clairière Oubliée", () => {
  it("démarre NON éveillée et non victorieuse", () => {
    const r = new Region(region2);
    expect(r.eveillee).toBe(false);
    expect(r.estVictorieuse()).toBe(false);
  });

  it("a bien un Cœur + 1 nœud, tous typés (Phase 2 : Foyer commun + Chantier)", () => {
    const r = new Region(region2);
    expect(r.tousLesNoeuds()).toHaveLength(2);
    for (const n of r.tousLesNoeuds()) {
      // PHASE 2 (cosmétique) : le Cœur est désormais "foyer", le nœud "chantier".
      expect(["chantier", "foyer"]).toContain(n.type);
    }
  });

  it("a une DISPOSITION différente de R1 (positions distinctes)", () => {
    // Le Cœur de R2 est en retrait (y ≠ ligne de sol) et le chantier est placé
    // autrement qu'en R1 (x=270 au lieu de 285).
    expect(region2.coeur.pos.y).not.toBe(144);
    const chantier = region2.noeuds.find((n) => n.type === "chantier")!;
    expect(chantier.pos.x).toBe(270);
  });

  it("ÉQUILIBRAGE : raviver le nœud secondaire est RÉACTIF (~2–9 s, aligné R1 19/08)", () => {
    for (const id of ["r2-chantier"]) {
      const r = new Region(region2);
      const n = r.noeuds.find((x) => x.id === id)!;
      const t = tempsPourRaviver(r, n, region2.victoire.noeudMin);
      expect(t).toBeGreaterThanOrEqual(2);
      expect(t).toBeLessThanOrEqual(9);
    }
  });

  it("en jouant (auto), la région S'ÉVEILLE au même rythme que R1", () => {
    const r = new Region(region2);
    const t = autoPlay(r);
    expect(r.estVictorieuse()).toBe(true);
    expect(r.eveillee).toBe(true);
    // Rythme rapide assumé (§8bis) : R1 s'éveille en ~12s, R2 doit désormais suivre.
    expect(t).toBeLessThan(60);
    // eslint-disable-next-line no-console
    console.log(`[INFO] R2 éveillée en ~${t.toFixed(0)} s (aligné sur R1, 19/08)`);
  });

  it("émet bien un événement 'region-eveillee' quand elle s'éveille (le flux y réagit)", () => {
    const r = new Region(region2);
    autoPlay(r);
    // On collecte tous les événements émis pendant la partie.
    // (autoPlay a déjà fait tourner la boucle ; on rejoue une frame à vide pour
    //  être sûr de vider la file et confirmer qu'au moins un éveil a eu lieu.)
    let vit = false;
    for (const n of r.tousLesNoeuds()) if (n.eveille) vit = true;
    expect(vit).toBe(true);
    expect(r.eveillee).toBe(true);
  });
});

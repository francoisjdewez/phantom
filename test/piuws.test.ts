// Tests des PIUWS — naissance, vol, parole, mort, et le rêve porté.
// On injecte un RNG déterministe pour des résultats reproductibles.
import { describe, it, expect } from "vitest";
import { PiuwSystem, ONOMATOPEES } from "../src/core/piuws.js";
import type { AttentionNode, Vec2 } from "../src/core/types.js";

/** Fabrique un nœud de test minimal (champs neutres pour ceux non testés ici). */
function noeud(pos: Vec2, v: number): AttentionNode {
  return {
    id: "n",
    type: "flower",
    pos,
    v,
    attR: 30,
    gr: 0.06,
    dc: 0.02,
    ancree: 0.02,
    ancreeApresEveil: 0.45,
    eveille: v >= 0.6,
    reve: "esperer",
  };
}

/** RNG déterministe : renvoie toujours la même séquence. */
function rngFixe(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

describe("PiuwSystem", () => {
  it("naitre() crée le bon nombre de Piuws portant le bon rêve", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    sys.naitre({ x: 100, y: 50 }, 5, "se-souvenir");
    expect(sys.liste).toHaveLength(5);
    expect(sys.liste.every((p) => p.reve === "se-souvenir")).toBe(true);
  });

  it("respecte le plafond de population (max)", () => {
    const sys = new PiuwSystem(rngFixe([0.5]), 8);
    sys.naitre({ x: 0, y: 0 }, 20, "esperer");
    expect(sys.liste).toHaveLength(8);
  });

  it("sans nœud, les Piuws montent (flottaison) au fil du temps", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    sys.naitre({ x: 100, y: 100 }, 1, "esperer");
    const yDepart = sys.liste[0].pos.y;
    for (let i = 0; i < 120; i++) sys.update(1 / 60); // ~2 s, aucun nœud
    expect(sys.liste[0].pos.y).toBeLessThan(yDepart); // y plus petit = plus haut
  });

  it("un Piuw finit par parler, et toujours en onomatopée connue", () => {
    const sys = new PiuwSystem(rngFixe([0.0])); // prochainMot minimal + 1er mot
    sys.naitre({ x: 0, y: 500 }, 1, "transmettre");
    let aParle = false;
    for (let i = 0; i < 120; i++) {
      sys.update(1 / 60);
      const m = sys.liste[0]?.mot;
      if (m) {
        aParle = true;
        expect(ONOMATOPEES).toContain(m as (typeof ONOMATOPEES)[number]);
      }
    }
    expect(aParle).toBe(true);
  });

  it("un Piuw finit par MOURIR (anti-fuite mémoire) — retiré quand trop vieux", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    sys.naitre({ x: 0, y: 500 }, 1, "comprendre"); // vie = 9 + 0.5*4 = 11 s
    for (let i = 0; i < 60 * 13; i++) sys.update(1 / 60); // ~13 s > vie
    expect(sys.liste).toHaveLength(0);
  });

  it("le vol ERRE : un Piuw sans nœud ne monte pas en ligne droite (dérive en x)", () => {
    // Avec un RNG varié, chaque Piuw reçoit une phase/fréquence d'errance propre :
    // sa position x doit s'écarter de son point de naissance (vagabondage), pas
    // rester pile à la verticale comme un vol robotique.
    const sys = new PiuwSystem(rngFixe([0.1, 0.9, 0.3, 0.7, 0.5]));
    sys.naitre({ x: 100, y: 100 }, 1, "esperer");
    const xDepart = sys.liste[0].pos.x;
    let ecartMax = 0;
    for (let i = 0; i < 180; i++) {
      sys.update(1 / 60); // ~3 s, aucun nœud
      if (sys.liste[0]) {
        ecartMax = Math.max(ecartMax, Math.abs(sys.liste[0].pos.x - xDepart));
      }
    }
    expect(ecartMax).toBeGreaterThan(1); // il a vraiment vagabondé en x
  });

  it("ORBITE : près d'un nœud vivant, le Piuw tournoie autour sans s'y écraser", () => {
    // On place un Piuw juste à côté d'un nœud bien vivant : il doit rester dans le
    // voisinage (capté) tout en bougeant autour (l'angle vu depuis le nœud change),
    // au lieu de converger pile sur le centre et de s'y figer.
    const sys = new PiuwSystem(rngFixe([0.5, 0.2, 0.8, 0.4]));
    const n = noeud({ x: 200, y: 200 }, 0.9);
    sys.naitre({ x: 214, y: 200 }, 1, "esperer"); // ~14 u du nœud
    const p = sys.liste[0];

    const dist = () => Math.hypot(p.pos.x - n.pos.x, p.pos.y - n.pos.y);
    const angle = () => Math.atan2(p.pos.y - n.pos.y, p.pos.x - n.pos.x);

    const a0 = angle();
    let angleBouge = false;
    let resteProche = true;
    for (let i = 0; i < 240; i++) {
      sys.update(1 / 60, [n]); // ~4 s autour du nœud
      if (Math.abs(angle() - a0) > 0.3) angleBouge = true;
      if (dist() > 40) resteProche = false; // ne s'évade pas
    }
    expect(angleBouge).toBe(true); // il a bien tourné autour (orbite)
    expect(resteProche).toBe(true); // il est resté capté par le nœud
  });

  it("opacite() fait un fondu d'entrée de 0 vers 1", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    sys.naitre({ x: 0, y: 0 }, 1, "esperer");
    const p = sys.liste[0];
    expect(PiuwSystem.opacite(p)).toBeCloseTo(0, 1); // age 0 → invisible
    p.age = 1;
    expect(PiuwSystem.opacite(p)).toBe(1); // bien après → pleinement visible
  });
});

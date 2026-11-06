// Tests du système « les Piuws portent un rêve » (émergence / autonomie).
// Garde-fou clé : les Piuws SOUTIENNENT mais n'ÉVEILLENT jamais seuls (joueur = moteur).
import { describe, it, expect } from "vitest";
import {
  PiuwSystem,
  PIUW_PLAFOND_SOIN,
  CARACTERE_REVE,
  ONOMATOPEES,
} from "../src/core/piuws.js";
import type { AttentionNode, Reve } from "../src/core/types.js";

/** Les 8 rêves fondateurs. */
const TOUS_LES_REVES: Reve[] = [
  "sauver",
  "creer",
  "explorer",
  "esperer",
  "proteger",
  "comprendre",
  "transmettre",
  "se-souvenir",
];

function rngFixe(valeurs: number[]): () => number {
  let i = 0;
  return () => valeurs[i++ % valeurs.length];
}

/** Un nœud de test minimal. */
function noeud(over: Partial<AttentionNode> = {}): AttentionNode {
  return {
    id: "n",
    type: "flower",
    pos: { x: 100, y: 100 },
    v: 0.5,
    attR: 34,
    gr: 0.06,
    dc: 0.05,
    ancree: 0.45,
    ancreeApresEveil: 0.45,
    eveille: true,
    reve: "esperer",
    ...over,
  };
}

const SEUIL_EVEIL = 0.6; // = victoire.noeudMin de R1

describe("Piuws ↔ Rêves (émergence/autonomie)", () => {
  it("les Piuws SOUTIENNENT un nœud mais ne dépassent JAMAIS le plafond (< seuil d'éveil)", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    const n = noeud({ v: 0.5 });
    sys.naitre(n.pos, 10, n.reve); // une grappe de Piuws sur le nœud
    // 20 s de soutien (sans aucun regard du joueur, sans decay : on isole l'effet Piuw).
    for (let i = 0; i < 60 * 20; i++) sys.update(1 / 60, [n]);

    expect(n.v).toBeLessThanOrEqual(PIUW_PLAFOND_SOIN + 1e-6); // jamais au-delà du plafond
    expect(n.v).toBeLessThan(SEUIL_EVEIL); // donc JAMAIS éveillé par les seuls Piuws
    expect(n.v).toBeGreaterThanOrEqual(0.5); // mais bien maintenu (le rêve sustente)
  });

  it("le JOUEUR reste le moteur : même noyé de Piuws, un nœud sous le seuil ne s'éveille pas", () => {
    const sys = new PiuwSystem(rngFixe([0.5]), 40);
    const n = noeud({ v: 0.59 }); // tout proche du seuil 0.6
    sys.naitre(n.pos, 40, n.reve);
    for (let i = 0; i < 60 * 15; i++) sys.update(1 / 60, [n]);
    expect(n.v).toBeLessThan(SEUIL_EVEIL); // les Piuws ne franchissent pas le dernier pas
  });

  it("AUTONOMIE : un nœud éveillé produit de lui-même des Piuws au fil du temps", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    const n = noeud({ v: 0.7, eveille: true }); // vivant et éveillé, aucun Piuw au départ
    expect(sys.liste).toHaveLength(0);
    for (let i = 0; i < 60 * 7; i++) sys.update(1 / 60, [n]); // > intervalle de production
    expect(sys.liste.length).toBeGreaterThan(0); // la région vit toute seule
  });

  it("un nœud ÉTEINT (non éveillé) ne produit aucun Piuw seul", () => {
    const sys = new PiuwSystem(rngFixe([0.5]));
    const n = noeud({ v: 0.1, eveille: false });
    for (let i = 0; i < 60 * 7; i++) sys.update(1 / 60, [n]);
    expect(sys.liste).toHaveLength(0);
  });
});

describe("Variété des Piuws : 8 rêves, 8 caractères", () => {
  it("les 8 rêves fondateurs ont chacun un caractère défini", () => {
    for (const reve of TOUS_LES_REVES) {
      const car = CARACTERE_REVE[reve];
      expect(car).toBeDefined();
      expect(car.wanderMul).toBeGreaterThan(0);
      expect(car.orbiteMul).toBeGreaterThan(0);
      expect(car.onomatopees.length).toBeGreaterThan(0);
    }
  });

  it("le caractère du rêve module la NERVOSITÉ du vol (wanderFreq hérite de wanderMul)", () => {
    // Même RNG → seul le rêve change. L'Explorateur (wanderMul 1.5) doit errer
    // PLUS vite que la Mémoire (wanderMul 0.6) : la fréquence d'errance le reflète.
    const sysExpl = new PiuwSystem(rngFixe([0.5]));
    const sysMem = new PiuwSystem(rngFixe([0.5]));
    sysExpl.naitre({ x: 0, y: 0 }, 1, "explorer");
    sysMem.naitre({ x: 0, y: 0 }, 1, "se-souvenir");
    expect(sysExpl.liste[0].wanderFreq).toBeGreaterThan(sysMem.liste[0].wanderFreq);
    // Et le multiplicateur d'orbite est bien hérité du caractère.
    expect(sysExpl.liste[0].orbiteMul).toBe(CARACTERE_REVE.explorer.orbiteMul);
    expect(sysMem.liste[0].orbiteMul).toBe(CARACTERE_REVE["se-souvenir"].orbiteMul);
  });

  it("la parole reste TOUJOURS une onomatopée connue (commune OU accent du rêve)", () => {
    // On force le 2e bras du tirage (rng ≥ 0.5) pour piocher dans l'accent du rêve,
    // et on vérifie que le mot prononcé appartient bien au vocabulaire autorisé.
    for (const reve of TOUS_LES_REVES) {
      const sys = new PiuwSystem(rngFixe([0.75])); // tirage parole = 0.75 → accent
      sys.naitre({ x: 0, y: 500 }, 1, reve);
      const vocab = new Set<string>([...ONOMATOPEES, ...CARACTERE_REVE[reve].onomatopees]);
      let aParle = false;
      for (let i = 0; i < 600; i++) {
        sys.update(1 / 60);
        const m = sys.liste[0]?.mot;
        if (m) {
          aParle = true;
          expect(vocab.has(m)).toBe(true);
        }
      }
      expect(aParle).toBe(true);
    }
  });
});

// Tests de la PROPAGATION nœud → nœud (comportement vivant, 2026-06-18).
// « La vie appelle la vie » : un nœud éveillé et haut contamine ses voisins.
// Logique pure, sans navigateur.
import { describe, it, expect } from "vitest";
import {
  propagerAttention,
  PROPAGATION_RAYON,
  PROPAGATION_SEUIL_EMETTEUR,
  PROPAGATION_PULSE_PERIODE,
} from "../src/core/propagation.js";
import type { AttentionNode, Vec2 } from "../src/core/types.js";

const DT = 1 / 60;

/** Fabrique un nœud de test minimal (les champs non testés ont des valeurs neutres). */
function noeud(pos: Vec2, v: number, eveille: boolean): AttentionNode {
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
    eveille,
    reve: "esperer",
  };
}

describe("Propagation nœud → nœud", () => {
  it("un nœud éveillé et HAUT fait monter un voisin proche (sans aucun regard)", () => {
    const emetteur = noeud({ x: 0, y: 0 }, 1, true);
    const voisin = noeud({ x: 30, y: 0 }, 0.2, false); // dans le rayon
    const vAvant = voisin.v;
    // 1 seconde de propagation (60 frames)
    for (let i = 0; i < 60; i++) propagerAttention([emetteur, voisin], DT);
    expect(voisin.v).toBeGreaterThan(vAvant);
  });

  it("un nœud NON éveillé ne propage rien (le joueur reste le moteur du 1er éveil)", () => {
    const emetteur = noeud({ x: 0, y: 0 }, 1, false); // haut mais PAS éveillé
    const voisin = noeud({ x: 30, y: 0 }, 0.2, false);
    const vAvant = voisin.v;
    for (let i = 0; i < 60; i++) propagerAttention([emetteur, voisin], DT);
    expect(voisin.v).toBe(vAvant);
  });

  it("un nœud éveillé mais SOUS le seuil émetteur ne propage pas", () => {
    const faible = noeud({ x: 0, y: 0 }, PROPAGATION_SEUIL_EMETTEUR - 0.05, true);
    const voisin = noeud({ x: 30, y: 0 }, 0.2, false);
    const vAvant = voisin.v;
    for (let i = 0; i < 60; i++) propagerAttention([faible, voisin], DT);
    expect(voisin.v).toBe(vAvant);
  });

  it("au-delà du rayon, aucune contamination", () => {
    const emetteur = noeud({ x: 0, y: 0 }, 1, true);
    const loin = noeud({ x: PROPAGATION_RAYON + 10, y: 0 }, 0.2, false);
    const vAvant = loin.v;
    for (let i = 0; i < 60; i++) propagerAttention([emetteur, loin], DT);
    expect(loin.v).toBe(vAvant);
  });

  it("la contamination ne dépasse jamais 1 (clamp respecté)", () => {
    const emetteur = noeud({ x: 0, y: 0 }, 1, true);
    const presquePlein = noeud({ x: 10, y: 0 }, 0.999, true);
    for (let i = 0; i < 600; i++) propagerAttention([emetteur, presquePlein], DT);
    expect(presquePlein.v).toBeLessThanOrEqual(1);
  });

  it("plus le voisin est proche, plus il reçoit (proximité linéaire)", () => {
    const emetteur = noeud({ x: 0, y: 0 }, 1, true);
    const proche = noeud({ x: 20, y: 0 }, 0.2, false);
    const eloigne = noeud({ x: 90, y: 0 }, 0.2, false); // encore dans le rayon, mais plus loin
    for (let i = 0; i < 60; i++) propagerAttention([emetteur, proche, eloigne], DT);
    expect(proche.v).toBeGreaterThan(eloigne.v);
  });

  it("le flux RESPIRE : le gain instantané varie selon le temps t", () => {
    // À un même instant initial, deux passes au quart et aux trois-quarts de la
    // période donnent des gains différents (le débit pulse), alors que l'ancien
    // débit plat les rendrait identiques.
    function gainSur1Frame(t: number): number {
      const emetteur = noeud({ x: 0, y: 0 }, 1, true);
      const voisin = noeud({ x: 20, y: 0 }, 0.2, false);
      propagerAttention([emetteur, voisin], DT, t);
      return voisin.v - 0.2;
    }
    const gA = gainSur1Frame(PROPAGATION_PULSE_PERIODE * 0.25);
    const gB = gainSur1Frame(PROPAGATION_PULSE_PERIODE * 0.75);
    expect(Math.abs(gA - gB)).toBeGreaterThan(1e-6); // ça pulse vraiment
  });

  it("la pulsation ne change PAS le débit moyen (équilibrage préservé)", () => {
    // Intégré sur un nombre entier de périodes, le total avec respiration doit
    // égaler le total sans respiration (t omis) : la moyenne de la pulsation = 1.
    function totalSurUnePeriode(avecTemps: boolean): number {
      const emetteur = noeud({ x: 0, y: 0 }, 1, true);
      const voisin = noeud({ x: 20, y: 0 }, 0.2, false);
      const pas = 600; // 600 frames de DT couvrent largement une période
      let t = 0;
      for (let i = 0; i < pas; i++) {
        if (avecTemps) propagerAttention([emetteur, voisin], DT, t);
        else propagerAttention([emetteur, voisin], DT);
        t += DT;
      }
      return voisin.v - 0.2;
    }
    // On choisit une durée multiple de la période pour que l'intégrale du sinus
    // s'annule. 600 frames @ 1/60 = 10 s ; PERIODE = 2.4 s → 10/2.4 n'est pas
    // entier, donc on compare sur une tolérance lâche (le but : pas de DÉRIVE
    // systématique du total à cause de la pulsation).
    const avec = totalSurUnePeriode(true);
    const sans = totalSurUnePeriode(false);
    expect(avec).toBeCloseTo(sans, 2); // même ordre de grandeur, pas de biais
  });
});

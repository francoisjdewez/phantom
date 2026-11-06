// ════════════════════════════════════════════════════════════════════════
//  render3d/Renderer3D.ts — LES « YEUX » 3D du jeu (Three.js).
//  Ne contient AUCUNE logique de jeu : il reçoit l'état (les nœuds, leur vie)
//  et le dessine en volume.
//  Le « cerveau » (src/core) ne sait même pas que ce fichier existe.
// ════════════════════════════════════════════════════════════════════════

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
// Post-traitement (fourni par Three.js, aucune dépendance externe) : la couche
// « cinéma » par-dessus l'image — bloom (lumières qui débordent), tone mapping,
// étalonnage des couleurs et vignette.
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { HueSaturationShader } from "three/addons/shaders/HueSaturationShader.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import type { AttentionNode, NodeType, Reve, Vec2 } from "../core/types.js";
import { PiuwSystem, type Piuw } from "../core/piuws.js";
import { DoublesSystem, type DoubleAttention } from "../core/doubles.js";
import type { PiuwPerdu } from "../core/introPiuw.js";
import { neantFremissement, detresseLocale, oscillationPiece, trouVide } from "../core/neant.js";

// Repère monde 2D du jeu : 320×180, sol à y=144 (cf. region1.ts).
// On le projette dans la 3D : x → gauche/droite, y → profondeur. ECH = zoom.
const ECH = 28;
const TAU = Math.PI * 2;
// PHASE 2 « MONDE CONTINU » : les deux régions coexistent dans UNE scène, décalées sur X.
//   DX = demi-écart entre les centres des deux îles. Zone A (R1) à -DX, zone B (R2) à +DX.
//   Réglé pour une GORGE visible entre les bords des plateaux (cf. RPLAT_2 ci-dessous).
const DX = 16;                 // centre A en x=-16, centre B en x=+16 (écart total 32)
// ORIENTATION « vue de face » (chantier UX 3) : la caméra regarde désormais vers +x (depuis
// −x). Les modèles ont leur « face » par défaut vers +z (conçus pour l'ancienne vue de côté).
// Pour qu'ils nous fassent FACE (face vers −x, vers la caméra), on les pivote de −90° en Y.
// (Phantom, lui, fait l'inverse : +90° → il avance vers +x, on voit son dos.)
const ORIENT_VERS_CAMERA = -Math.PI / 2;
// « LA ROUE DES RÊVES » (zone B) : rayon où sont posés les recoins-biomes autour du
// centre du ZURG. Choisi pour rester DANS le plateau marchable (R_MARCHE=RPLAT_2=11),
// loin des éléments centraux (Phare + Chantier) → on y accède à pied, sans tomber.
const R_RECOIN = 7.5;
// Îles un peu plus petites qu'avant (RPLAT 13→11, RBORD 17.5→14.5) pour laisser une vraie
// gorge entre elles : bords intérieurs à ~ -16+14.5 = -1.5 et +16-14.5 = +1.5 → gorge ~3.
// (avec la chute des bords, le « marchable » s'arrête plus tôt → gorge ressentie ~6-8).
const RPLAT_2 = 11;
const RBORD_2 = 14.5;
// Projection monde 2D → 3D, AVEC décalage de zone `dx` sur X (0 = ancien comportement).
function mondeVers3D(p: Vec2, hauteur = 0, dx = 0): THREE.Vector3 {
  return new THREE.Vector3((p.x - 160) / ECH + dx, hauteur, (p.y - 144) / ECH);
}
// Équivalent JS de smoothstep(a,b,x) du GLSL (transition douce 0→1 entre a et b).
function smoothstep5(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ── BOÎTE À OUTILS « style toon » (aplats + contour sombre #1A1D33) ──────────
function rampe(couleurs: string[]): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = couleurs.length; c.height = 1;
  const ctx = c.getContext("2d")!;
  couleurs.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(i, 0, 1, 1); });
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  return tex;
}
function toon(base: number, ombre: string, moyen: string, lumiere: string) {
  return new THREE.MeshToonMaterial({ color: base, gradientMap: rampe([ombre, moyen, lumiere]) });
}
const contourMat = new THREE.MeshBasicMaterial({ color: 0x1a1d33, side: THREE.BackSide });

// ── ÉROSION DE L'ÎLE DANS LE VIDE (injection shader) ─────────────────────────
// Forme des uniforms PARTAGÉS pilotant l'érosion (cf. champ `erosionUniforms`).
interface ErosionUniforms {
  uNeant: { value: number };
  uFrem:  { value: number };
  uCoeur: { value: THREE.Vector2 };
  uRPlat: { value: number };
  uRBord: { value: number };
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1 « LE MONDE RESPIRE » — réglages pour que le Néant n'efface JAMAIS le monde.
// Au repos (vie basse), on veut une PRAIRIE ENDORMIE AU CRÉPUSCULE : herbe + ciel
// toujours là, juste assoupis/désaturés ; raviver = ça refleurit. Ces constantes
// sont nommées et faciles à régler (un seul endroit).
// (L'ÉROSION du sol a été RETIRÉE — îles toujours pleines/rondes/propres : cf. injecterErosionSol.)

// — CIEL au repos (crépuscule présent, jamais le noir total). —
//  CIEL_CREPUSCULE : la couleur vers laquelle le ciel glisse au pic de Néant. AVANT =
//                    #05060d (noir-vide). MAINTENANT = un bleu nuit doux de crépuscule.
const CIEL_CREPUSCULE = "vec3(0.055,0.070,0.130)";   // ~#0e1221, présent et lisible
//  CIEL_GLISSE_MAX : combien le ciel glisse vers le crépuscule au pic de Néant (0..1).
//                    AVANT = 1.0 (il devenait franchement le vide). 0.45 = il s'assoupit
//                    sans s'éteindre (l'horizon reste visible).
const CIEL_GLISSE_MAX = 0.45;
//  CIEL_ASSOMBR_MAX : assombrissement max du ciel au pic de Néant. AVANT = 0.6 (très
//                     sombre). 0.15 = à peine plus sombre → le crépuscule reste BEAU.
const CIEL_ASSOMBR_MAX = 0.15;

// — FOG au repos (laisse voir l'horizon, jamais un mur). —
//  FOG_RAPPROCHE_NEANT : de combien le Néant RAPPROCHE le fond de brume (far). AVANT =
//                        16 (le mur arrivait très près). 5 = l'horizon reste lointain.
const FOG_RAPPROCHE_NEANT = 5;
//  FOG_NEAR_NEANT : de combien le Néant rapproche le DÉBUT de brume. AVANT = 6. 2 = doux.
const FOG_NEAR_NEANT = 2;
//  CIEL_HAUT_CREPUSCULE : couleur du HAUT du ciel au pic de Néant. AVANT ≈ #020308
//                         (quasi noir). Crépuscule présent à la place.
const CIEL_HAUT_CREPUSCULE = 0x0c1326;
// — LUMIÈRE au repos (la prairie reste éclairée par le clair de lune). —
//  LUM_BAISSE_KEY / LUM_BAISSE_HEMI : combien le Néant éteint la lumière principale /
//  l'ambiance hémisphérique. AVANT = 0.45 / 0.50 (sombre). 0.30 = la prairie endormie
//  reste lisible au repos, tout en gardant le contraste « la vie illumine ».
const LUM_BAISSE_KEY  = 0.30;
const LUM_BAISSE_HEMI = 0.30;

// — GLOW / BLOOM (réglage VISUEL ; à ajuster au plus joli). —
// Référence Journey/Gris/Sky : halos DOUX mais COULEURS/FORMES lisibles (pas tout cramé
// en blanc). La force du bloom est recalculée chaque frame :
//   force = BLOOM_BASE + neant*… + progression*BLOOM_VIE + (boosts du climax), plafond 1.0.
//  BLOOM_BASE : glow de repos. AVANT 0.45 (trop fort, noyait les Piuws), puis 0.22.
//              0.08 = SOBRE (choix du 21/06 : monde vivant ~0.15, halos discrets,
//              couleurs/formes bien nettes). Le climax « Le Don » garde ses boosts (très contrasté).
const BLOOM_BASE = 0.08;
//  BLOOM_VIE : combien la vie du monde AJOUTE de glow. AVANT 0.20, puis 0.10.
//              0.07 → monde PLEINEMENT vivant ≈ 0.15 (BLOOM_BASE + BLOOM_VIE), sobre.
const BLOOM_VIE = 0.07;

// On greffe un bout de GLSL sur le matériau du SOL (ou de son contour) via `onBeforeCompile`
// pour DÉCOUPER le plan carré en ÎLE RONDE (discard au-delà d'un rayon CONSTANT `uRBord`).
// PLUS D'ÉROSION (choix de design) : l'île reste TOUJOURS pleine, ronde, propre — aucun
// rétrécissement par le Néant, aucun bord déchiqueté, aucune morsure interne, aucun liseré
// coloré. Seuls `uCoeur` (centre du disque) et `uRBord` (rayon) sont utilisés.
function injecterErosionSol(mat: THREE.Material, u: ErosionUniforms): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uCoeur = u.uCoeur;
    shader.uniforms.uRBord = u.uRBord;
    // 1) VERTEX : on calcule la position MONDE du fragment (xz suffisent) et on la
    //    transmet — travailler en monde évite tout casse-tête de rotation du plan.
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>",
        "#include <common>\n varying vec3 vWPos;")
      .replace("#include <begin_vertex>",
        "#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    // 2) FRAGMENT : ÎLE PROPRE (choix de design). On NE garde QUE le DÉCOUPAGE EN DISQUE
    //    rond, à rayon CONSTANT = uRBord. Plus aucune ÉROSION : pas de dépendance au Néant,
    //    pas de bruit/jaggedness, pas de morsures internes (gruyère), et AUCUN liseré coloré.
    //    L'île reste TOUJOURS PLEINE, RONDE et PROPRE. (Le sol change encore de couleur avec
    //    la vie via `solMatToon.color` ; le contour noir toon reste, c'est l'outline.)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        varying vec3 vWPos;
        uniform vec2 uCoeur; uniform float uRBord;`)
      // On insère JUSTE APRÈS le calcul de la couleur diffuse, à la toute fin du main.
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        {
          // Découpage en DISQUE : on transforme le plan carré en île RONDE. Rayon CONSTANT
          // (uRBord), jamais rongé → bord net, pas de rétrécissement, pas de trous.
          float d = length(vWPos.xz - uCoeur);
          if (d > uRBord) discard;
        }`);
  };
  mat.needsUpdate = true;
}

// PHASE 2 : crée un JEU d'uniforms d'érosion neuf (un par île — chacune s'érode/se teinte
// autour de SON propre Cœur). RPLAT/RBORD un peu plus petits qu'avant (gorge entre îles).
function nouveauxErosionUniforms(): ErosionUniforms {
  return {
    uNeant: { value: 0 }, uFrem: { value: 0 },
    uCoeur: { value: new THREE.Vector2(0, 0) },
    uRPlat: { value: RPLAT_2 }, uRBord: { value: RBORD_2 },
  };
}

// Tout ce qu'une ÎLE expose au renderer pour être pilotée chaque frame.
interface IleVisu {
  sol: THREE.Mesh;
  solContour: THREE.Mesh;               // le contour sombre (pour le masquer avec l'île)
  solMatToon: THREE.MeshToonMaterial;   // sa couleur glisse terne→vif selon SA vie
  solContourMat: THREE.Material & { opacity: number };  // matériau du contour (fondu de révélation)
  erosion: ErosionUniforms;             // ses propres uniforms (centrés sur SON Cœur)
  dx: number;                           // décalage 3D sur X de cette île
}

// Construit UNE île toon (plateau + collines + bords qui retombent) centrée en x=centreX,
// avec ses PROPRES uniforms d'érosion. Réutilisé 2× (zone A et zone B). Ajoute le sol et
// son contour à la scène ; renvoie de quoi l'animer.
function construireIle(scene: THREE.Scene, centreX: number, erosion: ErosionUniforms): IleVisu {
  const RPLAT = erosion.uRPlat.value, RBORD = erosion.uRBord.value;
  const solGeo = new THREE.PlaneGeometry(40, 40, 120, 120);
  const pos = solGeo.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), y = pos.getY(k);
    const dist = Math.hypot(x, y);
    const collines = 0.2 * (Math.sin(x * 0.34) * Math.cos(y * 0.29)
                          + 0.5 * Math.sin(x * 0.16 + 1.0) * Math.sin(y * 0.21 + 0.5));
    const chute = smoothstep5(RPLAT, RBORD, dist);
    let h = collines * (1 - chute) - 3.2 * chute;
    if (dist > RBORD) h -= (dist - RBORD) * 0.9;
    pos.setZ(k, h);
  }
  solGeo.computeVertexNormals();
  const solMatToon = toon(0x556149, "#222d22", "#3c5236", "#7fae63");
  injecterErosionSol(solMatToon, erosion);
  const sol = new THREE.Mesh(solGeo, solMatToon);
  sol.rotation.x = -Math.PI / 2; sol.position.x = centreX; scene.add(sol);
  // Contour sombre (même technique : copie face arrière, MÊME découpage en disque).
  const contourMatIle = contourMat.clone();
  injecterErosionSol(contourMatIle, erosion);
  const solContour = new THREE.Mesh(solGeo, contourMatIle);
  solContour.rotation.x = -Math.PI / 2; solContour.scale.setScalar(1.025);
  solContour.position.set(centreX, -0.06, 0); scene.add(solContour);
  return { sol, solContour, solMatToon,
           solContourMat: contourMatIle as THREE.Material & { opacity: number },
           erosion, dx: centreX };
}

// Construit un PONT DE PIERRE PERMANENT entre les bords intérieurs des deux îles : un
// tablier plat marchable (le long de X, à z≈0), porté par 2 piles, bordé de garde-corps
// bas. Réutilise M.pierre. Renvoie le groupe (ajouté à la scène par l'appelant).
function construirePont(): THREE.Group {
  const g = new THREE.Group();
  // Le tablier VISIBLE recouvre exactement la BANDE MARCHABLE du pont (PONT_X0..PONT_X1),
  // qui chevauche les plateaux plats des deux îles → le passage se LIT continu, sans trou.
  const xGauche = PONT_X0;     // = -DX + RPLAT_2 - 1.5 (mord dans le plateau plat de l'île A)
  const xDroite = PONT_X1;     // = +DX - RPLAT_2 + 1.5 (idem côté île B)
  const longueur = xDroite - xGauche;
  const centre = (xGauche + xDroite) / 2;
  const yTablier = -0.25;                   // un peu plus bas que le plateau (descente douce)
  // TABLIER plat et large (marchable).
  const tablier = new THREE.Mesh(new THREE.BoxGeometry(longueur, 0.35, 3.4), M.pierre);
  tablier.position.set(centre, yTablier, 0); g.add(tablier);
  const tablierC = new THREE.Mesh(new THREE.BoxGeometry(longueur, 0.35, 3.4), contourMat);
  tablierC.position.copy(tablier.position); tablierC.scale.set(1.01, 1.1, 1.04); g.add(tablierC);
  // GARDE-CORPS bas de chaque côté (deux longues barres fines).
  for (const dz of [-1.5, 1.5]) {
    const gc = new THREE.Mesh(new THREE.BoxGeometry(longueur, 0.45, 0.18), M.pierre);
    gc.position.set(centre, yTablier + 0.4, dz); g.add(gc);
    const gcC = new THREE.Mesh(new THREE.BoxGeometry(longueur, 0.45, 0.18), contourMat);
    gcC.position.copy(gc.position); gcC.scale.set(1.0, 1.06, 1.4); g.add(gcC);
  }
  // PILES sous le tablier (descendent dans la gorge → ancre visuel du pont).
  for (const px of [centre - longueur * 0.25, centre + longueur * 0.25]) {
    const pile = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.5, 0.9), M.pierre);
    pile.position.set(px, yTablier - 1.9, 0); g.add(pile);
    const pileC = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.5, 0.9), contourMat);
    pileC.position.copy(pile.position); pileC.scale.set(1.1, 1.02, 1.1); g.add(pileC);
  }
  return g;
}

// ── CONTENANCE DOUCE : la SURFACE MARCHABLE (où Phantom peut aller sans tomber). ─────
// Union { disque île A (centre -DX) ∪ bande du PONT ∪ disque île B (centre +DX) }.
// Le rayon marchable s'arrête au BORD DU PLATEAU PLAT (RPLAT_2), PAS sur la pente qui
// retombe dans le vide (entre RPLAT_2 et RBORD_2) → Phantom reste sur le haut plat.
const R_MARCHE = RPLAT_2;                 // rayon marchable = bord du plateau plat (le haut)
// La BANDE DU PONT doit RECOUVRIR le raccord avec chaque plateau (sinon trou entre le bord
// d'île à ~RPLAT_2 et le tablier). On l'étend pour mordre ~1,5 u dans chaque plateau plat.
const PONT_X0 = -DX + RPLAT_2 - 1.5;      // borde et chevauche le plateau plat de l'île A
const PONT_X1 =  DX - RPLAT_2 + 1.5;      // idem côté île B
const PONT_DZ = 1.55;                     // demi-largeur marchable du pont (tablier 3.4 → ~1.7, marge)
/**
 * Point le plus proche DANS la surface marchable, pour une position (x,z). Renvoie le
 * point corrigé + `dehors` = distance dont (x,z) débordait (0 si déjà dedans). On prend
 * la correction qui RAMÈNE LE MOINS (le bord le plus proche parmi île A / pont / île B).
 */
function contenir(x: number, z: number): { x: number; z: number; dehors: number } {
  // Déjà dans l'une des trois zones ? → rien à corriger.
  const dA = Math.hypot(x + DX, z), dB = Math.hypot(x - DX, z);
  const surPont = x >= PONT_X0 && x <= PONT_X1 && Math.abs(z) <= PONT_DZ;
  if (dA <= R_MARCHE || dB <= R_MARCHE || surPont) return { x, z, dehors: 0 };
  // Dehors : on calcule le point le plus proche sur CHAQUE zone, on garde le plus proche.
  // a) bord de l'île A : on projette sur le cercle de rayon R_MARCHE autour de (-DX,0).
  const ax = -DX + (x + DX) / dA * R_MARCHE, az = (z) / dA * R_MARCHE;
  // b) bord de l'île B.
  const bx = DX + (x - DX) / dB * R_MARCHE, bz = (z) / dB * R_MARCHE;
  // c) bord du PONT : on « clampe » dans le rectangle marchable du tablier.
  const cx = Math.max(PONT_X0, Math.min(PONT_X1, x)), cz = Math.max(-PONT_DZ, Math.min(PONT_DZ, z));
  const distA = Math.hypot(x - ax, z - az), distB = Math.hypot(x - bx, z - bz),
        distC = Math.hypot(x - cx, z - cz);
  if (distA <= distB && distA <= distC) return { x: ax, z: az, dehors: distA };
  if (distB <= distC)                   return { x: bx, z: bz, dehors: distB };
  return { x: cx, z: cz, dehors: distC };
}

// Matériaux de l'univers (mêmes intentions que les rendus Blender / la palette du jeu).
const M = {
  blanc:   toon(0xeef1ff, "#5a6080", "#c6cbe0", "#ffffff"),
  vert:    toon(0x57d36a, "#0f5524", "#33b54a", "#a6f08a"),
  ecorce:  toon(0x7a5550, "#22131c", "#4d3138", "#75545a"),
  feuille: toon(0x4fc77a, "#0d4d2e", "#2eb466", "#9af0a8"),
  pierre:  toon(0x6a5c8c, "#241a3a", "#4a3f6e", "#b0a0d8"), // monument violet (#7A5CFF)
  oeil:    new THREE.MeshBasicMaterial({ color: 0x4ec8ff }),
  oeilV:   new THREE.MeshBasicMaterial({ color: 0x0a0d16 }),
  reflet:  new THREE.MeshBasicMaterial({ color: 0xffffff }),
  herbe:   toon(0x3f9e54, "#123e22", "#2f8a44", "#7ed27e"),   // brins d'herbe (deux teintes)
  herbe2:  toon(0x4fb866, "#16482a", "#3aa256", "#92e08e"),
  // PHASE 2 — matériaux des nouveaux éléments (maison / foyer / chantier).
  mur:     toon(0xc9a07a, "#5a4334", "#a37c5c", "#e6c9a6"),   // torchis chaud de la maison
  toit:    toon(0x8a5a44, "#3a241b", "#6e4636", "#b07a5e"),   // tuile/chaume du toit
  porte:   toon(0x6e4a33, "#2c1d14", "#553827", "#8a6248"),   // bois de la porte
  corolle: toon(0x49e6ff, "#0a5a7a", "#2fc8e6", "#cffaff"),   // pétales cyan du Phare-Corolle
  bloc:    toon(0x6a5c8c, "#241a3a", "#4a3f6e", "#b0a0d8"),   // blocs du chantier (gris-violet)
  // PHASE 2 — BIOMES-RECOINS du ZURG (couleur-signature de chaque rêve, sol + formes).
  vie:     toon(0x80ff80, "#1f6e2e", "#52c466", "#bfffbf"),   // vert-vie (recoin « Espérer »)
  tige:    toon(0x4fb866, "#16482a", "#3aa256", "#92e08e"),   // tiges/pousses qui montent
  souffle: toon(0x49e6ff, "#0a5a7a", "#2fc8e6", "#cffaff"),   // cyan-vent (recoin « Explorer »)
};

// Halo lumineux diffus (aura d'esprit / luciole / éveil).
const texHalo = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
function faireHalo(taille: number, couleur: number, opacite = 0.18): THREE.Sprite {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texHalo, color: couleur, transparent: true, opacity: opacite,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(taille, taille, 1);
  return s;
}

/** Petite BULLE D'ONOMATOPÉE (texte) : un canvas dessiné → texture, pour faire
 *  « parler » le Piuw perdu sans vrai mot. Reconstruite SEULEMENT au changement de
 *  mot (pas à chaque frame), donc bon marché. */
function texteTexture(texte: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.font = "600 60px 'Trebuchet MS', Segoe UI, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 10;
  ctx.fillStyle = "#eaf6ff";
  ctx.fillText(texte, 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

// Texture « piuw ! » des nicheurs : créée UNE SEULE FOIS (réutilise texteTexture),
// partagée par toutes les bulles de chant → zéro création par frame.
const texPiuw = texteTexture("piuw !");

function boule(parent: THREE.Object3D, x: number, y: number, z: number, r: number,
               mat: THREE.Material, sx = 1, sy = 1, sz = 1, contour = true): THREE.Mesh {
  const geo = new THREE.SphereGeometry(r, 24, 16);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz);
  parent.add(m);
  if (contour) {
    const o = new THREE.Mesh(geo, contourMat);
    o.position.copy(m.position); o.scale.copy(m.scale).multiplyScalar(1.07);
    parent.add(o);
  }
  return m;
}
function barre(parent: THREE.Object3D, p0: number[], p1: number[], r: number, mat: THREE.Material): void {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = new THREE.Vector3().subVectors(b, a);
  const geo = new THREE.CylinderGeometry(r, r, d.length(), 10);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  parent.add(m);
  const o = new THREE.Mesh(geo, contourMat);
  o.position.copy(m.position); o.quaternion.copy(m.quaternion);
  o.scale.set(1.12, 1.04, 1.12);
  parent.add(o);
}
// Une BOÎTE (cube/prisme) toon + son contour. Renvoie le corps (pour le piloter).
function boite(parent: THREE.Object3D, x: number, y: number, z: number,
               w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m);
  const o = new THREE.Mesh(geo, contourMat);
  o.position.copy(m.position); o.scale.set(1.06, 1.06, 1.06);
  parent.add(o);
  return m;
}

// ── L'ARBRE-CŒUR (Région 1) : ÉVOLUE EN 3 STADES VISIBLES ────────────────────
// CHOIX D'IMPLÉMENTATION : on construit l'arbre UNE SEULE FOIS (toutes les pièces
// existent), puis `synchroniser()` ANIME en continu leur taille, leur angle et leur
// couleur selon la vie `v`. Une boule à taille 0 = simplement invisible (« pas encore
// éclose ») → pas de reconstruction par frame, transitions parfaitement lisses, zéro
// fuite mémoire. Les références pilotables sont rangées dans `g.userData.arbre`.
//
// Chaque boule de feuillage a un SEUIL DE NAISSANCE sur `v` : les feuilles éclosent
// une par une, DE BAS EN HAUT, quand on ravive (la 1re à v≈0.30, la dernière à v≈0.65).
// [x, y, z, rayon, seuil]. Triées du bas vers le haut pour l'éclosion progressive.
const FEUILLES_ARBRE: [number, number, number, number, number][] = [
  [ 0.10, 2.30,  0.00, 0.90, 0.30],   // grosse boule centrale (la 1re à pousser)
  [ 0.80, 2.10,  0.10, 0.60, 0.40],
  [-0.70, 2.15, -0.10, 0.62, 0.48],
  [ 0.45, 2.75,  0.20, 0.48, 0.55],
  [-0.20, 2.70, -0.20, 0.50, 0.60],
  [ 0.15, 3.00,  0.10, 0.55, 0.65],   // cime (la dernière à éclore)
];
// Lucioles-souvenirs : position fixe ; leur opacité monte par stade (gérée à la frame).
const LUCIOLES_ARBRE: [number, number, number][] = [
  [0.90, 1.90, 0.60], [-0.80, 2.50, 0.40], [0.20, 3.20, 0.40],
];

// Position d'ancrage d'un PIUW NICHEUR dans la canopée (x,y,z) + phase de flottement.
// PERCHÉS sur le BORD/le HAUT de la couronne (écartés vers l'extérieur + remontés) pour
// se détacher sur le fond sombre, pas enfouis au centre des boules de feuillage.
const NICHEURS_ARBRE: [number, number, number, number][] = [
  [ 0.95, 2.75,  0.55, 0.0],   // 1er Piuw : bord droit, mi-haut (arrive ~immédiat)
  [-0.75, 3.15, -0.30, 2.1],   // 2e Piuw : plus haut, bord gauche (arrive à ~20 s)
  [ 0.20, 3.35,  0.45, 4.2],   // 3e Piuw : près de la cime, devant (arrive à ~50 s)
];
// Délai (en secondes d'arbre épanoui) avant l'arrivée de chaque nicheur (multiplication 1→2→3).
const NICHEUR_ARRIVEE = [0, 20, 50];
// Fruits-lanternes : petites sphères cyan émissives réparties dans la canopée
// (x,y,z) + phase de pulsation. Discrets, lents — pas un sapin de Noël.
const FRUITS_ARBRE: [number, number, number, number][] = [
  [ 0.30, 2.20,  0.35, 0.0], [ 0.60, 2.40, -0.20, 1.1], [-0.45, 2.30,  0.25, 2.2],
  [ 0.10, 2.70,  0.30, 3.0], [-0.25, 2.60, -0.35, 4.1], [ 0.35, 2.95,  0.05, 5.0],
];

// Ce que `synchroniser()` retrouve dans le groupe de l'arbre pour l'animer.
interface ArbreVisu {
  feuilles: { mesh: THREE.Mesh; contour?: THREE.Mesh; seuil: number; r: number }[];
  branches: THREE.Group[];   // un sous-groupe par branche (on pilote son scale → la branche « pousse »)
  lucioles: THREE.Sprite[];
  // ── 4e couche « LE FOYER HABITÉ » (n'apparaît qu'à pleine vie, v haute) ──
  // Piuws qui NICHENT : groupe (forme Piuw) + un petit HALO cyan pour les détacher
  // du feuillage vert (sinon camouflés). Chacun a sa BULLE d'onomatopée (« piuw ! »),
  // un compte à rebours de chant `prochainChant`, et un minuteur d'AFFICHAGE `chante`.
  nicheurs: {
    grp: THREE.Group; halo: THREE.Sprite; baseY: number; phase: number;
    bulle: THREE.Sprite; prochainChant: number; chante: number;
  }[];
  fruits:   { mesh: THREE.Mesh; phase: number }[];                   // fruits-lanternes (pulsent)
  // ── NIVEAU 2 : MULTIPLICATION par TEMPS d'arbre épanoui (lecture seule) ──
  tempsEpanoui: number;       // s cumulées au-dessus du seuil foyer (monte/redescend doux)
  // ── NIVEAU 3 : L'ARBRE QUI ESSAIME (autonome, sans le joueur) ──
  cycle: number;              // horloge du cycle de respiration (s, boucle ~15 s)
  pousses: {                  // pousses-enfants qui naissent autour de l'arbre
    grp: THREE.Group; vInterne: number; cible: number; ne: boolean;
    tache: THREE.Sprite;      // tache de lumière au sol sous la pousse
  }[];
  graine?: {                  // LA graine de lumière en vol (une seule à la fois)
    sprite: THREE.Sprite; t: number; from: THREE.Vector3; to: THREE.Vector3; arc: number;
  };
}

// ── CONSTRUCTEURS DES ÉLÉMENTS (volumes toon, posés à l'origine du groupe) ───
function creerArbre(): THREE.Group {
  const g = new THREE.Group();
  // TRONC : voûte de base. Le redressement global est piloté par `vu.groupe.rotation.z`
  // dans synchroniser() (étend l'effet `mort*0.22` existant) → rien à stocker ici.
  barre(g, [0, 0, 0], [0.08, 1.5, 0], 0.22, M.ecorce);

  // BRANCHES : chacune dans son PROPRE sous-groupe centré sur le départ de branche, pour
  // pouvoir la faire « pousser » depuis le tronc (scale 0→1) sans déformer le reste.
  const branches: THREE.Group[] = [];
  const defsBranches: { base: number[]; bout: number[] }[] = [
    { base: [0.05, 1.0, 0], bout: [0.7, 1.8, 0.1] },
    { base: [0.05, 1.1, 0], bout: [-0.65, 1.9, -0.1] },
  ];
  for (const b of defsBranches) {
    const sg = new THREE.Group();
    sg.position.set(b.base[0], b.base[1], b.base[2]);     // pivot = départ de branche
    // On dessine la barre EN COORDONNÉES LOCALES (relative au pivot).
    barre(sg, [0, 0, 0],
      [b.bout[0] - b.base[0], b.bout[1] - b.base[1], b.bout[2] - b.base[2]], 0.08, M.ecorce);
    g.add(sg);
    branches.push(sg);
  }

  // FEUILLAGE : les 6 boules existent TOUTES dès le départ, mais à taille 0 (invisibles).
  // synchroniser() les fait gonfler une par une selon leur seuil de naissance.
  const feuilles: ArbreVisu["feuilles"] = [];
  for (const [x, y, z, r, seuil] of FEUILLES_ARBRE) {
    // On retrouve le corps ET son contour pour les scaler ENSEMBLE (sinon le contour
    // sombre resterait visible autour d'une boule rétrécie à 0).
    const avant = g.children.length;
    const mesh = boule(g, x, y, z, r, M.feuille);
    // boule() ajoute le corps puis (si contour) le contour juste après → on le récupère.
    const contour = g.children[avant + 1] instanceof THREE.Mesh
      ? (g.children[avant + 1] as THREE.Mesh) : undefined;
    mesh.scale.setScalar(0.0001); if (contour) contour.scale.setScalar(0.0001);
    feuilles.push({ mesh, contour, seuil, r });
  }

  // LUCIOLES : 3 points cyan ; leur opacité (donc leur présence) est gérée par stade.
  const lucioles: THREE.Sprite[] = [];
  for (const [x, y, z] of LUCIOLES_ARBRE) {
    const l = faireHalo(0.6, 0x9ffcff, 0.0); l.position.set(x, y, z); g.add(l);
    lucioles.push(l);
  }

  // ── 4e COUCHE « LE FOYER HABITÉ » : la vie vient HABITER l'arbre épanoui ──────
  // PIUWS NICHEURS : 1-2 petites silhouettes de Piuw posées dans la canopée. On
  // réutilise la forme `creerPiuw()` (réduite). Elles flottent doucement (sin) et
  // n'apparaissent (scale 0→1) qu'à pleine vie. C'EST le « foyer » : on voit la vie
  // venir s'installer dans l'arbre.
  const nicheurs: ArbreVisu["nicheurs"] = [];
  for (const [x, y, z, phase] of NICHEURS_ARBRE) {
    const p = creerPiuw();        // forme Piuw vert standard (corps + tête + yeux)
    p.position.set(x, y, z);
    p.scale.setScalar(0.0001);    // absent tant que l'arbre n'est pas pleinement épanoui
    // HALO cyan doux SOUS chaque nicheur (même esprit que l'aura des vrais Piuws) :
    // il les détache du feuillage vert sans faire « phare ». Additif, alpha bas, géré
    // en opacité par v dans synchroniser(). Le halo est enfant du groupe Piuw → il suit
    // sa position et son flottement automatiquement.
    const halo = faireHalo(1.1, 0x9ffcff, 0.0);
    halo.position.set(0, 0.15, 0);   // centré sur le petit corps
    p.add(halo);
    g.add(p);
    // BULLE « piuw ! » : sprite enfant de l'ARBRE (pas du Piuw, sinon le texte serait
    // rétréci avec lui). Texture partagée. Invisible au repos ; affichée par le chant.
    const bulle = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texPiuw, transparent: true, depthTest: false, opacity: 0 }));
    bulle.scale.set(1.3, 0.65, 1);
    bulle.renderOrder = 30;
    bulle.visible = false;
    g.add(bulle);
    // Premier chant désynchronisé (6-14 s), différent par nicheur.
    const prochainChant = 6 + Math.random() * 8;
    nicheurs.push({ grp: p, halo, baseY: y, phase, bulle, prochainChant, chante: 0 });
  }
  // FRUITS-LANTERNES : 6 petites sphères cyan émissives (couleur-signal de l'arbre)
  // qui pulsent TRÈS lentement. Sans contour, additif doux, alpha bas → densité de
  // vie tranquille, pas un sapin de Noël. Chacune a son matériau propre (opacité à part).
  const fruits: ArbreVisu["fruits"] = [];
  for (const [x, y, z, phase] of FRUITS_ARBRE) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x9ffcff, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = boule(g, x, y, z, 0.07, mat, 1, 1, 1, false);   // pas de contour
    mesh.scale.setScalar(0.0001);
    fruits.push({ mesh, phase });
  }

  g.userData.arbre = {
    feuilles, branches, lucioles, nicheurs, fruits,
    tempsEpanoui: 0, cycle: 0, pousses: [], graine: undefined,
  } as ArbreVisu;
  return g;
}
// Ce que `animerMonument()` retrouve : la statue NE POUSSE PAS, elle se RECOMPOSE.
// Deux « vagues » de blocs réapparaissent par stade (scale 0→1) ; socle + corps sont
// toujours là (stade 1, masse brisée incomplète).
interface MonumentVisu {
  vague2: THREE.Group;   // stade 2 : genoux, pieds, bras gauche (le corps se recompose)
  vague3: THREE.Group;   // stade 3 : tête + yeux + bras droit + poing (le geste iconique)
}
function creerPenseur(): THREE.Group {
  // Version SIMPLE et FRANCHE : peu de grandes masses (corps + genoux + tête + bras),
  // rien qui dépasse sur les côtés → silhouette unique, impossible à voir « doublée ».
  const g = new THREE.Group();
  // ── STADE 1 (toujours présent) : socle + corps = la « masse brisée » de départ ──
  const roc = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 1.05), M.pierre);
  roc.position.set(0, 0.16, 0); g.add(roc);
  // CORPS = une seule grande masse arrondie assise, penchée en avant.
  const corps = boule(g, 0, 0.82, 0.04, 0.5, M.pierre, 1.0, 1.12, 0.92);
  corps.rotation.x = -0.16;

  // ── STADE 2 (vague2) : le corps se RECOMPOSE (jambes + bras gauche) ──────────
  const vague2 = new THREE.Group(); g.add(vague2);
  // GENOUX/CUISSES = une masse avant unique, large et basse.
  boule(vague2, 0, 0.5, 0.5, 0.42, M.pierre, 1.18, 0.6, 0.95);
  // Deux pieds simples devant le socle.
  boule(vague2, 0.21, 0.15, 0.64, 0.13, M.pierre, 1.2, 0.6, 1.5);
  boule(vague2, -0.21, 0.15, 0.64, 0.13, M.pierre, 1.2, 0.6, 1.5);
  // BRAS GAUCHE : juste suggéré, court, main posée sur le genou (ne dépasse pas).
  barre(vague2, [-0.27, 1.0, 0.2], [-0.16, 0.56, 0.54], 0.12, M.pierre);
  boule(vague2, -0.16, 0.55, 0.56, 0.12, M.pierre);

  // ── STADE 3 (vague3) : le HAUT + le geste iconique se reforment en dernier ────
  const vague3 = new THREE.Group(); g.add(vague3);
  // TÊTE baissée (le penseur regarde vers le bas) + ses deux yeux.
  const tete = boule(vague3, 0, 1.4, 0.32, 0.3, M.pierre, 1.0, 1.0, 1.0);
  tete.rotation.x = 0.25;
  boule(vague3, -0.1, 1.38, 0.58, 0.05, M.oeilV, 1.1, 1.3, 0.6, false);
  boule(vague3, 0.1, 1.38, 0.58, 0.05, M.oeilV, 1.1, 1.3, 0.6, false);
  // BRAS DROIT (le geste iconique) : épaule → coude sur le genou → poing au menton.
  barre(vague3, [0.3, 1.02, 0.18], [0.24, 0.55, 0.6], 0.13, M.pierre);  // bras
  barre(vague3, [0.24, 0.55, 0.6], [0.06, 1.2, 0.48], 0.115, M.pierre); // avant-bras → menton
  boule(vague3, 0.06, 1.24, 0.5, 0.14, M.pierre);                      // poing sous le menton

  // À v=0 : seulement socle + corps. Les deux vagues sont « absentes » (scale ~0).
  vague2.scale.setScalar(0.0001);
  vague3.scale.setScalar(0.0001);
  g.userData.monument = { vague2, vague3 } as MonumentVisu;
  return g;
}

// ═══ PHASE 2 — LES 3 NOUVEAUX ÉLÉMENTS (3 stades pilotés par `v`, primitives toon) ═══

// (a) LA MAISON (zone A — type "maison") : un petit abri rond et chaleureux qui SE
//     RALLUME. Stade 1 : éteinte/grise, fenêtre noire. Stade 2 : fenêtre en braise
//     tiède. Stade 3 : foyer doré plein + filet de fumée + halo d'accueil.
interface MaisonVisu {
  fenetre: THREE.Mesh;          // disque émissif : noir → braise → foyer doré
  accueil: THREE.Sprite;        // halo chaleureux devant la porte (stade 3)
  fumee: THREE.Sprite[];        // filet de fumée qui monte de la cheminée (stade 3)
}
function creerMaison(): THREE.Group {
  const g = new THREE.Group();
  // CORPS = une masse arrondie/cubique douce (torchis chaud).
  boule(g, 0, 0.55, 0, 0.62, M.mur, 1.15, 0.95, 1.0);
  // TOIT = un cône posé dessus (chaume/tuile).
  const toit = new THREE.Mesh(new THREE.ConeGeometry(0.92, 0.7, 5), M.toit);
  toit.position.set(0, 1.28, 0); toit.rotation.y = Math.PI / 5; g.add(toit);
  const toitC = new THREE.Mesh(new THREE.ConeGeometry(0.92, 0.7, 5), contourMat);
  toitC.position.copy(toit.position); toitC.rotation.copy(toit.rotation);
  toitC.scale.setScalar(1.06); g.add(toitC);
  // CHEMINÉE (petit prisme sur le toit) — départ du filet de fumée.
  boite(g, 0.35, 1.5, 0.1, 0.18, 0.4, 0.18, M.toit);
  // PORTE ronde (arche sombre) au pied de la façade (côté +z, vers la caméra/Phantom).
  boule(g, 0, 0.32, 0.6, 0.2, M.porte, 1.0, 1.5, 0.4, false);
  // FENÊTRE : un disque émissif (MeshBasic) qui change de couleur par stade.
  const fenMat = new THREE.MeshBasicMaterial({ color: 0x0a0d16, transparent: true, opacity: 1 });
  const fenetre = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), fenMat);
  fenetre.position.set(0.3, 0.62, 0.62); g.add(fenetre);
  // HALO d'accueil chaleureux devant la maison (éteint au repos).
  const accueil = faireHalo(2.6, 0xffc875, 0.0); accueil.position.set(0, 0.7, 0.5); g.add(accueil);
  // FILET DE FUMÉE : quelques sprites pâles au-dessus de la cheminée (montent + s'évaporent).
  const fumee: THREE.Sprite[] = [];
  for (let i = 0; i < 4; i++) {
    const s = faireHalo(0.4, 0xd8d2c8, 0.0); s.position.set(0.35, 1.7, 0.1); g.add(s);
    fumee.push(s);
  }
  g.userData.maison = { fenetre, accueil, fumee } as MaisonVisu;
  return g;
}

// (b) LE PHARE-COROLLE (zone B cœur — type "foyer") : une FLEUR-LANTERNE qui respire =
//     le poumon lumineux du village (source du « souffle commun »). 3 stades pilotés par v
//     = surtout l'ANGLE D'OUVERTURE des pétales + l'intensité :
//       (1) BOUTON fermé → (2) ÉCLOSION mi-ouverte → (3) SANCTUAIRE grand ouvert (colonne).
//     RÉVERSIBLE (se referme si v baisse). Cyan + blanc nacré. Primitives toon.
interface FoyerVisu {
  braise: THREE.Mesh;           // sphère centrale émissive (pulse) : la BRAISE
  petales: THREE.Group[];       // pétales : pivot à la BASE → on les OUVRE par rotation.x
  haloSol: THREE.Sprite;        // disque-halo au sol (nid où les Piuws se posent)
  colonne: THREE.Mesh;          // cône étiré vers le haut (la colonne/phare), semi-transparent
  anneaux: THREE.Mesh[];        // anneaux au sol où les Piuws se posent (stade 3)
}
function creerFoyer(): THREE.Group {
  const g = new THREE.Group();
  // BRAISE centrale : icosaèdre émissif translucide qui pulse (cœur de la lanterne).
  const braiseMat = new THREE.MeshBasicMaterial({ color: 0xcffaff, transparent: true,
    opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const braise = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), braiseMat);
  braise.position.set(0, 1.1, 0); g.add(braise);
  // PÉTALES en couronne : chacun dans un sous-groupe dont le PIVOT est à la base (au cou
  // de la fleur), pour s'OUVRIR/FERMER par une simple rotation.x. Sphères aplaties (cyan).
  const NPET = 6;
  const petales: THREE.Group[] = [];
  for (let i = 0; i < NPET; i++) {
    const piv = new THREE.Group();
    piv.position.set(0, 0.8, 0);              // base de la corolle
    piv.rotation.y = (i / NPET) * TAU;        // réparti en couronne
    // Le pétale (goutte aplatie) part vers le HAUT depuis le pivot ; rotation.x l'ouvre.
    const p = boule(piv, 0, 0.55, 0.18, 0.4, M.corolle, 0.8, 1.5, 0.45);
    p.position.y = 0.55;
    g.add(piv);
    petales.push(piv);
  }
  // COLONNE / PHARE : un cône très étiré vers le haut, semi-transparent (apparaît stade 3).
  const colMat = new THREE.MeshBasicMaterial({ color: 0xbfeaff, transparent: true,
    opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const colonne = new THREE.Mesh(new THREE.ConeGeometry(0.6, 9, 16, 1, true), colMat);
  colonne.position.set(0, 5.5, 0); g.add(colonne);
  // HALO au SOL (le nid lumineux où les Piuws se posent).
  const haloSol = faireHalo(7, 0x9ffcff, 0.0); haloSol.position.set(0, 0.08, 0); g.add(haloSol);
  // ANNEAUX au sol (cercles où les Piuws se posent au stade 3).
  const anneaux: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const r = 1.8 + i * 1.1;
    const an = new THREE.Mesh(new THREE.RingGeometry(r - 0.08, r, 48),
      new THREE.MeshBasicMaterial({ color: 0xcffaff, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    an.rotation.x = -Math.PI / 2; an.position.y = 0.06; g.add(an); anneaux.push(an);
  }
  g.userData.foyer = { braise, petales, haloSol, colonne, anneaux } as FoyerVisu;
  return g;
}

// (c) LE CHANTIER SUSPENDU (zone B nœud — type "chantier") : ~10 BLOCS qui flottent
//     (mobile de Calder), et qui s'ASSEMBLENT en ARCHE/portail avec `v` (lerp entre
//     deux jeux de positions). Entre les blocs assemblés : des COUTURES D'OR (kintsugi).
interface ChantierVisu {
  blocs: {
    grp: THREE.Group;           // sous-groupe (corps + contour) → contour SUIT le bloc
    eparp: THREE.Vector3;       // position « éparpillée » (v bas)
    assemb: THREE.Vector3;      // position « assemblée » (v haut)
    spin: number; phase: number;
  }[];
  coutures: THREE.Mesh[];       // cylindres d'or entre blocs assemblés (brillent avec v)
  passage: THREE.Sprite;        // petit halo sous l'arche (stade 3)
}
function creerChantier(): THREE.Group {
  const g = new THREE.Group();
  const NB = 10;
  const blocs: ChantierVisu["blocs"] = [];
  // L'ARCHE assemblée : une demi-couronne de blocs (un portail). On la dessine en
  // calculant, pour chaque bloc, sa place ASSEMBLÉE (sur l'arche) et une place
  // ÉPARPILLÉE (dispersée autour, en l'air).
  for (let i = 0; i < NB; i++) {
    const t = i / (NB - 1);                       // 0→1 le long de l'arche
    const a = Math.PI * (0.1 + t * 0.8);          // angle sur le demi-cercle (portail)
    const R = 1.5;
    const assemb = new THREE.Vector3(Math.cos(a) * R, 0.4 + Math.sin(a) * R, 0);
    // Éparpillé : autour, dispersé et plus haut, façon mobile.
    const ea = TAU * (i / NB) + 0.6;
    const eparp = new THREE.Vector3(Math.cos(ea) * (2.2 + (i % 3) * 0.4),
                                    1.2 + Math.sin(i * 1.3) * 1.0,
                                    Math.sin(ea) * (1.2 + (i % 2) * 0.5));
    // Chaque bloc = un SOUS-GROUPE (corps + contour) placé à l'origine, qu'on déplace en
    // entier → le contour SUIT le bloc (sinon il resterait orphelin à la place de départ,
    // donnant l'illusion que les blocs ne bougent pas et restent sombres).
    const grp = new THREE.Group();
    boite(grp, 0, 0, 0, 0.5, 0.5, 0.5, M.bloc);
    grp.position.copy(eparp);
    grp.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
    g.add(grp);
    blocs.push({ grp, eparp, assemb, spin: (Math.random() - 0.5) * 0.6, phase: Math.random() * TAU });
  }
  // COUTURES D'OR : un fin cylindre entre chaque bloc assemblé consécutif (kintsugi).
  // Position/orientation FIXES (calculées sur les places assemblées) ; on n'allume que
  // leur opacité avec `v`. MeshBasic doré, additif.
  const coutures: THREE.Mesh[] = [];
  for (let i = 0; i < NB - 1; i++) {
    const a = blocs[i].assemb, b = blocs[i + 1].assemb;
    const d = new THREE.Vector3().subVectors(b, a);
    const geo = new THREE.CylinderGeometry(0.04, 0.04, d.length(), 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const c = new THREE.Mesh(geo, mat);
    c.position.copy(a).add(b).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.add(c); coutures.push(c);
  }
  // PETIT HALO de passage SOUS l'arche (stade 3).
  const passage = faireHalo(2.2, 0xffd27a, 0.0); passage.position.set(0, 0.2, 0); g.add(passage);
  g.userData.chantier = { blocs, coutures, passage } as ChantierVisu;
  return g;
}

// ── BIOMES-RECOINS DU ZURG (pilotes) ─────────────────────────────────────────
// Chaque recoin est un petit « quartier-pétale » de décor PUR (les Piuws y vivent ;
// AUCUN impact sur l'équilibrage). Construit dans son repère LOCAL avec « l'extérieur »
// (le bord du monde, loin du Phare central) = +Z local. La « roue des rêves » les place
// ensuite à leur angle autour du centre du ZURG. 100 % primitives toon, zéro asset.

// « LA PENTE QUI MONTE » — rêve ESPÉRER (vert). Un sol en marches qui s'élève vers
// l'extérieur, hérissé de fines pousses coiffées d'un bourgeon : tout pointe vers le haut.
function creerPenteQuiMonte(): THREE.Group {
  const g = new THREE.Group();
  // 4 marches qui montent vers +Z (l'extérieur) → lecture immédiate « ça grimpe ».
  for (let i = 0; i < 4; i++) {
    const z = -1.2 + i * 1.3;
    const h = 0.22 + i * 0.34;
    boite(g, 0, h / 2, z, 4.2 - i * 0.5, h, 1.3, M.vie);
  }
  // Fines pousses verticales + bourgeon, de plus en plus hautes vers le haut de la pente.
  for (let i = 0; i < 8; i++) {
    const x = -1.7 + (i % 4) * 1.15 + ((i >> 2) * 0.4);
    const z = -1.0 + (i % 4) * 0.85 + ((i >> 2) * 1.4);
    const baseY = 0.12 + (z + 1.2) * 0.27;          // suit la pente moyenne des marches
    const ht = 0.55 + (z + 1.2) * 0.22;             // plus haut vers l'extérieur
    barre(g, [x, baseY, z], [x, baseY + ht, z], 0.045, M.tige);
    boule(g, x, baseY + ht + 0.12, z, 0.13, M.vie);
  }
  // Halo vert doux au sommet de la pente (la lueur d'espoir, sobre).
  const lueur = faireHalo(2.6, 0x80ff80, 0.12); lueur.position.set(0, 1.2, 2.4); g.add(lueur);
  return g;
}

// « LE PROMONTOIRE VENTÉ » — rêve EXPLORER (cyan). Un plateau plat et ouvert qui avance
// vers l'horizon, des mâts/fanions tous penchés dans le même sens (le vent), rien qui barre.
function creerPromontoireVente(): THREE.Group {
  const g = new THREE.Group();
  // Plateau plat bas, dégagé, avancé vers l'extérieur.
  const platGeo = new THREE.CylinderGeometry(2.9, 3.1, 0.18, 28);
  const plat = new THREE.Mesh(platGeo, M.souffle);
  plat.position.set(0, 0.09, 0.8); g.add(plat);
  const platO = new THREE.Mesh(platGeo, contourMat);
  platO.position.copy(plat.position); platO.scale.set(1.05, 1.05, 1.05); g.add(platO);
  // 5 mâts inclinés TOUS dans le même sens (vers +X/+Z = le vent), + un fanion en haut.
  for (let i = 0; i < 5; i++) {
    const x = -1.9 + i * 0.95;
    const z = -0.3 + (i % 2) * 0.7;
    const base = [x, 0.18, z];
    const top = [x + 0.55, 0.18 + 1.5, z + 0.45];   // penché : tête au vent
    barre(g, base, top, 0.045, M.souffle);
    // Fanion : un petit plan cyan près du sommet, qui « claque » dans le même sens.
    const fanion = boite(g, top[0] + 0.22, top[1] - 0.15, top[2] + 0.18, 0.5, 0.3, 0.04, M.souffle);
    fanion.rotation.y = -0.5;
  }
  // Halo cyan large et bas (l'horizon ouvert), sobre.
  const horizon = faireHalo(3.4, 0x49e6ff, 0.1); horizon.position.set(0.4, 0.5, 1.4); g.add(horizon);
  return g;
}

function creerPhantom(): THREE.Group {
  const g = new THREE.Group();
  boule(g, 0, 0.40, 0, 0.40, M.blanc, 1.0, 0.92, 1.0);
  boule(g, 0, 0.02, 0, 0.31, M.blanc, 1.0, 0.90, 1.05);
  boule(g, 0, -0.26, 0, 0.15, M.blanc, 0.80, 1.70, 0.85);
  boule(g, -0.165, -0.20, 0, 0.125, M.blanc, 0.75, 1.50, 0.80);
  boule(g, 0.165, -0.20, 0, 0.125, M.blanc, 0.75, 1.50, 0.80);
  for (const sx of [-1, 1]) {
    boule(g, sx * 0.16, 0.46, 0.40, 0.155, M.oeil, 0.78, 1.2, 0.5, false);
    boule(g, sx * 0.16 + 0.045, 0.55, 0.47, 0.038, M.reflet, 1, 1, 1, false);
  }
  return g;
}
function creerPiuw(corps: THREE.Material = M.vert): THREE.Group {
  const g = new THREE.Group();
  boule(g, 0, 0, 0, 0.30, corps, 1.0, 0.86, 1.02);
  boule(g, 0, 0.34, 0, 0.10, corps, 0.8, 1.4, 0.8);
  for (const sx of [-1, 1]) {
    boule(g, sx * 0.11, 0.07, 0.22, 0.09, M.oeilV, 0.92, 1.05, 0.6, false);
    boule(g, sx * 0.11 + 0.03, 0.11, 0.27, 0.03, M.reflet, 1, 1, 1, false);
  }
  return g;
}

// PHASE 2 — UN PIUW-RÊVE du ZURG : base commune (corps + yeux) + SON TRAIT DE FORME
// ── GLYPHES du Piuw « CRÉER » : une ÉCRITURE INCONNUE, élégante et CISELÉE (sigils/runes
// organiques, intraduisibles). Chaque glyphe = des POINTS DE CONTRÔLE 2D (~[-0.5,0.5]) qui
// seront passés en SPLINE Catmull-Rom (courbes LISSES). Composés de boucles, crochets,
// croisements, points détachés — JAMAIS de lettres connues. Chacun DISTINCT. 9 signes.
const GLYPHES: number[][][] = [
  // 1) « la spirale habitée » : une volute qui s'enroule puis lance une queue + un point.
  [[0.28, 0.10], [0.10, 0.28], [-0.14, 0.20], [-0.20, -0.04], [-0.02, -0.18], [0.14, -0.06],
   [0.06, 0.06], [-0.04, 0.00], [0.30, -0.34], [0.34, -0.34]],
  // 2) « le hameçon double » : deux crochets opposés reliés par une diagonale souple.
  [[-0.36, 0.30], [-0.30, 0.06], [-0.42, -0.02], [-0.30, -0.14], [-0.08, 0.04],
   [0.18, 0.22], [0.40, 0.10], [0.30, -0.10], [0.18, -0.06]],
  // 3) « l'œil clos » : une amande fermée traversée d'un cil + un point au-dessus.
  [[-0.38, 0.0], [-0.12, 0.20], [0.16, 0.18], [0.38, -0.02], [0.10, -0.16], [-0.18, -0.12],
   [-0.38, 0.0], [-0.05, 0.05], [0.20, 0.02], [0.0, 0.40], [0.01, 0.40]],
  // 4) « la triple vague » : trois ondulations décroissantes, signe d'eau/de souffle.
  [[-0.42, -0.06], [-0.24, 0.16], [-0.06, -0.08], [0.10, 0.14], [0.24, -0.04], [0.36, 0.10]],
  // 5) « le nœud croisé » : un huit asymétrique (deux boucles qui se croisent).
  [[-0.04, 0.34], [-0.26, 0.16], [-0.16, -0.06], [0.06, 0.04], [0.22, -0.18], [0.04, -0.34],
   [-0.10, -0.18], [0.06, 0.04], [0.24, 0.12]],
  // 6) « la flamme renversée » : une boucle haute avec une longue queue qui descend en S.
  [[0.16, 0.10], [0.06, 0.32], [-0.16, 0.28], [-0.16, 0.06], [0.02, -0.02], [-0.06, -0.18],
   [0.08, -0.28], [0.0, -0.40]],
  // 7) « la rune à trois branches » : un tronc courbe d'où partent deux courbes + un point.
  [[0.0, -0.40], [0.02, -0.06], [-0.24, 0.16], [-0.30, 0.34], [0.02, -0.06], [0.26, 0.18],
   [0.32, 0.36], [0.02, -0.06], [0.30, -0.30]],
  // 8) « le glyphe lové » : une grande courbe en C avec une perle au centre.
  [[0.30, -0.28], [0.04, -0.36], [-0.24, -0.18], [-0.30, 0.10], [-0.12, 0.32], [0.16, 0.30],
   [0.30, 0.10], [-0.02, 0.02], [-0.04, 0.02]],
  // 9) « le sceau ailé » : un trait central avec deux petites boucles symétriques en haut.
  [[0.0, -0.36], [0.0, 0.04], [-0.22, 0.14], [-0.10, 0.30], [0.04, 0.18], [0.0, 0.04],
   [0.20, 0.16], [0.10, 0.32], [-0.02, 0.18]],
];
// Nombre de points RÉÉCHANTILLONNÉS par glyphe (résolution du tracé). PLUS HAUT = courbes
// plus LISSES (les chemins sont passés en spline Catmull-Rom → tracé ciselé). Fixe (pool).
const GLYPHE_N = 96;
// ── Réglages VISUELS des glyphes (faciles à ajuster) ──
const GLYPHE_TAILLE   = 1.7;    // échelle du signe (un peu plus serré : fin + riche = élégant)
const GLYPHE_LARGEUR  = 0.05;   // demi-largeur du RUBAN — FIN et ciselé (calligraphie délicate)
const GLYPHE_COULEUR  = 0xd9b8ff; // violet clair précieux qui irradie (« encre de lumière »)
const GLYPHE_OPACITE  = 0.95;   // additif, bien visible même fin
const GLYPHE_TRACE    = 1.1;    // durée du tracé (s) — un peu plus lent = plume élégante
const GLYPHE_SUSPENS  = 2.0;    // durée de suspension (s) — lisible
const GLYPHE_EFFACE   = 1.0;    // durée de l'effacement (s)
// Passe un chemin de POINTS DE CONTRÔLE en SPLINE Catmull-Rom (courbe LISSE qui passe par
// les points) et rééchantillonne en GLYPHE_N points ~équidistants → tracé CISELÉ et régulier.
function reechantillonneGlyphe(path: number[][]): THREE.Vector2[] {
  const ctrl = path.map((p) => new THREE.Vector3(p[0], p[1], 0));
  const courbe = new THREE.CatmullRomCurve3(ctrl, false, "catmullrom", 0.5);
  // getSpacedPoints → répartition à ~longueur d'arc constante (largeur de ruban régulière).
  return courbe.getSpacedPoints(GLYPHE_N - 1).map((v) => new THREE.Vector2(v.x, v.y));
}
// Glyphes pré-rééchantillonnés une fois (data partagée).
const GLYPHES_PTS = GLYPHES.map(reechantillonneGlyphe);

// (primitives toon selon le rêve) + SA couleur. Le mouvement signature est appliqué
// côté synchroniserPiuws. `userData.anim` = pièces à animer (anneaux, antenne…).
function creerPiuwReve(reve: Reve): THREE.Group {
  const coul = COULEUR_PIUW_ZURG[reve];
  // Corps : pour proteger/transmettre le corps reste blanc nacré ; sinon il prend la
  // teinte du rêve (matériau cloné pour ne pas teinter les autres).
  const corpsBlanc = reve === "proteger" || reve === "transmettre";
  const corpsMat = (M.vert.clone() as THREE.MeshToonMaterial);
  corpsMat.color = new THREE.Color(corpsBlanc ? 0xeef1ff : coul);
  const g = creerPiuw(corpsMat);
  const accent = new THREE.MeshBasicMaterial({ color: coul });   // pièces colorées du trait
  const anim: Record<string, THREE.Object3D | THREE.Object3D[]> = {};

  switch (reve) {
    case "sauver": {
      // « LE VEILLEUR PENCHÉ » : il t'enlace par un arceau et veille sur le vide.
      const R = 0.30;                                  // rayon du corps de base (cf. creerPiuw)
      // Corps émissif or chaud (on remplace la teinte de base par l'or « lanterne »).
      corpsMat.color = new THREE.Color(0xffc56b);
      const clair = new THREE.MeshBasicMaterial({ color: 0xffe3a8 });   // arceau + ailes lumineux
      const ombreInt = new THREE.MeshBasicMaterial({ color: 0xe8a24a, transparent: true,
        opacity: 0.35 });                              // chaleur ambrée FAIBLE (intérieur d'arceau)
      // SOUS-GROUPE « forme » : on pourra l'INCLINER (~25°) pendant la garde sans bouger
      // le corps/les yeux du Piuw (qui, eux, pivotent vers Phantom au moment fort).
      const forme = new THREE.Group(); g.add(forme);
      // ARCEAU (tore) qui l'enlace par l'ARRIÈRE : grand, incliné ~25° vers l'arrière,
      // centré ~0.4R au-dessus du corps.
      const arc = new THREE.Mesh(new THREE.TorusGeometry(1.5 * R, 0.12 * R, 10, 28), clair);
      arc.position.y = 0.4 * R; arc.rotation.x = THREE.MathUtils.degToRad(90 + 25); forme.add(arc);
      // Doublure ambrée FAIBLE à l'intérieur de l'arceau (chaleur de lanterne, pas jaune plat).
      const arcInt = new THREE.Mesh(new THREE.TorusGeometry(1.5 * R, 0.07 * R, 8, 28), ombreInt);
      arcInt.position.copy(arc.position); arcInt.rotation.copy(arc.rotation); forme.add(arcInt);
      // 2 DEMI-TORES (ailes ouvertes) sur les flancs, à ±1.1R.
      for (const sx of [-1, 1]) {
        const aile = new THREE.Mesh(new THREE.TorusGeometry(0.7 * R, 0.1 * R, 8, 18, Math.PI), clair);
        aile.position.set(sx * 1.1 * R, 0.1 * R, 0);
        aile.rotation.z = sx > 0 ? -Math.PI / 2 : Math.PI / 2;   // l'arc ouvert vers le haut/dehors
        forme.add(aile);
      }
      // DISQUE-VOILE devant : s'allume pendant la garde (opacité ~0.12 → ~0.5).
      const voileMat = new THREE.MeshBasicMaterial({ color: 0xffe3a8, transparent: true,
        opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const voile = new THREE.Mesh(new THREE.CircleGeometry(1.3 * R, 24), voileMat);
      voile.position.set(0, 0.05, 0.8 * R); forme.add(voile);
      anim.forme = forme; anim.voile = voile;
      break;
    }
    case "creer": {
      // GERBE D'IDÉES : 4 cônes-pétales ASYMÉTRIQUES penchés VERS L'AVANT (déborde, pas une
      // couronne sage). Crête en violet ÉCLAIRCI (#B98CFF) qui attrape le bloom (MeshBasic).
      const R = 0.30;
      const crete = new THREE.MeshBasicMaterial({ color: 0xb98cff });
      // [hauteur, x, z, inclinaison_z, inclinaison_x] — penchés vers l'avant (+z).
      const petales: [number, number, number, number, number][] = [
        [0.9 * R, 0,          0.10 * R, 0,                      0.30],   // grand central, penché avant
        [0.65 * R, -0.16 * R, 0.06 * R, THREE.MathUtils.degToRad(28),  0.25],   // moyen gauche
        [0.55 * R,  0.18 * R, 0.04 * R, -THREE.MathUtils.degToRad(30), 0.22],   // moyen droite
        [0.35 * R,  0.02 * R, -0.14 * R, THREE.MathUtils.degToRad(10), -0.45],  // petit qui s'échappe en arrière
      ];
      for (const [h, x, z, iz, ix] of petales) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, h, 8), crete);   // fins et pointus
        c.position.set(x, 0.34 + h * 0.5, z);
        c.rotation.set(ix, 0, iz);
        g.add(c);
      }
      break;
    }
    case "explorer": { // queue de comète (cône allongé fin vers -Z)
      const q = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.7, 10), accent);
      q.rotation.x = -Math.PI / 2; q.position.z = -0.42; g.add(q);
      break;
    }
    case "esperer": {  // germe/flamme (cône arrondi vers +Y)
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 12), accent);
      f.position.y = 0.46; g.add(f);
      break;
    }
    case "proteger": { // 2 anneaux croisés (tournent en sens inverse → animés)
      const a1 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 28), accent);
      const a2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 28), accent);
      a2.rotation.y = Math.PI / 2; g.add(a1, a2); anim.anneaux = [a1, a2];
      break;
    }
    case "comprendre": { // antenne courbée + bouboule lumineuse au bout
      const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), accent);
      tige.position.set(0.05, 0.5, 0); tige.rotation.z = -0.5; g.add(tige);
      const b = boule(g, 0.25, 0.66, 0, 0.08, accent, 1, 1, 1, false);
      anim.antenne = b;
      break;
    }
    case "transmettre": {
      // « LE COLPORTEUR » (épuré, SANS cornet) : 2 ANNEAUX ORBITAUX = « celui qui relie »,
      // lisible à 360° (même de dos). Corps blanc chaud ; l'OR vit dans les anneaux.
      const R = 0.30;
      corpsMat.color = new THREE.Color(0xfff4e0);                 // blanc chaud
      const orMat = new THREE.MeshBasicMaterial({ color: 0xffc766 });   // or affiné (émissif)
      // Tore A : rayon 1.25R, épaisseur 0.05R, incliné ~20°. Tore B : 1.45R, 0.04R, ~-35°.
      // Chacun dans son sous-groupe → on les fera tourner LENTEMENT en SENS INVERSE.
      const anneauA = new THREE.Group();
      anneauA.add(new THREE.Mesh(new THREE.TorusGeometry(1.25 * R, 0.05 * R, 8, 32), orMat));
      anneauA.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(20); g.add(anneauA);
      const anneauB = new THREE.Group();
      anneauB.add(new THREE.Mesh(new THREE.TorusGeometry(1.45 * R, 0.04 * R, 8, 32), orMat));
      anneauB.rotation.x = Math.PI / 2 + THREE.MathUtils.degToRad(-35); g.add(anneauB);
      anim.anneauA = anneauA; anim.anneauB = anneauB;
      break;
    }
    case "se-souvenir": { // 2-3 images fantômes plus pâles en sillage (gérées en anim)
      const echos: THREE.Mesh[] = [];
      for (let i = 0; i < 3; i++) {
        const e = boule(g, 0, 0, 0, 0.26 - i * 0.04,
          new THREE.MeshBasicMaterial({ color: coul, transparent: true, opacity: 0.18 - i * 0.05,
            depthWrite: false }), 1, 0.86, 1.02, false);
        e.visible = false; g.add(e); echos.push(e);
      }
      anim.echos = echos;
      break;
    }
  }
  g.userData.anim = anim;
  return g;
}

// Couleur d'ambiance par type de nœud (pour les halos / flashs d'éveil). Seuls
// monument/heart existent encore en data ; on garde un repli vert tendre par sécurité.
const COULEUR: Partial<Record<NodeType, number>> = {
  monument: 0x9a7cff, heart: 0x8effa0,
  maison: 0xffc875,    // foyer doré chaleureux (la maison qui se rallume)
  foyer:  0xffb24d,    // ambre du Foyer commun (l'œil qui s'ouvre)
  chantier: 0xffd27a,  // or des coutures (kintsugi)
};
const COULEUR_DEFAUT = 0x8effa0;

// ── COULEUR DES 8 RÊVES ─────────────────────────────────────────────────────
// Chaque Piuw PORTE un rêve (cf. CARACTERE_REVE) ; ce rêve lui donne SA couleur,
// pour que les 8 tempéraments se LISENT enfin à l'écran (avant, tous verts).
// Teintes pastel distinctes mais harmonieuses (l'univers reste doux/poétique).
const COULEUR_REVE: Record<Reve, number> = {
  sauver:        0x6effa0, // vert tendre — répare, rassure
  creer:         0xff8fce, // rose magenta — art, joie
  explorer:      0xffb24d, // orange vif — aventure, frétillant
  esperer:       0xffe27a, // jaune lumineux — renaissance, espoir
  proteger:      0x6fb8ff, // bleu calme — refuge, stabilité
  comprendre:    0x6ff2ff, // cyan — savoir, révélation
  transmettre:   0xff9a76, // corail chaud — partage, tradition
  "se-souvenir": 0xc0a8ff, // lavande — souvenir, écho ancien
};

// PHASE 2 — couleurs des 8 PIUWS-RÊVES du ZURG (table tranchée par le Game Director).
// On reconnaît un Piuw à sa FORME + son MOUVEMENT ; la couleur renforce le signal.
const COULEUR_PIUW_ZURG: Record<Reve, number> = {
  sauver:        0xffd580, // or
  creer:         0x7a5cff, // violet
  explorer:      0x00ffff, // cyan
  esperer:       0x80ff80, // vert
  proteger:      0xffffff, // blanc nacré
  comprendre:    0x7a5cff, // violet
  transmettre:   0xffd580, // or (corps blanc, pavillon or — cf. construction)
  "se-souvenir": 0xff0050, // rouge mémoire
};

// Matériaux toon des Piuws, UN par rêve, PARTAGÉS entre tous les Piuws de ce rêve
// (tous identiques en couleur → pas besoin d'en cloner un par Piuw : économe).
const matPiuwParReve = new Map<Reve, THREE.MeshToonMaterial>();
function matPiuw(reve: Reve): THREE.MeshToonMaterial {
  let m = matPiuwParReve.get(reve);
  if (!m) {
    m = M.vert.clone();                       // reprend la rampe toon du Piuw vert
    m.color = new THREE.Color(COULEUR_REVE[reve]);
    matPiuwParReve.set(reve, m);
  }
  return m;
}

// Couleur du FOND DE SCÈNE (cf. ciel `bas` 0x0a0a1a / haut 0x04050d) : c'est elle
// qu'on peint dans le TROU DE VIDE au sol, pour que le décor « cesse d'exister »
// localement (le sol devient un morceau de vide, pas une tache noire ajoutée).
const COUL_VIDE = 0x05060d;

// Un nœud à l'écran : son volume + son halo + de quoi l'animer selon la vie `v`.
interface VisuNoeud {
  groupe: THREE.Group;
  halo: THREE.Sprite;
  ombre: THREE.Mesh;     // ombre de contact au sol : « pose » l'élément sur le terrain
  // Chaque PIÈCE effaçable = un matériau (corps toon OU contour BackSide), avec sa
  // PHASE propre → on fond/clignote chaque morceau SÉPARÉMENT (silhouette incomplète).
  // `mat`/`base` ne sont remplis que pour les corps toon (les contours n'ont pas de
  // couleur à délaver, juste une opacité à baisser). `op0` = opacité pleine d'origine.
  // `coeurRole` (arbre-cœur seulement) : tague la pièce comme feuillage/écorce pour
  // que sa couleur de BASE varie par STADE de vie (le délavage du Néant se cumule
  // par-dessus). Absent → couleur de base fixe (comportement habituel).
  peau: { material: THREE.Material; mat?: THREE.MeshToonMaterial;
          base?: THREE.Color; op0: number; phase: number;
          coeurRole?: RoleColore }[];
  trou: THREE.Mesh;      // disque de VIDE au sol : grandit quand le décor s'efface
  motes: THREE.Sprite[]; // motes pâles de DISSIPATION (pooling : créées une fois, recyclées)
  motePhase: number[];   // avancement ∈ [0,1[ de chaque mote dans son cycle de montée
  base: THREE.Vector3;
  type: NodeType;
  zone: number;          // 0 = zone A (jardin) · 1 = zone B (ZURG) — pour la révélation
  // RÉVÉLATION PROGRESSIVE (chantier UX 2) : `reveal` ∈ [0,1] masque l'élément dans la
  // brume. 0 = caché (invisible), 1 = pleinement présent. Il rejoint `revealCible` en
  // douceur (lerp dans majRevelation). Multiplie toutes les opacités du nœud dans
  // synchroniser(). Par défaut 1 (visible) ; on met 0 au départ pour la Maison / zone B.
  reveal: number;
  revealCible: number;
  // FEEDBACK DE DÉCLIN (chantier UX 5) : on rend PERCEPTIBLE qu'un nœud non acquis PERD la
  // vie qu'on lui a donnée (joueur éloigné). `vPrec` = vie de la frame précédente (pour
  // détecter la baisse) ; `declin` ∈ [0,1] = intensité lissée du déclin actif (désature +
  // assombrit + ralentit la respiration) ; `respPhase` = phase de respiration du halo, qui
  // avance MOINS VITE quand le nœud décline (l'« animation ralentit »).
  vPrec: number;
  declin: number;
  respPhase: number;
}

// Couleur DÉLAVÉE vers laquelle un élément tend en s'effaçant : un blanc froid /
// gris pâle (PAS un noir-gris). Mourant = la couleur QUITTE l'objet (il se vide,
// il pâlit), il ne se NOIRCIT pas.
const COUL_DELAVEE = new THREE.Color(0xb8c0d8);

// ── PALETTE PAR STADE des Cœurs de région encore en jeu (arbre / monument) ────
// Même grammaire : MORT terne/froid → DEMI → VIF éclatant, chaque élément GARDE sa
// couleur-signal (vert / violet) à pleine vie. On range chaque rôle dans une table
// {mort, demi, vif} ; `couleurStade()` interpole en deux temps (mort→demi sur le bas
// de v, demi→vif sur le haut). Le délavage du Néant se cumule par-dessus (la couleur
// calculée ici sert de couleur de BASE dans `peau`).
type RoleColore =
  | "feuille" | "ecorce"          // arbre : feuillage vert + écorce
  | "pierre"                      // monument : roche violette
  | "mur" | "toit"               // maison (R1) : torchis chaud + toit
  | "corolle"                     // phare-corolle (R2 cœur) : pétales cyan
  | "bloc";                       // chantier (R2 nœud) : blocs gris-violet
const PALETTE_STADE: Partial<Record<RoleColore, { mort: number; demi: number; vif: number }>> = {
  // ARBRE — signal vert. Mort = gris-vert froid / écorce violacée éteinte.
  feuille:    { mort: 0x46504e, demi: 0x6fae72, vif: 0x4fc77a },
  ecorce:     { mort: 0x3a3340, demi: 0x5e4540, vif: 0x7a5550 },
  // MONUMENT — signal violet #9a7cff / M.pierre #6a5c8c. Mort = pierre éteinte froide.
  pierre:     { mort: 0x33303f, demi: 0x534a72, vif: 0x6a5c8c },
  // MAISON — chaude à pleine vie (torchis ocre + toit terre), grise/froide éteinte.
  mur:        { mort: 0x55504a, demi: 0xa3886c, vif: 0xc9a07a },
  toit:       { mort: 0x46403c, demi: 0x6e4636, vif: 0x8a5a44 },
  // PHARE-COROLLE — pétales : ardoise froide éteinte (bouton) → cyan éclatant (sanctuaire).
  corolle:    { mort: 0x3a4750, demi: 0x39a6c0, vif: 0x49e6ff },
  // CHANTIER — froid gris-violet éparpillé → violet plus présent assemblé.
  bloc:       { mort: 0x3a3648, demi: 0x534a72, vif: 0x6a5c8c },
};
// Buffers de couleur réutilisés par rôle (pas d'alloc par frame).
const _coulStade = new THREE.Color();
const _mort = new THREE.Color(), _demi = new THREE.Color(), _vif = new THREE.Color();
/** Couleur de BASE d'un rôle selon la vie `v` (mort→demi sur [0.10,0.45], demi→vif sur [0.45,0.85]). */
function couleurStade(role: RoleColore, v: number, out: THREE.Color): THREE.Color {
  const p = PALETTE_STADE[role];
  if (!p) return out.set(0xffffff);
  const kDemi = smoothstep5(0.10, 0.45, v);
  const kVif  = smoothstep5(0.45, 0.85, v);
  _mort.setHex(p.mort); _demi.setHex(p.demi); _vif.setHex(p.vif);
  return out.copy(_mort).lerp(_demi, kDemi).lerp(_vif, kVif);
}
/** Devine le RÔLE coloré d'une pièce toon d'après le type de nœud + sa teinte d'origine.
 *  (Seules les pièces MeshToonMaterial passent ici.) */
function roleColore(type: NodeType, hex: number): RoleColore | undefined {
  if (type === "heart")    return hex === 0x4fc77a ? "feuille" : hex === 0x7a5550 ? "ecorce" : undefined;
  if (type === "monument") return hex === 0x6a5c8c ? "pierre"  : undefined;   // toute la roche
  if (type === "maison")   return hex === 0xc9a07a ? "mur" : hex === 0x8a5a44 ? "toit" : undefined;
  if (type === "foyer")    return hex === 0x49e6ff ? "corolle" : undefined;   // pétales cyan
  if (type === "chantier") return hex === 0x6a5c8c ? "bloc" : undefined;
  return undefined;
}

// Population MAX de motes de dissipation par nœud (plafond perf, pas de fontaine).
const NB_MOTE = 4;

// ── MINUTAGE DU MOMENT D'ÉVOLUTION « le monde s'embrase » ────────────────────
// Une SEULE grande vague de ~3,5 s, en 4 temps qui se CHEVAUCHENT en fondus doux
// (jamais de coupure nette ni de clignotement). Bornes en secondes depuis le départ.
//   T1 INSPIR     0.00 → 0.40 : le halo se resserre (Phantom prend son souffle).
//   T2 NAISSANCE  0.40 → 1.00 : la flamme naît dans la poitrine et remonte.
//   T3 DÉBORDEMENT 1.00 → 2.20 : colonne + pluie + onde au sol + bloom au pic.
//   T4 LE MONDE RÉPOND 2.20 → 3.50 : les nœuds proches s'illuminent, puis repos.
const SEQ_INSPIR_FIN  = 0.40;
const SEQ_NAISS_FIN   = 1.00;
const SEQ_DEBORD_DEB  = 1.00;
const SEQ_DEBORD_FIN  = 2.20;
const SEQ_REPONSE_DEB = 2.20;
const SEQ_FIN         = 3.50;
// Plafond DUR du nombre de gouttes de pluie (sécurité perf).
const NB_PLUIE = 84;

export class Renderer3D {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private composer!: EffectComposer;        // chaîne de post-traitement
  private bloom!: UnrealBloomPass;          // halo lumineux autour de ce qui brille
  private grade!: ShaderPass;               // étalonnage couleur (saturation Néant↔Vie)
  private vignette!: ShaderPass;            // léger assombrissement des coins (cadrage)
  private readonly key: THREE.DirectionalLight;
  private readonly rim: THREE.DirectionalLight;
  private readonly amb: THREE.AmbientLight;
  private readonly hemi: THREE.HemisphereLight;   // ambiance ciel/sol (volumes mieux lus)
  private readonly fill: THREE.DirectionalLight;   // déboucheur froid côté caméra
  private cielMat!: THREE.ShaderMaterial;   // pour éclaircir le ciel avec la progression

  private readonly noeuds = new Map<string, VisuNoeud>();
  // 🔧 DEBUG (lecture seule, visibles via window.__r3d) : état du NIVEAU 3 « essaimage »
  //   tempsEpanoui  = s cumulées où l'arbre-Cœur est resté épanoui (pilote l'essaimage).
  //   poussesVivantes = nombre de pousses-enfants actuellement nées autour de l'arbre.
  // Mis à jour chaque frame par animerFoyer()/essaimer() ; ne pilotent rien eux-mêmes.
  tempsEpanoui = 0;
  poussesVivantes = 0;
  private readonly phantom = creerPhantom();
  private readonly phantomHalo = faireHalo(2.6, 0x4ec8ff, 0.08);
  // VFX (chantier 3) : le « FILET DE LUMIÈRE » qui relie Phantom à la cible qu'il
  // illumine — créé à la 1re frame utile, orienté chaque frame (cf. majFilet).
  private filet?: THREE.Mesh;
  // ── PASSAGE BRAISE → VEILLEUSE (1re évolution de Phantom) ───────────────────
  // « La Lanterne habitée » : au TOUT PREMIER nœud éveillé de la partie, une
  // 1re flamme colorée s'allume SOUS la peau blanche translucide de Phantom, et
  // sa lumière de présence (le halo au sol) grandit d'un cran. Tout en fondu doux.
  //   flamme  : un sprite additif logé À L'INTÉRIEUR du groupe Phantom, entre le
  //             corps blanc et son contour → la couleur transparaît « sous la peau ».
  //   allumage: monte de 0 → 1 en ~2,5 s (jamais de flash/clignotement).
  //   halo cible : le rayon de présence vise une taille plus grande (lerp doux).
  private veilleuseFlamme?: THREE.Sprite;   // la 1re flamme (créée au 1er éveil)
  private veilleuseAllumage = 0;            // 0 = éteint → 1 = pleinement allumé
  private veilleuseHaloCible = 3.0;         // taille de présence visée (3.0 Braise → 4.6 Veilleuse)
  private veilleuseHaloBase = 3.0;          // taille LISSÉE réelle (avant resserrement d'inspir)
  // ── LE MOMENT D'ÉVOLUTION « le monde s'embrase » (séquence de ~3,5 s) ────────
  // Au 1er nœud éveillé, on ne se contente plus d'allumer une flamme : Phantom
  // RALLUME LE MONDE autour de lui. Une SEULE grande vague (montée puis descente,
  // jamais de clignotement), pilotée par cette horloge qui court de 0 → ~3,5 s.
  //   -1   = jamais déclenchée (au repos, rien à animer).
  //   ≥ 0  = temps écoulé depuis le déclenchement (avancé par dt dans rendre()).
  // Quand l'horloge dépasse SEQ_FIN, on retombe à l'état stable « Veilleuse »
  // (la flamme sous la peau persiste + le halo reste agrandi) et on fige l'horloge.
  private veilleuseSeq = -1;
  private veilleuseReve: Reve = "esperer";  // couleur du rêve qui a déclenché la séquence
  private veilleuseInspir = 0;              // T1 : fraction de resserrement du halo (0 → ~0.18)
  // Objets nés POUR la séquence (créés une fois dans allumerVeilleuse, animés ici) :
  private veilleuseBeam?: THREE.Mesh;        // (3a) colonne de lumière vers le ciel
  private veilleuseOnde?: THREE.Mesh;        // (3c) anneau au sol qui part des pieds
  private veilleuseTeinte?: THREE.Mesh;      // (3c) disque coloré qui RESTE (l'herbe ravivée)
  // (3b) PLUIE de couleur : pool de petits sprites additifs (≤ NB_PLUIE), trajectoire
  // parabolique. Pré-alloués → zéro allocation pendant la frame. Chaque goutte a sa
  // vitesse de départ (vx/vz horizontale, vy verticale) tirée une fois au déclenchement.
  private readonly veilleusePluie: THREE.Sprite[] = [];
  private readonly veilleusePluieVel: { vx: number; vy: number; vz: number }[] = [];
  // PHASE 2 « MONDE CONTINU » : DEUX îles coexistent (zone A à -DX, zone B à +DX), chacune
  // avec ses propres uniforms d'érosion (centrés sur SON Cœur) et sa propre couleur de sol.
  private readonly ileVisus: IleVisu[] = [];
  // « SOUFFLE COMMUN » du Zurg : la phase de respiration émise par le Phare-Corolle
  // (Cœur de zone B) ; les Piuws du Zurg s'y accrochent doucement (sync de proximité).
  // `souffleVie` = vitalité du Phare → le souffle se brise quand elle baisse.
  private soufflePhase = 0;
  private souffleVie = 0;
  // CONTENANCE DOUCE : `contenanceDehors` = de combien Phantom débordait du marchable
  // cette frame (0 = dedans) ; `contenanceCible` = le point du bord vers lequel on le
  // ramène. Le Veilleur (Piuw sauver) s'en sert pour RATTRAPER Phantom visiblement.
  private contenanceDehors = 0;
  private readonly contenanceCible = new THREE.Vector3();
  // Le VEILLEUR ÉLU (Piuw « sauver » le plus proche de Phantom dans la zone courante) :
  // seul lui fait le geste de garde/rattrapage ; les autres « sauver » restent calmes.
  private veilleurElu?: THREE.Group;
  // POOL de GLYPHES du Piuw « créer » : ~6 RUBANS violets épais recyclés (zéro alloc/frame).
  // Chacun : un Mesh (ruban de quads le long du chemin du glyphe) + son état. Le ruban est
  // construit en BILLBOARD (face caméra) au lancement ; révélé/effacé via setDrawRange.
  private readonly glyphes: {
    mesh: THREE.Mesh; pos: Float32Array;
    libre: boolean; t: number;
    pts: THREE.Vector2[]; ox: number; oy: number; oz: number;
    // base orthonormée du plan du glyphe (face caméra), figée au lancement :
    rx: number; ry: number; rz: number;        // axe « droite » (x local du signe)
    ux: number; uy: number; uz: number;        // axe « haut »  (y local du signe)
  }[] = [];
  private readonly glyEtincelles: THREE.Sprite[] = [];   // mini-étincelles au point final
  private glyphesInit = false;
  private glyDernierT = 0;                                // dernier temps (pour le dt des glyphes)
  private pont?: THREE.Group;                       // pont de pierre permanent entre les îles
  // RÉVÉLATION PROGRESSIVE (chantier UX 2) : le pont reste CACHÉ dans la brume tant que R1
  // n'est pas bien réveillée, puis « apparaît au fond ». pontMats = ses matériaux clonés
  // (rendus transparents) pour le fondre ; pontRevele ∈ [0,1] rejoint pontReveleCible.
  private pontMats: (THREE.Material & { opacity: number })[] = [];
  private pontRevele = 0;
  private pontReveleCible = 0;
  private biomes: THREE.Group[] = [];               // recoins-biomes du ZURG (décor pur, zone B)
  // RÉVÉLATION : matériaux clonés (transparents) des biomes du ZURG → on les fond dans la
  // brume avec le pont (l'autre rive émerge d'un seul tenant quand R1 se réveille).
  private biomeMats: (THREE.Material & { opacity: number })[] = [];
  private miroir?: Reflector;                      // sol-miroir de l'aperçu « Le reflet » (zone A)
  // APERÇUS du Néant à comparer : 0 = normal · 1 = « L'Appel » (horizon de lumière) ·
  // 2 = « Le reflet » (sol-miroir). Bascule au clavier (touches 1 / 2 / 0).
  private apercu = 0;
  // PHASE 1 : le sol au repos = HERBE ENDORMIE (vert-de-gris désaturé mais VIVANT), pas
  // une terre morte. Un peu plus vert/chaud que l'ancien #556149 pour qu'il « respire ».
  private readonly solTerne = new THREE.Color(0x5e6d4f);  // herbe endormie (crépuscule) — JARDIN (zone A)
  private readonly solVivant = new THREE.Color(0x66ad4c); // terrain plein de vie — JARDIN (zone A)
  // PHASE 2 : le ZURG (zone B, monde ouvert) a une palette de sol un peu plus OCRE/chaude,
  // pour qu'on sente la différence avec le jardin intime — sans relight brutal.
  private readonly solTerneZurg = new THREE.Color(0x6b6450);  // terre ocre endormie
  private readonly solVivantZurg = new THREE.Color(0x9aa052); // prairie ocre-doré vivante
  // Couleurs de BRUME pré-allouées (évite d'en créer une par frame). PHASE 1 « le monde
  // respire » : au repos, la brume n'est PLUS un mur noir-vide — c'est une brume de
  // CRÉPUSCULE présente (bleu nuit doux) qui laisse voir l'horizon. La vie la réchauffe.
  private readonly fogCrepuscule = new THREE.Color(0x10182c); // Néant intense : crépuscule, PAS le vide
  private readonly fogTiede = new THREE.Color(0x101732);  // état neutre / léger
  private readonly fogVivant = new THREE.Color(0x223a5a); // vie revenue : aube qui réchauffe

  // Engrammes (poussière de souvenirs) + Piuws temporaires + flashs d'éveil.
  private readonly engrammes: THREE.Points;
  private readonly posEngr: Float32Array;
  private readonly vitEngr: Float32Array;
  // Association objet-logique → son volume 3D (créés/détruits selon les systèmes).
  // PHASE 2 : UN map par ZONE (chaque zone a son propre PiuwSystem/DoublesSystem) →
  // synchroniser une zone ne supprime pas les volumes de l'autre.
  private readonly piuwMesh: Map<Piuw, THREE.Group>[] = [new Map(), new Map()];
  private readonly doubleMesh: Map<DoubleAttention, THREE.Sprite>[] = [new Map(), new Map()];
  private introGrp?: THREE.Group;            // le Piuw perdu de la scène d'intro
  private introMat?: THREE.MeshToonMaterial; // sa couleur de corps (gris → vert quand sauvé)
  private introMot?: THREE.Sprite;           // bulle d'onomatopée (« Piu…? » / « Piuw ! ») au-dessus de lui
  private introMotDernier: string | null = null; // dernier mot rendu (évite de refaire la texture)
  private introFil?: THREE.Line;             // fil de lumière Phantom→Piuw pendant le sauvetage (causalité)
  // ── SÉQUENCE DE FIN « Le Don » (climax joué ~9 s, cf. beat-sheet narratif) ──
  // Phantom marche au Cœur → se dissout dedans (sa lumière passe dans le monde) →
  // le monde reste lumineux SANS lui → écran de clôture sobre.
  private finSeq = -1;                       // minuteur de la séquence (-1 = inactive)
  private finEmbrase = false;                // l'embrasement (grandEveil) n'est déclenché qu'une fois
  private finCoeur2D: Vec2 = { x: 160, y: 144 }; // le Cœur en coord. monde (pour l'embrasement)
  private finCoeurDx = 0;                        // décalage 3D de la zone du Cœur du climax
  private readonly finCoeur3D = new THREE.Vector3();   // cible 3D de la marche
  private readonly finDepart = new THREE.Vector3();    // position de Phantom au début
  private finMats: THREE.Material[] = [];    // matériaux CLONÉS de Phantom (pour le fondre SEUL)
  private finRestore: { mesh: THREE.Mesh; mat: THREE.Material }[] = []; // originaux à remettre après
  private readonly flashs: { halo: THREE.Sprite; vie: number }[] = [];
  // Anneaux de lumière du GRAND ÉVEIL (vagues qui s'étendent depuis le Cœur).
  private readonly anneaux: { mesh: THREE.Mesh; vie: number; max: number }[] = [];
  private beam?: THREE.Mesh;                  // colonne de lumière du grand Éveil
  private celebration = 0;                    // minuteur d'embellie après l'Éveil final

  // Déplacement de Phantom au clavier (Z Q S D / flèches) → le « regard » = sa position.
  private readonly touches: Record<string, boolean> = {};
  private regardMonde: Vec2 | null = null;
  // ILLUMINATION : main3d nous dit si l'illumination est ACTIVE (touche tenue +
  // réserve de lumière dispo) et le niveau de lumière, pour le feedback du halo.
  private illumineActif = false;
  private niveauLumiere = 1;
  private readonly horloge = new THREE.Clock();
  // Horodatage du dernier `synchroniser` → durée écoulée (l'horloge `horloge` est
  // déjà consommée par `rendre`). Sert à faire monter/recycler les motes de dissipation.
  private dernierSync = performance.now();

  constructor(hote: HTMLElement) {
    // Caméra + rendu + contrôles souris.
    this.camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
    this.camera.position.set(0, 4.5, 11);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    // Tone mapping « cinéma » (ACES) : compresse joliment les hautes lumières au
    // lieu de les « cramer » → l'image respire et le bloom rend mieux.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    hote.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 1.1, 2);
    this.controls.minDistance = 4; this.controls.maxDistance = 22;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    // ── CHAÎNE DE POST-TRAITEMENT (la couche « cinéma ») ──────────────────────
    // 1) on rend la scène, 2) BLOOM : ce qui est lumineux déborde en halo doux,
    // 3) ÉTALONNAGE : on désature dans le Néant / on sature avec la vie,
    // 4) VIGNETTE : coins légèrement assombris pour cadrer le regard,
    // 5) OUTPUT : tone mapping + conversion couleur finale.
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight), BLOOM_BASE, 0.4, 0.90); // force, rayon, seuil
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(HueSaturationShader);
    this.grade.uniforms.saturation.value = 0.0;   // ajusté chaque frame selon la vie
    this.composer.addPass(this.grade);
    this.vignette = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, force: { value: 1.0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float force; varying vec2 vUv;
        void main(){ vec4 c=texture2D(tDiffuse,vUv);
          float d=distance(vUv, vec2(0.5));
          float v=smoothstep(0.8, 0.35, d);            // 1 au centre → 0 aux coins
          c.rgb *= mix(1.0, v, force * 0.5);
          gl_FragColor=c; }`,
    });
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());

    // Ciel en dégradé + brume (le Néant qui mange l'horizon).
    this.scene.fog = new THREE.Fog(0x101732, 12, 34);
    this.cielMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { haut: { value: new THREE.Color(0x04050d) },
        horizon: { value: new THREE.Color(0x1b2748) }, bas: { value: new THREE.Color(0x0a0a1a) },
        uNeant: { value: 0 } },   // ∈[0,1] : efface l'horizon → vide continu
      vertexShader: `varying vec3 vP; void main(){ vP=position;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      // PHASE 1 « le monde respire » : le ciel ne vire PLUS au noir-vide au repos. Quand
      // uNeant monte, il glisse seulement vers un CRÉPUSCULE doux (CIEL_CREPUSCULE), de
      // façon partielle (CIEL_GLISSE_MAX), et ne s'assombrit qu'à peine (CIEL_ASSOMBR_MAX)
      // → l'horizon reste présent ; raviver réchauffe/éclaircit le ciel.
      fragmentShader: `varying vec3 vP; uniform vec3 haut; uniform vec3 horizon; uniform vec3 bas;
        uniform float uNeant;
        void main(){ float h=normalize(vP).y;
          vec3 c=mix(horizon,haut,clamp(h,0.0,1.0)); c=mix(c,bas,clamp(-h,0.0,1.0));
          vec3 crepuscule = ${CIEL_CREPUSCULE};           // bleu nuit doux, PAS le noir
          c = mix(c, crepuscule, uNeant * ${CIEL_GLISSE_MAX.toFixed(2)});  // assoupit sans éteindre
          c *= (1.0 - uNeant * ${CIEL_ASSOMBR_MAX.toFixed(2)});            // à peine plus sombre
          gl_FragColor=vec4(c,1.0); }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), this.cielMat));

    // Lumières — mise en scène « clair de lune chaud ».
    // 1) Ambiance HÉMISPHÉRIQUE : ciel froid au-dessus, rebond chaud/vert du sol
    //    en dessous → les volumes ronds (Phantom, arbre, champignon) prennent du
    //    galbe au lieu d'être plats. C'est le gros gain de lisibilité.
    this.hemi = new THREE.HemisphereLight(0x8090c8, 0x2c3a26, 0.7);
    this.scene.add(this.hemi);
    // 2) Ambiance plate résiduelle, faible (juste pour que rien ne soit noir pur).
    this.amb = new THREE.AmbientLight(0x2a3050, 0.3);
    // 3) Lumière PRINCIPALE chaude (la lune/le soleil bas), bien placée pour
    //    sculpter les ombres douces du toon.
    this.key = new THREE.DirectionalLight(0xffe6c2, 2.1); this.key.position.set(-5, 8, 4);
    // 4) Lumière de CONTOUR froide derrière : liseré lumineux sur les silhouettes.
    this.rim = new THREE.DirectionalLight(0x6fd2ff, 0.85); this.rim.position.set(3, 2.5, -6);
    // 5) DÉBOUCHEUR froid côté caméra : empêche les ombres de devenir des trous noirs.
    this.fill = new THREE.DirectionalLight(0x9fb4e0, 0.3); this.fill.position.set(4, 3, 7);
    this.scene.add(this.amb, this.key, this.rim, this.fill);

    // ── PHASE 2 : LE MONDE CONTINU = DEUX ÎLES + UN PONT, dans la même scène. ────
    // Chaque île est un plateau toon (collines douces, bords qui retombent dans le vide),
    // cernée du contour #1A1D33, avec SES propres uniforms d'érosion (centrés sur SON Cœur)
    // et SA couleur de sol (terne→vif selon SA vie). Zone A (R1) à -DX, zone B (R2) à +DX.
    this.ileVisus.push(construireIle(this.scene, -DX, nouveauxErosionUniforms()));
    this.ileVisus.push(construireIle(this.scene, +DX, nouveauxErosionUniforms()));
    // PONT DE PIERRE PERMANENT qui enjambe la gorge → Phantom marche de A à B (le sol
    // marchable se LIT continu : îles + pont). Construit une fois, jamais animé.
    this.pont = construirePont();
    this.scene.add(this.pont);
    // RÉVÉLATION PROGRESSIVE : on CLONE les matériaux du pont (ils sont partagés par
    // défaut) et on les rend transparents → on pourra le fondre depuis la brume sans
    // toucher au reste du décor. Le pont démarre INVISIBLE (pontRevele = 0).
    this.pont.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.material) return;
      const clone = (mesh.material as THREE.Material).clone() as THREE.Material & { opacity: number };
      clone.transparent = true; clone.depthWrite = false; clone.opacity = 0;
      mesh.material = clone;
      this.pontMats.push(clone);
    });
    this.pont.visible = false;

    // « LE REFLET » (aperçu debug, touche 2) : miroir d'eau noire posé sur la ZONE A.
    // (Feature de comparaison ; non utilisée dans le parcours normal.)
    const miroirGeo = new THREE.CircleGeometry(13, 80);
    this.miroir = new Reflector(miroirGeo, {
      textureWidth: Math.max(2, innerWidth), textureHeight: Math.max(2, innerHeight),
      color: 0x9aa6c0,   // reflet un peu plus clair/saturé que le vrai (beauté « trop parfaite »)
    });
    this.miroir.rotation.x = -Math.PI / 2; this.miroir.position.set(-DX, 0.3, 0);
    this.miroir.visible = false; this.scene.add(this.miroir);
    // Greffe du MASQUE sur le shader du Reflector (ShaderMaterial → on édite les sources +
    // on ajoute nos uniforms AVANT la 1re compilation). Aucun asset, 100% rendu.
    const mm = this.miroir.material as THREE.ShaderMaterial;
    mm.transparent = true;
    mm.uniforms.uPhantom = { value: new THREE.Vector2(0, 0) };
    mm.uniforms.uNeantM = { value: 0 };
    mm.uniforms.uFremM = { value: 0 };
    mm.uniforms.uTimeM = { value: 0 };
    mm.vertexShader = mm.vertexShader
      .replace("varying vec4 vUv;", "varying vec4 vUv;\nvarying vec3 vWP;")
      .replace("vUv = textureMatrix * vec4( position, 1.0 );",
        "vUv = textureMatrix * vec4( position, 1.0 );\n vWP = (modelMatrix * vec4(position,1.0)).xyz;");
    mm.fragmentShader = mm.fragmentShader
      .replace("varying vec4 vUv;",
        "varying vec4 vUv;\nvarying vec3 vWP;\nuniform vec2 uPhantom; uniform float uNeantM; uniform float uFremM; uniform float uTimeM;")
      .replace("gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );", `
        vec3 refl = blendOverlay( base.rgb, color );
        // Distance horizontale à Phantom : le miroir RECULE près de toi (présence = délivrance).
        float dP = length(vWP.xz - uPhantom);
        // Frontière qui ONDULE (frémissement du Néant + petites vagues) → bord d'eau vivant.
        float bord = 4.5 + uFremM * 2.0 + sin(vWP.x * 0.5 + uTimeM) * 0.5 + cos(vWP.z * 0.5 - uTimeM) * 0.5;
        float noyade = smoothstep(bord, bord + 3.5, dP);   // 0 près de toi, 1 au loin négligé
        noyade *= (0.25 + 0.75 * uNeantM);                 // plus le Néant monte, plus ça gagne

        // ===== GARDE-FOU 1 : le reflet est BEAU mais MORT =====
        // Au cœur de la zone noyée, le reflet se fige en PORCELAINE FROIDE : trop parfait,
        // sans vie. On le désature vers un gris-bleu glacé + on pose un voile laiteux immobile
        // (l'image embaumée sous le verre). C'est ÇA le signal d'alarme : c'est sublime… et mort.
        float mort = smoothstep(0.2, 0.85, noyade);
        float lum = dot(refl, vec3(0.299, 0.587, 0.114));
        vec3 froid = mix(vec3(lum), vec3(0.62, 0.68, 0.80), 0.35);   // gris-bleu glacé
        refl = mix(refl, froid, mort * 0.7);
        refl = mix(refl, vec3(0.74, 0.78, 0.88), mort * 0.16);       // voile laiteux figé

        // ===== GARDE-FOU 3 : la DÉLIVRANCE — la présence de Phantom RIDE le miroir =====
        // Des rides concentriques partent de Phantom : là où elles passent, l'eau scintille
        // d'un bleu vivant et le reflet « casse » → le vrai monde remonte (le plus beau moment).
        float onde = sin(dP * 2.4 - uTimeM * 3.0);
        float ride = smoothstep(0.2, 1.0, onde) * exp(-dP * 0.16);   // forte près de toi, s'éteint au loin
        ride *= (1.0 - noyade);                                      // ne ride que le bord encore vivant
        refl += vec3(0.55, 0.80, 1.0) * ride * 0.30;                 // vie qui revient en bleu clair

        // ===== LISÉRÉ « mémoire » (#FF0050) : le vrai monde qui APPELLE à l'aide =====
        float rim = smoothstep(0.32, 0.5, noyade) * (1.0 - smoothstep(0.5, 0.68, noyade));
        rim *= 0.65 + 0.35 * sin(uTimeM * 2.0);   // le liseré PULSE doucement (un cœur qui bat)
        refl += vec3(1.0, 0.0, 0.31) * rim * 0.6; // fine ligne d'eau rouge (#FF0050), pas une nappe

        gl_FragColor = vec4(refl, noyade);                 // alpha = le miroir n'existe que là où ça se noie
      `);

    // Phantom (l'observateur) + son halo.
    this.phantom.add(this.phantomHalo); this.phantomHalo.position.y = 0.2;
    this.phantom.position.set(0, 0.95, 2);
    // Au départ, Phantom REGARDE déjà le Piuw perdu (front-gauche) → le joueur suit
    // le regard de son personnage, guidage gratuit sans texte.
    this.phantom.rotation.y = Math.atan2((120 - 160) / ECH, (172 - 144) / ECH - 2); this.scene.add(this.phantom);

    // Engrammes.
    const N = 150; this.posEngr = new Float32Array(N * 3); this.vitEngr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.posEngr[i * 3] = (Math.random() - 0.5) * 34;
      this.posEngr[i * 3 + 1] = Math.random() * 11;
      this.posEngr[i * 3 + 2] = (Math.random() - 0.5) * 34;
      this.vitEngr[i] = 0.15 + Math.random() * 0.35;
    }
    const geoEngr = new THREE.BufferGeometry();
    geoEngr.setAttribute("position", new THREE.BufferAttribute(this.posEngr, 3));
    this.engrammes = new THREE.Points(geoEngr, new THREE.PointsMaterial({
      size: 0.18, map: texHalo, color: 0xbfeaff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(this.engrammes);

    // Écoute du clavier (déplacement de Phantom) et du redimensionnement.
    addEventListener("keydown", (e) => { this.touches[e.code] = true; });
    addEventListener("keyup", (e) => { this.touches[e.code] = false; });
    // Bascule des APERÇUS du Néant (comparaison) — par POSITION de touche (AZERTY compris) :
    //   1 = « L'Appel » (horizon de lumière) · 2 = « Le reflet » (sol-miroir) · 0 = normal.
    addEventListener("keydown", (e) => {
      if (e.code === "Digit1") this.apercu = 1;
      else if (e.code === "Digit2") this.apercu = 2;
      else if (e.code === "Digit0") this.apercu = 0;
    });
    addEventListener("resize", () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
  }

  /**
   * Construit les volumes 3D des nœuds d'UNE zone (île), décalés à son offset 3D.
   * @param noeuds nœuds de la région de cette zone.
   * @param zone   index 0 (A / -DX) ou 1 (B / +DX) → donne le décalage `dx` et les
   *               uniforms d'érosion de l'île (centrés sur SON Cœur).
   */
  preparerDecor(noeuds: AttentionNode[], zone: number): void {
    const ile = this.ileVisus[zone];
    const dx = ile ? ile.dx : 0;
    // Seuls « monument » et « heart » existent encore dans les données de région (la
    // fleur et le champignon-cristal ont été retirés) → fabrique PARTIELLE. Si un type
    // inconnu apparaissait, on retombe sur l'arbre (jamais de plantage).
    const fabrique: Partial<Record<NodeType, () => THREE.Group>> = {
      monument: creerPenseur, heart: creerArbre,
      maison: creerMaison, foyer: creerFoyer, chantier: creerChantier,
    };
    // CENTRE DU CŒUR (l'arbre "heart" en zone A, le "foyer" commun en zone B) en
    // coordonnées MONDE 3D (xz) : le point que l'érosion de CETTE île épargne en dernier.
    const coeur = noeuds.find((n) => n.type === "heart" || n.type === "foyer");
    const cPos = coeur ? mondeVers3D(coeur.pos, 0, dx) : new THREE.Vector3(dx, 0, 0);
    if (ile) ile.erosion.uCoeur.value.set(cPos.x, cPos.z);
    for (const n of noeuds) {
      const groupe = (fabrique[n.type] ?? creerArbre)();   // repli sûr si type inconnu
      const base = mondeVers3D(n.pos, 0, dx);
      groupe.position.copy(base);
      // « Vue de face » : on tourne l'élément pour qu'il nous fasse FACE (branches de l'Arbre,
      // façade de la Maison…) au lieu de nous montrer son profil (cf. ORIENT_VERS_CAMERA).
      groupe.rotation.y = ORIENT_VERS_CAMERA;
      const estCoeur = n.type === "heart" || n.type === "foyer";   // les deux Cœurs (A=arbre, B=foyer)
      const halo = faireHalo(estCoeur ? 4 : 2.5, COULEUR[n.type] ?? COULEUR_DEFAUT, 0.0);
      halo.position.y = 1.2; groupe.add(halo);
      // OMBRE DE CONTACT : un disque sombre flou posé à plat sous l'élément. C'est
      // LE détail qui « pose » un perso cartoon sur le sol (sinon il flotte). Mélange
      // normal (il assombrit), pas additif. Reste à plat au sol, hors du groupe scalé.
      const ombre = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texHalo, color: 0x0a0c16, transparent: true,
          opacity: 0.5, depthWrite: false }));
      ombre.rotation.x = -Math.PI / 2; ombre.position.set(base.x, 0.04, base.z);
      this.scene.add(ombre);
      this.scene.add(groupe);
      // On donne à CET élément ses PROPRES matériaux (les modèles partagent les mêmes
      // par défaut) → on pourra le dématérialiser SEUL en l'effaçant. On clone AUSSI
      // chaque contour (sinon le contour sombre GLOBAL resterait visible sur un corps
      // devenu fantôme = moche). Chaque pièce reçoit une PHASE pour clignoter à part.
      const peau: VisuNoeud["peau"] = [];
      groupe.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const m = mesh.material;
        if (m instanceof THREE.MeshToonMaterial) {
          const clone = m.clone();
          mesh.material = clone;
          // On TAGUE chaque pièce colorée par sa teinte d'origine + le type de nœud,
          // pour faire varier sa couleur de BASE selon le stade de vie (palette qui
          // grise à v bas). Le délavage du Néant se cumule par-dessus.
          const coeurRole = roleColore(n.type, clone.color.getHex());
          peau.push({ material: clone, mat: clone, base: clone.color.clone(),
                      op0: 1, phase: Math.random() * TAU, coeurRole });
        } else if (m === contourMat) {
          // Contour (face arrière sombre) : son propre clone → on baisse SON opacité
          // en parallèle du corps pour que la silhouette s'efface d'un seul tenant.
          const clone = m.clone();
          clone.transparent = true; clone.depthWrite = false;
          mesh.material = clone;
          peau.push({ material: clone, op0: 1, phase: Math.random() * TAU });
        }
      });
      // TROU DE VIDE : un disque à plat au sol, peint à la couleur du FOND DE SCÈNE
      // (mélange NORMAL, bords doux via texHalo). Invisible quand le nœud va bien ;
      // il grandit/s'opacifie avec la détresse → le décor « cesse d'exister » ici.
      const trou = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: texHalo, color: COUL_VIDE, transparent: true,
          opacity: 0, depthWrite: false }));
      trou.rotation.x = -Math.PI / 2; trou.position.set(base.x, 0.06, base.z);
      this.scene.add(trou);
      // MOTES de DISSIPATION (pooling) : quelques petits halos blanc froid créés UNE
      // FOIS, recyclés en boucle. Invisibles au repos ; ils montent et s'évaporent
      // seulement quand la détresse est notable (rare, lent — pas une fontaine).
      const motes: THREE.Sprite[] = [];
      const motePhase: number[] = [];
      for (let i = 0; i < NB_MOTE; i++) {
        const s = faireHalo(0.22, 0xd4dcf0, 0);
        s.position.set(base.x, 0, base.z);
        this.scene.add(s);
        motes.push(s);
        motePhase.push(Math.random());          // démarrage étalé dans le cycle
      }
      this.noeuds.set(n.id, {
        groupe, halo, ombre, peau, trou, motes, motePhase, base, type: n.type,
        zone, reveal: 1, revealCible: 1,
        vPrec: n.v, declin: 0, respPhase: Math.random() * TAU,
      });
    }
  }

  /**
   * PHASE 2 : (RE)CONSTRUIT le MONDE CONTINU en une fois — les DEUX zones (A=R1, B=R2)
   * dans la même scène, chacune à son décalage. Appelé au démarrage et au « rejouer ».
   * Vide tout l'ancien décor + recentre Phantom en zone A, puis bâtit les deux décors.
   * On RÉUTILISE le même moteur (pas de nouveau WebGL, pas de ré-ajout d'écouteurs).
   */
  construireMondeContinu(noeudsA: AttentionNode[], noeudsB: AttentionNode[]): void {
    // 1) Retirer les nœuds de l'ancien monde (groupe + ombre + trou + motes + pousses).
    for (const vu of this.noeuds.values()) {
      this.scene.remove(vu.groupe, vu.ombre, vu.trou);
      for (const m of vu.motes) this.scene.remove(m);
      // NIVEAU 3 : l'arbre peut avoir essaimé des POUSSES + une graine en vol, posées
      // sur la SCÈNE (hors de son groupe) → on les retire aussi (anti-fuite).
      const arbre = vu.groupe.userData.arbre as ArbreVisu | undefined;
      if (arbre) {
        for (const po of arbre.pousses) this.scene.remove(po.grp, po.tache);
        arbre.pousses.length = 0;
        if (arbre.graine) { this.scene.remove(arbre.graine.sprite); arbre.graine = undefined; }
      }
    }
    this.noeuds.clear();
    // 2) Retirer les systèmes vivants (volumes temporaires).
    for (const m of this.piuwMesh) { for (const g of m.values()) this.scene.remove(g); m.clear(); }
    for (const m of this.doubleMesh) { for (const s of m.values()) this.scene.remove(s); m.clear(); }
    // GLYPHES du Piuw « créer » (pool partagé) : on libère ceux en cours (au « rejouer »).
    for (const g of this.glyphes) { g.libre = true; g.mesh.visible = false; g.mesh.geometry.setDrawRange(0, 0); }
    for (const s of this.glyEtincelles) { s.userData.vie = 0; s.material.opacity = 0; }
    if (this.introGrp) { this.scene.remove(this.introGrp); this.introGrp = undefined; }
    this.introMat = undefined;
    if (this.introMot) { this.scene.remove(this.introMot);
      (this.introMot.material as THREE.SpriteMaterial).map?.dispose();
      this.introMot = undefined; this.introMotDernier = null; }
    if (this.introFil) { this.scene.remove(this.introFil); this.introFil = undefined; }
    // Fin du climax « Le Don » : Phantom redevient visible, la caméra est rendue au joueur.
    this.finSeq = -1; this.finEmbrase = false;
    for (const r of this.finRestore) r.mesh.material = r.mat;   // remet les matériaux d'origine
    for (const c of this.finMats) c.dispose();                  // libère les clones du fondu
    this.finRestore = []; this.finMats = [];
    this.controls.enabled = true;
    // 3) Retirer les effets d'éveil en cours.
    for (const f of this.flashs) this.scene.remove(f.halo);
    this.flashs.length = 0;
    for (const a of this.anneaux) this.scene.remove(a.mesh);
    this.anneaux.length = 0;
    if (this.beam) { this.scene.remove(this.beam); this.beam = undefined; }
    this.celebration = 0;
    // Si la séquence « le monde s'embrase » est en cours (changement de région
    // pendant l'animation), on retire proprement ses objets (zéro fuite).
    this.veilleuseSeq = -1;
    this.veilleuseInspir = 0;
    if (this.veilleuseBeam)   { this.scene.remove(this.veilleuseBeam);   this.veilleuseBeam = undefined; }
    if (this.veilleuseOnde)   { this.scene.remove(this.veilleuseOnde);   this.veilleuseOnde = undefined; }
    if (this.veilleuseTeinte) { this.scene.remove(this.veilleuseTeinte); this.veilleuseTeinte = undefined; }
    for (const g of this.veilleusePluie) this.scene.remove(g);
    this.veilleusePluie.length = 0;
    this.veilleusePluieVel.length = 0;
    // L'ÉVOLUTION de Phantom (Braise→Veilleuse) se REJOUE à chaque région/partie :
    // on éteint la flamme sous sa peau et on ramène sa présence à « La Braise ».
    // (Sans ça, le garde idempotent d'allumerVeilleuse bloquait tout re-déclenchement.)
    if (this.veilleuseFlamme) { this.phantom.remove(this.veilleuseFlamme); this.veilleuseFlamme = undefined; }
    this.veilleuseAllumage = 0;
    this.veilleuseHaloCible = 3.0;
    this.veilleuseHaloBase = 3.0;
    // 4) Recentrer l'observateur et la caméra en ZONE A : le joueur commence là, découvre
    //    R1, puis traverse le pont vers R2 (zone B). Le Piuw perdu d'intro est en A.
    // ORIENTATION « VERS L'AVANT » (chantier UX 3) : VUE DE FACE. L'axe du voyage va de la
    // zone A (−x) vers le pont puis la zone B (+x), tout aligné sur la ligne z=0. On pose
    // Phantom SUR cette ligne (z=0), un peu en retrait (x=−20) pour avoir le Piuw, l'Arbre
    // puis la Maison DEVANT lui, et la caméra DERRIÈRE lui regardant +x. Le joueur AVANCE
    // dans le monde et découvre les éléments un par un (révélation par le mouvement) — au
    // lieu de tout voir d'un coup. Le monde 3D n'est PAS reconstruit ; seul le départ change.
    this.phantom.position.set(-23, 0.95, 0);
    this.phantom.rotation.y = Math.PI / 2;          // de dos, face au voyage (+x)
    this.camera.position.set(-32, 4.6, 0);          // pile derrière Phantom, surélevée
    this.controls.target.set(-23, 1.4, 0);          // vise Phantom (regarde vers +x)
    // 5) Bâtir le décor des DEUX zones (chacune à son offset).
    this.preparerDecor(noeudsA, 0);
    this.preparerDecor(noeudsB, 1);
    // RÉVÉLATION PROGRESSIVE (chantier UX 2) : au (re)départ, on CACHE ce qui n'est pas
    // encore pertinent. Seul l'Arbre (Cœur de zone A) reste visible. La Maison émergera
    // quand l'Arbre revivra ; le pont + toute la zone B émergeront quand R1 sera réveillée.
    for (const vu of this.noeuds.values()) {
      const cache = vu.zone === 1 || vu.type === "maison";
      vu.reveal = cache ? 0 : 1;
      vu.revealCible = vu.reveal;
    }
    this.pontRevele = 0; this.pontReveleCible = 0;
    if (this.pont) this.pont.visible = false;
    // L'AUTRE RIVE (île B = terrain de la zone B) démarre DISSOUTE dans la brume.
    const ileB = this.ileVisus[1];
    if (ileB) {
      ileB.solMatToon.transparent = true; ileB.solMatToon.depthWrite = false; ileB.solMatToon.opacity = 0;
      ileB.solContourMat.transparent = true; ileB.solContourMat.depthWrite = false; ileB.solContourMat.opacity = 0;
      ileB.sol.visible = false; ileB.solContour.visible = false;
    }
    // 6) Poser les recoins-biomes du ZURG (zone B) — la « roue des rêves » autour du centre.
    this.construireBiomesZurg();
  }

  /**
   * « LA ROUE DES RÊVES » : pose les recoins-biomes en couronne autour du centre du ZURG
   * (zone B, +DX). Chaque recoin est du DÉCOR pur (les Piuws y vivent ; zéro effet sur
   * l'équilibrage). Étape PILOTE : seuls 2 recoins les plus contrastés sont bâtis (Espérer
   * au Nord, Explorer à l'Est) pour juger le procédé à l'écran ; les 6 autres viendront
   * se brancher sur cette même boucle. Angle 0°=Nord, sens horaire (cf. conception).
   */
  construireBiomesZurg(): void {
    for (const b of this.biomes) this.scene.remove(b);
    this.biomes.length = 0;
    this.biomeMats.length = 0;
    const recoins: { build: () => THREE.Group; angleDeg: number }[] = [
      { build: creerPenteQuiMonte, angleDeg: 0 },     // Espérer — Nord (la pente qui monte)
      { build: creerPromontoireVente, angleDeg: 90 }, // Explorer — Est  (le promontoire venté)
    ];
    for (const r of recoins) {
      const a = (r.angleDeg * Math.PI) / 180;
      const g = r.build();
      // Position en couronne : centre zone B (+DX) + rayon dans la direction de l'angle.
      g.position.set(DX + Math.sin(a) * R_RECOIN, 0, -Math.cos(a) * R_RECOIN);
      // Oriente le recoin pour que son « extérieur » (+Z local) pointe loin du centre.
      g.rotation.y = Math.PI - a;
      // RÉVÉLATION : on CLONE les matériaux du biome (rendus transparents) → on pourra le
      // fondre dans la brume avec le pont, sans toucher au décor partagé. Caché au départ.
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.material) return;
        const clone = (mesh.material as THREE.Material).clone() as THREE.Material & { opacity: number };
        clone.transparent = true; clone.depthWrite = false; clone.opacity = 0;
        mesh.material = clone;
        this.biomeMats.push(clone);
      });
      g.visible = false;
      this.scene.add(g);
      this.biomes.push(g);
    }
  }

  /** Met le visuel des nœuds à jour selon leur VIE `v` (le cœur de la démo). */
  synchroniser(noeuds: AttentionNode[]): void {
    // Temps écoulé depuis le dernier appel → fait monter/recycler les motes.
    const maintenant = performance.now();
    const dt = Math.min(0.05, (maintenant - this.dernierSync) / 1000);
    this.dernierSync = maintenant;
    const t = maintenant / 1000;

    // 🔧 DEBUG (rendu seulement, n'altère PAS la logique) : si `window.__forceV` est
    // un nombre, on l'utilise À LA PLACE de la vie réelle pour FIGER un stade et
    // l'observer. Le moteur (Region.update) ramène sinon v en ~1 frame → impossible
    // de voir le stade 1 avec `coeur.v = 0.05`. Mets `window.__forceV = null` pour relâcher.
    const forceV = (window as unknown as { __forceV?: number | null }).__forceV;
    const figer = typeof forceV === "number";

    for (const n of noeuds) {
      const vu = this.noeuds.get(n.id);
      if (!vu) continue;
      // RÉVÉLATION PROGRESSIVE : `rev` ∈[0,1] masque l'élément dans la brume. Entièrement
      // caché (≈0) → on coupe son groupe/ombre et on saute toute l'animation (cheap + net).
      // Sinon `rev` multiplie toutes ses opacités plus bas (fondu d'émergence).
      const rev = vu.reveal;
      vu.groupe.visible = rev > 0.004;
      vu.ombre.visible = rev > 0.004;
      if (rev <= 0.004) {
        (vu.trou.material as THREE.MeshBasicMaterial).opacity = 0;
        for (const s of vu.motes) s.material.opacity = 0;
        continue;
      }
      // Vie EFFECTIVE pour le rendu : réelle, sauf si l'on fige un stade (debug).
      const v = figer ? Math.max(0, Math.min(1, forceV as number)) : n.v;

      // FEEDBACK DE DÉCLIN (chantier UX 5) : un nœud NON acquis qui PERD de la vie depuis
      // la frame d'avant → `declin` monte (et retombe quand la vie se stabilise/remonte).
      // Multiplié par dt^-1 pour être indépendant du framerate ; lissé pour rester doux.
      // Les nœuds éveillés (acquis) ne déclinent pas → pas de fausse alerte.
      const chute = dt > 0 ? Math.max(0, (vu.vPrec - v) / dt) : 0;   // vitesse de perte (/s)
      const cibleDeclin = n.eveille ? 0 : Math.min(1, chute * 30);   // 0 si acquis
      vu.declin += (cibleDeclin - vu.declin) * Math.min(1, dt * 4);  // lissage ~0.25 s
      vu.vPrec = v;
      const declin = vu.declin;
      // L'« animation ralentit » : la respiration du halo avance MOINS VITE quand ça décline.
      vu.respPhase += dt * 1.8 * (1 - 0.7 * declin);

      // Plus le nœud est vivant, plus il est grand, dressé et lumineux.
      const ech = 0.45 + v * 0.75;
      vu.groupe.scale.setScalar(ech);

      // DÉTRESSE LOCALE (∈[0,1]) : un nœud sous ~0.4 de vie commence à s'EFFACER, même
      // si la région va bien. C'est la PEUR DE PERDRE rendue visible (logique pure
      // déjà testée dans core/neant.ts). À 0.4 = aucune ; à 0 = maximale.
      const det = detresseLocale(v);
      // État MOURANT : sous ~0.18 de vie, le nœud se fane (penche) — il « lâche » le
      // monde. Dès qu'on le ravive, il se redresse.
      const mort = Math.max(0, Math.min(1, (0.18 - v) / 0.18));

      // ── ARBRE-CŒUR : ÉVOLUTION EN 3 STADES VISIBLES (forme, pas que couleur) ──
      // On anime ICI les pièces pilotables rangées dans `groupe.userData.arbre` :
      //   • feuillage qui ÉCLÔT une boule à la fois (seuil de naissance sur v),
      //   • branches qui se DÉPLOIENT (poussent depuis le tronc),
      //   • palette mort→jeune→vif (on écrit la couleur de BASE, le Néant délave après),
      //   • lucioles dont la présence monte par stade.
      // Tout est CONTINU (interpolé) → pas de reconstruction, transitions lisses.
      const arbre = vu.type === "heart"
        ? (vu.groupe.userData.arbre as ArbreVisu | undefined) : undefined;
      if (arbre) {
        // 1) FEUILLAGE : chaque boule gonfle de 0 à sa taille pleine entre `seuil` et
        //    `seuil+0.15`. Les seuils croissants (bas → haut) donnent l'éclosion en cascade.
        for (const f of arbre.feuilles) {
          const k = smoothstep5(f.seuil, f.seuil + 0.15, v);     // 0 = pas née, 1 = pleine
          const s = Math.max(0.0001, k);                          // jamais 0 pile (évite la matrice nulle)
          f.mesh.scale.setScalar(s);
          if (f.contour) f.contour.scale.setScalar(s * 1.07);     // le contour suit (1.07 = ratio d'origine)
        }
        // 2) BRANCHES : la 1re sort dès v≈0.18 (réveil), la 2de vers v≈0.30. Elles
        //    « poussent » via leur scale (0→1), pas d'apparition brutale.
        const pousseBranche = [
          smoothstep5(0.18, 0.40, v),
          smoothstep5(0.30, 0.52, v),
        ];
        arbre.branches.forEach((b, i) => {
          const s = Math.max(0.0001, 0.2 + 0.8 * (pousseBranche[i] ?? 0));
          b.scale.setScalar(s);
        });
        // 3) LUCIOLES : 0 (mort) → 1 timide (jeune) → 3 vives (épanoui). Opacités douces.
        const opLuci = [
          0.05 + 0.55 * smoothstep5(0.35, 0.70, v),   // la 1re luciole (apparaît au réveil)
          0.60 * smoothstep5(0.62, 0.80, v),          // 2e (pleine vie)
          0.60 * smoothstep5(0.68, 0.86, v),          // 3e (pleine vie)
        ];
        arbre.lucioles.forEach((l, i) => { l.material.opacity = opLuci[i] ?? 0; });

        // 4) « LE FOYER HABITÉ » + NIVEAUX 2/3 (chant, multiplication, essaimage) :
        //    logique riche déportée dans animerFoyer() pour garder ce bloc lisible.
        this.animerFoyer(vu, arbre, v, dt, t);
      }

      // ── MONUMENT + PHASE 2 (maison / foyer commun / chantier) : 3 stades par v ──
      this.animerMonument(vu, v);
      this.animerMaison(vu, v, t);
      this.animerFoyerCommun(vu, v, t);
      this.animerChantier(vu, v, t);

      // PALETTE PAR STADE (TOUS les Cœurs) : on écrit la couleur de stade dans la
      // couleur de BASE des pièces taguées → la boucle d'effacement ci-dessous part
      // de CETTE couleur (grise à v bas) puis applique le délavage du Néant par-dessus.
      for (const p of vu.peau) {
        if (p.coeurRole) couleurStade(p.coeurRole, v, p.base ?? _coulStade);
      }

      // ── « L'EFFACEMENT » : le nœud ne se NOIRCIT pas, il se DÉMATÉRIALISE ──────
      // Le Néant n'ajoute rien : il RETIRE. Deux mouvements se cumulent :
      //   1) DÉLAVAGE : la couleur quitte l'objet, qui pâlit vers un blanc froid.
      //   2) TRANSPARENCE : l'objet devient fantôme (opacité globale 1 → ~0.3),
      //      ET chaque pièce CLIGNOTE à sa propre phase (silhouette incomplète :
      //      certains morceaux disparaissent par instants → « lutte pour exister »).
      // Pâlissement = max(mort, détresse de bas niveau, DÉCLIN actif). Le déclin ajoute la
      // désaturation DÈS que la vie baisse (même au-dessus du seuil de détresse) → on VOIT
      // qu'on est en train de perdre ce qu'on a donné (leçon d'attachement, §10).
      const delave = Math.max(mort * 0.85, det * 0.55, declin * 0.6);  // dosage du pâlissement
      // opGlobale = dématérialisation (détresse) × révélation (émergence de la brume).
      const opGlobale = (1 - 0.7 * det) * rev;            // 1 (sain, révélé) → 0.3 / 0 (caché)
      const enFondu = rev < 0.999;                        // en train d'émerger → transparence active
      for (const p of vu.peau) {
        // 1) délavage de couleur (corps toon seulement ; les contours n'ont pas de teinte).
        if (p.mat && p.base) p.mat.color.copy(p.base).lerp(COUL_DELAVEE, delave);
        // 2) opacité = pleine × clignotement propre à la pièce × dématérialisation globale.
        const osc = oscillationPiece(t, p.phase, det);
        const op = p.op0 * opGlobale * osc;
        const mraw = p.material as THREE.MeshToonMaterial | THREE.MeshBasicMaterial;
        // On n'active la transparence (coûteuse au tri) QUE lorsqu'il y a effacement OU fondu.
        if (det > 0.001 || mort > 0.001 || enFondu) {
          mraw.transparent = true; mraw.depthWrite = false; mraw.opacity = op;
        } else if (mraw.transparent) {
          mraw.opacity = 1; mraw.transparent = false; mraw.depthWrite = true;
        }
        mraw.needsUpdate = false; // on ne change que des uniformes simples → pas de recompile
      }
      // VOÛTE / REDRESSEMENT : les autres nœuds ne penchent qu'en mourant (mort*0.22).
      // L'ARBRE, lui, se VOÛTE progressivement quand il est peu vivant et se DRESSE
      // quand on le ravive — la silhouette « pousse » de tordue (v≈0) à droite (v≈1).
      if (arbre) {
        const voute = (1 - smoothstep5(0.10, 0.70, v)) * 0.28;     // 0.28 (affaissé) → 0 (dressé)
        vu.groupe.rotation.z = Math.max(voute, mort * 0.22);
      } else {
        vu.groupe.rotation.z = mort * 0.22;        // il se voûte/fane
      }

      // HALO + APPEL DU DÉBUT : un nœud encore endormi « respire » pour attirer l'œil
      // (cf. promesse du titre : « là où ton regard se pose, la vie revient »).
      // L'appel cesse dès l'éveil.
      let haloOp = 0.12 + v * 0.55;
      if (!n.eveille && v < 0.3) {
        // Respiration via respPhase (qui RALENTIT quand le nœud décline → §5).
        const appel = 0.5 + 0.5 * Math.sin(vu.respPhase);
        haloOp += appel * 0.16 * (1 - v / 0.3);
      }
      // DÉCLIN : la lumière BAISSE (le halo faiblit) quand on perd ce qu'on a donné.
      haloOp *= (1 - 0.55 * declin);
      vu.halo.material.opacity = haloOp * rev;   // × révélation (halo caché tant que dans la brume)

      // OMBRE DE CONTACT : suit la taille de l'élément. Elle DISPARAÎT avec la détresse
      // (et la mort) : un nœud qui s'efface ne touche plus terre, il « cesse d'appartenir
      // au monde » → plus d'ancrage au sol.
      const estCoeur = vu.type === "heart" || vu.type === "foyer";   // Cœurs A (arbre) + B (foyer)
      const taille = (estCoeur ? 3.6 : 2.4) * ech;
      vu.ombre.scale.set(taille, taille, 1);
      const ancrage = 1 - Math.max(mort * 0.85, det * 0.9);
      (vu.ombre.material as THREE.MeshBasicMaterial).opacity = 0.5 * ancrage * rev;

      // TROU DE VIDE : un disque de fond-de-scène qui grandit/s'opacifie sous le nœud
      // effacé → le décor lui-même cesse d'exister localement. Nul à détresse nulle.
      const trouF = trouVide(det);
      const rTrou = (estCoeur ? 5.0 : 3.2) * trouF;
      vu.trou.scale.set(rTrou, rTrou, 1);
      (vu.trou.material as THREE.MeshBasicMaterial).opacity = 0.85 * trouF * rev;

      // DISSIPATION : motes pâles qui montent lentement et s'évaporent en boucle,
      // UNIQUEMENT quand la détresse est notable. Pooling : on recycle les mêmes
      // sprites (pas de création/destruction par frame). Rare et lent.
      const dissipe = smoothstep5(0.25, 0.7, det);   // rien avant ~0.25 de détresse
      for (let i = 0; i < vu.motes.length; i++) {
        const s = vu.motes[i];
        if (dissipe <= 0.001) { s.material.opacity = 0; continue; }
        // Avancement 0→1 dans le cycle (montée lente) ; au-delà de 1, on repart en bas.
        let ph = vu.motePhase[i] + dt * 0.18;        // ~5,5 s par cycle (lent)
        if (ph >= 1) ph -= 1;
        vu.motePhase[i] = ph;
        // Position : part du sol vers ~1,4 de haut, en spirale douce autour du nœud.
        const ang = i * (TAU / NB_MOTE) + ph * 1.2;
        const r = 0.35 + ph * 0.25;
        s.position.set(vu.base.x + Math.cos(ang) * r, 0.15 + ph * 1.3,
                       vu.base.z + Math.sin(ang) * r);
        // Opacité : apparaît, monte, s'évapore (cloche), × intensité de dissipation.
        const cloche = Math.sin(ph * Math.PI);
        s.material.opacity = cloche * 0.5 * dissipe * rev;
      }
    }
  }

  // ── ANIMATION PAR STADE du MONUMENT (même patron que l'arbre) ────────────────
  // Pièces construites UNE FOIS, pilotées par la vie `v` ; jamais de scale 0 pile
  // (0.0001) pour éviter une matrice non inversible ; fondus doux (smoothstep).

  /** MONUMENT : la pierre ne pousse pas, elle se RECOMPOSE (deux vagues de blocs par stade). */
  private animerMonument(vu: VisuNoeud, v: number): void {
    if (vu.type !== "monument") return;
    const mn = vu.groupe.userData.monument as MonumentVisu | undefined;
    if (!mn) return;
    // VAGUE 2 (corps : jambes + bras gauche) réapparaît au stade 2 ; VAGUE 3 (tête +
    // geste) au stade 3. On scale chaque vague de ~0 (absente) à 1 (reformée).
    const k2 = smoothstep5(0.26, 0.50, v);
    const k3 = smoothstep5(0.58, 0.82, v);
    mn.vague2.scale.setScalar(Math.max(0.0001, k2));
    mn.vague3.scale.setScalar(Math.max(0.0001, k3));
  }

  /** MAISON (R1) : la maison qui SE RALLUME — fenêtre noire → braise → foyer doré + fumée. */
  private animerMaison(vu: VisuNoeud, v: number, t: number): void {
    if (vu.type !== "maison") return;
    const mz = vu.groupe.userData.maison as MaisonVisu | undefined;
    if (!mz) return;
    // FENÊTRE : noir froid (mort) → braise tiède (~0.5) → foyer doré plein (~0.85).
    const fenMat = mz.fenetre.material as THREE.MeshBasicMaterial;
    _coulStade.setHex(0x0a0d16)                                  // fenêtre éteinte
      .lerp(_demi.setHex(0xb35a2a), smoothstep5(0.30, 0.55, v))  // braise tiède
      .lerp(_vif.setHex(0xffd27a), smoothstep5(0.55, 0.85, v));  // foyer doré
    fenMat.color.copy(_coulStade);
    // HALO d'accueil : s'allume doucement en pleine vie (chaleur qui rayonne).
    const chaud = smoothstep5(0.60, 0.90, v);
    mz.accueil.material.opacity = chaud * 0.5;
    // FUMÉE : un filet qui monte de la cheminée (stade 3), chaque sprite déphasé.
    for (let i = 0; i < mz.fumee.length; i++) {
      const s = mz.fumee[i];
      const ph = (t * 0.25 + i / mz.fumee.length) % 1;     // 0→1 lent (montée)
      s.position.set(0.35 + Math.sin(ph * 6 + i) * 0.12, 1.7 + ph * 1.4, 0.1);
      s.material.opacity = chaud * Math.sin(ph * Math.PI) * 0.35;   // cloche (apparaît/s'évapore)
    }
  }

  /** PHARE-COROLLE (R2 cœur, type "foyer") : la fleur-lanterne qui s'OUVRE en 3 stades
   *  (BOUTON → ÉCLOSION → SANCTUAIRE), réversible. C'est le poumon du « souffle commun ». */
  private animerFoyerCommun(vu: VisuNoeud, v: number, t: number): void {
    if (vu.type !== "foyer") return;
    const fy = vu.groupe.userData.foyer as FoyerVisu | undefined;
    if (!fy) return;
    // OUVERTURE des pétales = le cœur de l'effet. Angle 0 = fermé (bouton), ~1.4 rad = ouvert.
    // Stade 1 (bouton) sous ~0.30 ; éclosion 0.30→0.65 ; sanctuaire grand ouvert >0.65.
    const ouvre = smoothstep5(0.20, 0.85, v);
    // PULSATION (le « souffle ») : plus rapide/ample en pleine vie, lente au repos.
    const battement = Math.sin(t * (1.0 + ouvre * 0.8));      // ~6 s fermé → ~3,5 s ouvert
    const pulse = 0.5 + 0.5 * battement;
    // PÉTALES : rotation.x de la base. Fermé = repliés vers le haut/centre (angle ~ -0.1) ;
    // ouverts = basculés vers l'extérieur (angle ~ 1.3). Léger souffle qui les fait respirer.
    const angle = -0.1 + ouvre * 1.4 + battement * 0.06 * ouvre;
    for (const piv of fy.petales) piv.rotation.x = angle;
    // BRAISE centrale : faible et filtrée en bouton → vive en sanctuaire, mais TEMPÉRÉE
    // (additif central) pour ne PAS noyer la corolle — on doit VOIR les pétales s'ouvrir.
    const braiseMat = fy.braise.material as THREE.MeshBasicMaterial;
    braiseMat.opacity = (0.12 + 0.32 * ouvre) * (0.75 + 0.25 * pulse);
    const sB = 0.6 + 0.35 * ouvre + pulse * 0.05;     // un peu plus petite (laisse voir les pétales)
    fy.braise.scale.setScalar(sB);
    // HALO au SOL (le nid) : s'allume dès l'éclosion, s'élargit au sanctuaire.
    fy.haloSol.material.opacity = smoothstep5(0.30, 0.70, v) * 0.35 * (0.8 + 0.2 * pulse);
    const large = 7 * (0.6 + 0.6 * ouvre);
    fy.haloSol.scale.set(large, large, 1);
    // COLONNE / PHARE : n'apparaît qu'au SANCTUAIRE (stade 3), DOUCE (semi-transparente),
    // tempérée pour rester un voile de lumière, pas un mur blanc qui cache la fleur.
    const colonne = smoothstep5(0.65, 0.92, v);
    (fy.colonne.material as THREE.MeshBasicMaterial).opacity = colonne * 0.13 * (0.7 + 0.3 * pulse);
    // ANNEAUX au sol (où les Piuws se posent) : apparaissent au sanctuaire, pulsent.
    for (let i = 0; i < fy.anneaux.length; i++) {
      (fy.anneaux[i].material as THREE.MeshBasicMaterial).opacity =
        colonne * 0.3 * (0.6 + 0.4 * Math.sin(t * 1.1 + i * 1.5));
    }
    // On EXPOSE la phase du souffle de la fleur (source du souffle commun) pour que les
    // Piuws du Zurg puissent s'y accrocher (synchronisation locale autour du Cœur).
    this.soufflePhase = t * (1.0 + ouvre * 0.8);
    this.souffleVie = v;
  }

  /** CHANTIER (R2 nœud) : des blocs flottants qui s'ASSEMBLENT en arche (coutures d'or). */
  private animerChantier(vu: VisuNoeud, v: number, t: number): void {
    if (vu.type !== "chantier") return;
    const ch = vu.groupe.userData.chantier as ChantierVisu | undefined;
    if (!ch) return;
    // ASSEMBLAGE : lerp de chaque bloc entre ÉPARPILLÉ (v bas) et ASSEMBLÉ (v haut).
    const k = smoothstep5(0.20, 0.85, v);
    for (const b of ch.blocs) {
      // Dérive lente au repos (mobile de Calder) qui DIMINUE quand ça s'assemble.
      const flot = (1 - k) * 0.25;
      const fx = Math.sin(t * 0.6 + b.phase) * flot;
      const fy = Math.cos(t * 0.5 + b.phase) * flot;
      b.grp.position.set(
        b.eparp.x + (b.assemb.x - b.eparp.x) * k + fx,
        b.eparp.y + (b.assemb.y - b.eparp.y) * k + fy,
        b.eparp.z + (b.assemb.z - b.eparp.z) * k);
      // Rotation : tourne au repos, se FIGE (aligné, droit) à l'assemblage.
      b.grp.rotation.x += b.spin * 0.01 * (1 - k);
      b.grp.rotation.y += b.spin * 0.012 * (1 - k);
      b.grp.rotation.z *= (1 - 0.05 * k);   // tend vers 0 (droit) en s'assemblant
    }
    // COUTURES D'OR : brillent de plus en plus avec v (kintsugi qui se révèle). Ne sont
    // visibles qu'une fois bien assemblé (sinon des fils d'or flotteraient dans le vide).
    const or = smoothstep5(0.55, 0.92, v);
    for (const c of ch.coutures) (c.material as THREE.MeshBasicMaterial).opacity = or * 0.85;
    // HALO de passage sous l'arche (stade 3).
    ch.passage.material.opacity = smoothstep5(0.75, 0.95, v) * 0.4;
  }

  /**
   * « LE FOYER HABITÉ » + NIVEAUX 2/3 de l'ARBRE-Cœur. Tout est piloté par la vie
   * EFFECTIVE `v` (respecte window.__forceV) et par `dt`/`t`. Pièces construites une
   * fois ; plafonds DURS ; aucun rebuild par frame ; lent et contemplatif.
   *   Niv.1 : nicheurs + fruits (fondu par v).
   *   Niv.2 : nicheurs qui CHANTENT (bulle « piuw ! ») + qui se MULTIPLIENT (1→2→3
   *           par paliers de TEMPS d'arbre épanoui `tempsEpanoui`).
   *   Niv.3 : l'arbre ESSAIME — respiration ~15 s qui lâche des graines de lumière,
   *           lesquelles font naître des pousses autonomes au sol (le monde reverdit
   *           SANS le joueur).
   */
  private animerFoyer(vu: VisuNoeud, arbre: ArbreVisu, v: number, dt: number, t: number): void {
    const SEUIL_FOYER = 0.80;
    // « Installation » du foyer en fonction de la vie (0 sous 0.80, plein vers 0.92).
    const habite = smoothstep5(SEUIL_FOYER, 0.92, v);

    // TEMPS D'ARBRE ÉPANOUI (lecture seule) : monte tant que v reste haut, redescend
    // 3× plus lentement sinon. Borné → pas de dérive infinie.
    if (v >= SEUIL_FOYER) arbre.tempsEpanoui = Math.min(200, arbre.tempsEpanoui + dt);
    else arbre.tempsEpanoui = Math.max(0, arbre.tempsEpanoui - dt / 3);

    // ── NIV.1 + NIV.2 : NICHEURS (apparition par paliers de temps + flottement + chant) ──
    arbre.nicheurs.forEach((ni, i) => {
      // Palier de TEMPS : le i-ème Piuw n'arrive qu'après NICHEUR_ARRIVEE[i] s d'épanouissement.
      const apparuTemps = smoothstep5(NICHEUR_ARRIVEE[i], NICHEUR_ARRIVEE[i] + 4, arbre.tempsEpanoui);
      const present = habite * apparuTemps;     // 0..1 : à la fois assez vivant ET assez longtemps
      ni.grp.scale.setScalar(Math.max(0.0001, 0.42 * present));
      ni.grp.position.y = ni.baseY + Math.sin(t * 0.8 + ni.phase) * 0.06;   // flottement lent
      const respire = 0.85 + 0.15 * Math.sin(t * 1.1 + ni.phase);
      ni.halo.material.opacity = present * 0.42 * respire;

      // CHANT : compte à rebours désynchronisé. Ne chante que s'il est bien présent.
      if (present > 0.6) {
        ni.prochainChant -= dt;
        if (ni.prochainChant <= 0 && ni.chante <= 0) {
          ni.chante = 1.5;                       // affiche « piuw ! » 1,5 s
          ni.prochainChant = 6 + Math.random() * 8;
        }
      }
      // Affichage de la bulle (cloche d'opacité + petite montée). Coupée si l'arbre faiblit.
      if (ni.chante > 0 && present > 0.4) {
        ni.chante -= dt;
        const k = Math.max(0, ni.chante) / 1.5;          // 1 → 0
        ni.bulle.visible = true;
        (ni.bulle.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.95;
        // Position : au-dessus de la tête du nicheur (coords LOCALES arbre), monte un peu.
        const p = ni.grp.position;
        ni.bulle.position.set(p.x, p.y + 0.6 + (1 - k) * 0.25, p.z);
      } else {
        ni.bulle.visible = false;
        if (present <= 0.4) ni.chante = 0;
      }
    });

    // ── NIV.1 : FRUITS-LANTERNES (éclosent par v, pulsent lentement) ──
    const fruitNe = smoothstep5(0.83, 0.95, v);
    for (const fr of arbre.fruits) {
      fr.mesh.scale.setScalar(Math.max(0.0001, fruitNe));
      const pulse = 0.5 + 0.5 * Math.sin(t * 0.9 + fr.phase);
      (fr.mesh.material as THREE.MeshBasicMaterial).opacity = fruitNe * (0.18 + 0.22 * pulse);
    }

    // ── NIV.3 : L'ARBRE QUI ESSAIME (autonome) ──
    this.essaimer(vu, arbre, dt);
  }

  /**
   * NIVEAU 3 — « L'ARBRE QUI ESSAIME » : une fois l'arbre LONGUEMENT épanoui, il respire
   * (~15 s) et lâche, à chaque expiration, UNE graine de lumière qui retombe en arc au sol
   * et y fait naître une POUSSE autonome (un mini-arbre qui éclôt tout seul). Le monde
   * reverdit SANS le joueur. TRÈS lent, contemplatif, plafond DUR.
   */
  private essaimer(vu: VisuNoeud, arbre: ArbreVisu, dt: number): void {
    const PLAFOND_POUSSES = 4;             // plafond DUR (sécurité perf + lisibilité)
    const DUREE_CYCLE = 15;                // s : inspire 0-5 → expire 5-7 → repos 7-15
    // Seuil de TEMPS d'épanouissement avant le 1er essaimage. Réglable au debug
    // (window.__essaimSeuil) pour tester sans attendre 90 s réelles.
    const seuil = (window as unknown as { __essaimSeuil?: number }).__essaimSeuil ?? 90;
    const actif = arbre.tempsEpanoui > seuil;

    // 1) HORLOGE DE RESPIRATION. On avance le cycle ; on repère le FRONT de l'expire
    //    (passage du cycle au-delà de 5 s) pour lâcher AU PLUS une graine par cycle.
    const avant = arbre.cycle;
    arbre.cycle = (arbre.cycle + dt) % DUREE_CYCLE;
    const franchitExpire = avant < 5 && (arbre.cycle >= 5 || arbre.cycle < avant);

    // 2) LÂCHER une graine à l'expire, si conditions réunies (actif, pas de graine en
    //    vol, plafond non atteint).
    if (actif && franchitExpire && !arbre.graine && arbre.pousses.length < PLAFOND_POUSSES) {
      const base = vu.base;                                  // position monde de l'arbre
      const ang = Math.random() * TAU;
      const dist = 4 + Math.random() * 4;                    // 4-8 unités du tronc
      const from = new THREE.Vector3(base.x, 3.2, base.z);   // sommet de la canopée
      const to = new THREE.Vector3(base.x + Math.cos(ang) * dist, 0.1, base.z + Math.sin(ang) * dist);
      const sprite = faireHalo(0.55, 0x9ffcff, 0.0);
      this.scene.add(sprite);
      arbre.graine = { sprite, t: 0, from, to, arc: 2.2 };
    }

    // 3) GRAINE EN VOL : arc parabolique doux (~3 s), opacité en cloche.
    if (arbre.graine) {
      const gr = arbre.graine;
      gr.t = Math.min(1, gr.t + dt / 3.0);                   // ~3 s de chute
      const x = gr.from.x + (gr.to.x - gr.from.x) * gr.t;
      const z = gr.from.z + (gr.to.z - gr.from.z) * gr.t;
      // Parabole : monte un peu puis retombe (4*t*(1-t) = cloche), ajoutée à la descente linéaire.
      const yLin = gr.from.y + (gr.to.y - gr.from.y) * gr.t;
      const y = yLin + gr.arc * 4 * gr.t * (1 - gr.t);
      gr.sprite.position.set(x, y, z);
      (gr.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(gr.t * Math.PI) * 0.7 + 0.15;
      if (gr.t >= 1) {
        // IMPACT : la graine devient une POUSSE + une tache de lumière au sol.
        this.fairePousse(arbre, gr.to);
        this.scene.remove(gr.sprite);
        (gr.sprite.material as THREE.SpriteMaterial).dispose?.();
        arbre.graine = undefined;
      }
    }

    // 4) POUSSES : leur `v` interne monte tout seul vers la cible → elles éclosent avec
    //    la même grammaire de stades (feuilles + branches qui poussent), en réduit.
    for (const po of arbre.pousses) {
      po.vInterne = Math.min(po.cible, po.vInterne + dt * 0.06);   // ~8 s pour atteindre 0.5
      const a = po.grp.userData.arbre as ArbreVisu;
      // Feuilles (les 2 plus basses suffisent en réduit) + branches éclosent selon vInterne.
      a.feuilles.forEach((f, i) => {
        const k = i < 3 ? smoothstep5(f.seuil, f.seuil + 0.15, po.vInterne + 0.25) : 0;
        const s = Math.max(0.0001, k);
        f.mesh.scale.setScalar(s);
        if (f.contour) f.contour.scale.setScalar(s * 1.07);
      });
      a.branches.forEach((b) => b.scale.setScalar(Math.max(0.0001, smoothstep5(0.0, 0.4, po.vInterne))));
      // La pousse « sort de terre » : son scale global monte de 0 à ~0.22.
      const grow = smoothstep5(0, 0.5, po.vInterne) * 0.22;
      po.grp.scale.setScalar(Math.max(0.0001, grow));
      // Tache de lumière au sol : vive à la naissance, puis se calme (reste un halo discret).
      const taj = 0.18 + 0.12 * smoothstep5(0, 0.3, po.vInterne);
      (po.tache.material as THREE.SpriteMaterial).opacity = taj;
    }
    // 🔧 DEBUG : on RECOPIE l'état sur l'instance (visible via window.__r3d).
    this.tempsEpanoui = arbre.tempsEpanoui;
    this.poussesVivantes = arbre.pousses.length;
  }

  /** Crée une POUSSE autonome (mini-arbre) + sa tache de lumière au point `at` (monde). */
  private fairePousse(arbre: ArbreVisu, at: THREE.Vector3): void {
    const grp = creerArbre();           // réutilise le constructeur (mêmes stades)
    grp.position.copy(at);
    grp.scale.setScalar(0.0001);
    grp.rotation.y = Math.random() * TAU;
    this.scene.add(grp);
    // Tache de lumière au sol (halo plat, cyan doux) sous la pousse.
    const tache = faireHalo(2.0, 0x9ffcff, 0.18);
    tache.position.set(at.x, 0.08, at.z);
    this.scene.add(tache);
    arbre.pousses.push({ grp, vInterne: 0, cible: 0.5, ne: true, tache });
  }

  /**
   * 🔧 DEBUG : FORCE la naissance immédiate d'UNE pousse autour de l'arbre-Cœur, sans
   * attendre le seuil de temps ni le cycle de respiration. Exposée en `window.__essaimerMaintenant()`.
   * Respecte le plafond dur. Renvoie le nombre de pousses vivantes après l'appel.
   */
  essaimerMaintenant(): number {
    for (const vu of this.noeuds.values()) {
      if (vu.type !== "heart") continue;
      const arbre = vu.groupe.userData.arbre as ArbreVisu | undefined;
      if (!arbre) continue;
      if (arbre.pousses.length >= 4) return arbre.pousses.length;   // plafond dur
      const ang = Math.random() * TAU, dist = 4 + Math.random() * 4;
      const at = new THREE.Vector3(vu.base.x + Math.cos(ang) * dist, 0.1,
                                   vu.base.z + Math.sin(ang) * dist);
      this.fairePousse(arbre, at);
      this.poussesVivantes = arbre.pousses.length;
      return arbre.pousses.length;
    }
    return 0;
  }

  /** Effet d'éveil : un flash lumineux à l'endroit du seuil franchi (`dx` = zone). */
  eveil(pos: Vec2, type: NodeType, dx = 0): void {
    const p = mondeVers3D(pos, 1.2, dx);
    const flash = faireHalo(2, COULEUR[type] ?? COULEUR_DEFAUT, 0.9);
    flash.position.copy(p); this.scene.add(flash);
    this.flashs.push({ halo: flash, vie: 1 });
  }

  /**
   * BRAISE → VEILLEUSE : à appeler UNE SEULE FOIS, au tout premier nœud éveillé.
   * Allume la 1re flamme colorée sous la peau de Phantom (couleur = le rêve éveillé)
   * et fait grandir d'un cran sa lumière de présence. Tout se fait en fondu doux
   * dans `rendre()` ; ici on ne fait que CRÉER la flamme et armer les cibles.
   * Idempotent : si la flamme existe déjà, on ne fait rien (pas de re-déclenchement).
   */
  allumerVeilleuse(reve: Reve): void {
    if (this.veilleuseFlamme) return;          // déjà passé à la Veilleuse → on ignore
    const couleur = COULEUR_REVE[reve];
    this.veilleuseReve = reve;
    // La FLAMME : un halo additif coloré, logé À L'INTÉRIEUR du groupe Phantom,
    // au centre du corps et un peu en avant (z>0) pour qu'on la voie « traverser »
    // la peau blanche translucide vers la caméra. Additif → elle illumine le blanc
    // de l'intérieur (lueur qui transparaît), sans le cacher. Opacité 0 au départ :
    // c'est `rendre()` qui la fait monter en douceur (jamais de flash brutal).
    const flamme = faireHalo(1.25, couleur, 0.0);
    flamme.position.set(0, -0.08, 0.18);       // poitrine, sous le visage (pas sur la tête)
    // depthTest désactivé : la lueur PASSE par-dessus le corps blanc opaque (sinon le
    // corps la cache entièrement) → effet « la lumière transparaît sous la peau ».
    flamme.material.depthTest = false;
    flamme.renderOrder = 12;
    this.phantom.add(flamme);
    this.veilleuseFlamme = flamme;
    // La PRÉSENCE grandit d'un cran : le halo au sol vise une taille plus large
    // (de ~3.0 « La Braise » → ~4.6 « La Veilleuse »). La montée est progressive
    // dans `rendre()` (lerp), pour qu'on SENTE la lumière s'étendre vers le sol.
    this.veilleuseHaloCible = 5.2;

    // ── ON ARME LA SÉQUENCE « le monde s'embrase » ────────────────────────────
    // Tous les objets ci-dessous naissent INVISIBLES (opacité/échelle 0) ; c'est
    // `animerVeilleuseSeq()` (appelé dans rendre()) qui les fait vivre puis mourir.
    // Position MONDE des pieds de Phantom = base de la colonne et de l'onde au sol.
    const px = this.phantom.position.x, pz = this.phantom.position.z;

    // (3a) COLONNE de lumière vers le ciel — même fabrique que le `beam` du grand
    //      Éveil (cylindre creux additif), mais colorée du rêve et DÉDIÉE (ne touche
    //      pas au beam du grand Éveil). Elle monte puis redescend en fondu.
    this.veilleuseBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.5, 11, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.veilleuseBeam.position.set(px, 5.2, pz);
    this.scene.add(this.veilleuseBeam);

    // (3c) ONDE au sol : un anneau additif coloré, à plat, qui part des pieds et
    //      s'étend. Même esprit que les anneaux du grand Éveil, mais couleur du rêve.
    this.veilleuseOnde = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.95, 56),
      new THREE.MeshBasicMaterial({ color: couleur, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.veilleuseOnde.rotation.x = -Math.PI / 2;
    this.veilleuseOnde.position.set(px, 0.08, pz);
    this.scene.add(this.veilleuseOnde);

    // (3c bis) LA TEINTE QUI RESTE : un disque coloré additif, doux, posé au sol sous
    //      Phantom. L'onde le « révèle » sur son passage ; il PERSISTE faiblement après
    //      (l'herbe a pris un cran de vie/couleur localement). Additif → il ne cache rien.
    this.veilleuseTeinte = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texHalo, color: couleur, transparent: true,
        opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.veilleuseTeinte.rotation.x = -Math.PI / 2;
    this.veilleuseTeinte.position.set(px, 0.05, pz);
    this.veilleuseTeinte.scale.set(11, 11, 1);
    this.scene.add(this.veilleuseTeinte);

    // (3b) PLUIE de couleur (pool ≤ NB_PLUIE) : petits halos additifs colorés qui
    //      jaillissent de la poitrine et retombent en arc parabolique autour de lui.
    //      On les crée UNE FOIS et on tire leur vélocité de départ ici (pas dans la frame).
    for (let i = 0; i < NB_PLUIE; i++) {
      const goutte = faireHalo(0.24 + Math.random() * 0.22, couleur, 0);
      goutte.position.set(px, 1.5, pz);
      this.scene.add(goutte);
      this.veilleusePluie.push(goutte);
      // Gerbe : direction horizontale aléatoire, poussée vers le haut, qui retombera
      // (la gravité est appliquée dans l'animation). Vitesses douces → arc lisible.
      const ang = Math.random() * TAU;
      const force = 1.4 + Math.random() * 2.2;          // portée horizontale
      this.veilleusePluieVel.push({
        vx: Math.cos(ang) * force,
        vy: 3.2 + Math.random() * 2.0,                  // élan vertical initial
        vz: Math.sin(ang) * force,
      });
    }

    // Top départ : la grande vague commence.
    this.veilleuseSeq = 0;
  }

  /**
   * Anime la SÉQUENCE « le monde s'embrase » (appelée chaque frame par rendre()).
   * Retourne le BOOST de bloom/exposition à ajouter au climax (0 hors séquence) ;
   * rendre() l'applique sur this.bloom.strength (plafond DUR 1.0) et l'exposition.
   * Tout est en fondus doux : UNE montée, UNE descente. Aucune allocation par frame.
   */
  private animerVeilleuseSeq(dt: number): number {
    if (this.veilleuseSeq < 0) return 0;       // séquence non déclenchée / terminée
    this.veilleuseSeq += dt;
    const s = this.veilleuseSeq;
    const couleur = new THREE.Color(COULEUR_REVE[this.veilleuseReve]);

    // ══ T1 INSPIR (0 → 0.40 s) : le halo de présence se RESSERRE brièvement ══════
    // On replie un peu le halo vers Phantom (il « prend son souffle ») avant qu'il
    // ne déborde. Une cloche douce : 0 au repos, max au milieu de l'inspir, 0 ensuite.
    let inspir = 0;
    if (s < SEQ_INSPIR_FIN) inspir = Math.sin((s / SEQ_INSPIR_FIN) * Math.PI);
    // Le resserrement se lit comme une fraction négative sur la taille du halo (≤ 18 %).
    this.veilleuseInspir = inspir * 0.18;

    // ══ T2 NAISSANCE (0.40 → 1.00 s) : la flamme naît et REMONTE dans le corps ═══
    // L'opacité/échelle de la flamme sont déjà gérées par l'allumage progressif dans
    // rendre() ; ici on AJOUTE un léger mouvement vertical (poitrine → cœur) pour
    // qu'on SENTE la lumière monter sous la peau. Fondu doux d'aller (pas de retour
    // brutal : elle se pose au cœur et y reste).
    if (this.veilleuseFlamme) {
      const monte = smoothstep5(SEQ_INSPIR_FIN, SEQ_NAISS_FIN, s);  // 0 → 1
      this.veilleuseFlamme.position.y = -0.16 + monte * 0.10;       // -0.16 → -0.06 (remonte)
    }

    // ══ T3 DÉBORDEMENT (1.00 → 2.20 s) : LE WOW ══════════════════════════════════
    // Une cloche unique `deb` (0 au début/fin, 1 au pic ~1.6 s) pilote l'intensité
    // commune de la colonne, de l'onde et du bloom. Montée + descente, jamais de
    // clignotement. Avancement linéaire `pdeb` ∈ [0,1] pour les trajectoires.
    let deb = 0, pdeb = 0;
    if (s >= SEQ_DEBORD_DEB && s < SEQ_DEBORD_FIN) {
      pdeb = (s - SEQ_DEBORD_DEB) / (SEQ_DEBORD_FIN - SEQ_DEBORD_DEB);
      deb = Math.sin(pdeb * Math.PI);          // cloche douce 0→1→0
    } else if (s >= SEQ_DEBORD_FIN) {
      pdeb = 1;
    }

    // (3a) COLONNE : opacité suit la cloche ; elle « pousse » un peu en largeur au pic,
    //      tourne lentement (vivant). Additive → elle s'ajoute au ciel, ne le cache pas.
    if (this.veilleuseBeam) {
      const mat = this.veilleuseBeam.material as THREE.MeshBasicMaterial;
      mat.opacity = deb * 0.3;
      const lg = 1 + deb * 0.3;
      this.veilleuseBeam.scale.set(lg, 1, lg);
      this.veilleuseBeam.rotation.y += dt * 0.5;
      // Suit Phantom au cas où il bouge un peu pendant la séquence.
      this.veilleuseBeam.position.x = this.phantom.position.x;
      this.veilleuseBeam.position.z = this.phantom.position.z;
    }

    // (3b) PLUIE : chaque goutte suit une parabole (intégration simple) pendant T3,
    //      puis FOND au sol. On l'« émet » au tout début de T3 (positions remises à la
    //      poitrine), on l'intègre tant que pdeb < 1, et on la fait disparaître par
    //      opacité (cloche d'apparition × fondu de fin). Pooling : aucune création ici.
    if (s >= SEQ_DEBORD_DEB) {
      const px = this.phantom.position.x, pz = this.phantom.position.z;
      // Fenêtre de vie de la pluie : naît à T3, retombe et s'éteint juste après le pic.
      const vief = 1 - smoothstep5(0.7, 1.0, pdeb);   // pleine puis fond en fin de T3
      for (let i = 0; i < this.veilleusePluie.length; i++) {
        const g = this.veilleusePluie[i];
        const v = this.veilleusePluieVel[i];
        if (pdeb <= 0.001) {
          // Émission : on (re)pose la goutte à la poitrine de Phantom au démarrage.
          g.position.set(px, 1.5, pz);
        } else if (pdeb < 1) {
          // Intégration parabolique : gravité ~ -8 sur vy (retombée naturelle).
          v.vy -= 8 * dt;
          g.position.x += v.vx * dt;
          g.position.y += v.vy * dt;
          g.position.z += v.vz * dt;
          if (g.position.y < 0.06) g.position.y = 0.06;   // ne traverse pas le sol
        }
        g.material.opacity = vief * 0.85;
      }
    }

    // (3c) ONDE au sol + TEINTE qui reste : l'anneau s'étend depuis les pieds ; la
    //      teinte colorée « apparaît » derrière lui et PERSISTE (un cran de vie locale).
    if (this.veilleuseOnde) {
      const r = 1 + pdeb * 13;                 // l'anneau s'élargit jusqu'aux bords de l'île
      this.veilleuseOnde.scale.set(r, r, 1);
      (this.veilleuseOnde.material as THREE.MeshBasicMaterial).opacity =
        deb * 0.7 * (1 - pdeb * 0.4);          // vif au départ, s'estompe en s'élargissant
    }
    if (this.veilleuseTeinte) {
      // La teinte monte vers une valeur PERSISTANTE faible (l'herbe ravivée) puis y reste.
      const cible = 0.22;                      // teinte qui demeure après la vague (herbe ravivée)
      const apparait = smoothstep5(SEQ_DEBORD_DEB, SEQ_DEBORD_FIN, s);
      (this.veilleuseTeinte.material as THREE.MeshBasicMaterial).opacity = apparait * cible;
    }

    // ══ T4 LE MONDE RÉPOND (2.20 → 3.50 s) : les nœuds proches s'illuminent ══════
    // Boost BREF d'emissive sur les matériaux toon des nœuds proches de Phantom, puis
    // retour. Cloche unique → une seule pulsation douce (pas de scintillement).
    let reponse = 0;
    if (s >= SEQ_REPONSE_DEB && s < SEQ_FIN) {
      const pr = (s - SEQ_REPONSE_DEB) / (SEQ_FIN - SEQ_REPONSE_DEB);
      reponse = Math.sin(pr * Math.PI);        // 0 → 1 → 0
    }
    if (reponse > 0.001) {
      const px = this.phantom.position.x, pz = this.phantom.position.z;
      for (const vu of this.noeuds.values()) {
        const dx = vu.base.x - px, dz = vu.base.z - pz;
        const dist = Math.hypot(dx, dz);
        // Plus le nœud est proche, plus il répond fort (portée ~9 unités). Au-delà, rien.
        const proche = 1 - smoothstep5(0, 9, dist);
        if (proche <= 0.001) continue;
        const force = reponse * proche * 0.6;
        for (const p of vu.peau) {
          if (!p.mat) continue;                // contours : pas d'emissive
          p.mat.emissive.copy(couleur);
          p.mat.emissiveIntensity = force;
        }
      }
    } else if (s >= SEQ_FIN) {
      // Fin de séquence : on ÉTEINT proprement tout emissive ajouté (retour à l'état stable).
      for (const vu of this.noeuds.values())
        for (const p of vu.peau)
          if (p.mat) p.mat.emissiveIntensity = 0;
    }

    // ══ FIN : on retombe sur l'état stable « Veilleuse » et on libère les objets ══
    if (s >= SEQ_FIN) {
      this.veilleuseSeq = -1;                  // séquence terminée (idempotente)
      this.veilleuseInspir = 0;
      if (this.veilleuseBeam)   { this.scene.remove(this.veilleuseBeam);   this.veilleuseBeam = undefined; }
      if (this.veilleuseOnde)   { this.scene.remove(this.veilleuseOnde);   this.veilleuseOnde = undefined; }
      if (this.veilleuseTeinte) { this.scene.remove(this.veilleuseTeinte); this.veilleuseTeinte = undefined; }
      for (const g of this.veilleusePluie) this.scene.remove(g);
      this.veilleusePluie.length = 0;
      this.veilleusePluieVel.length = 0;
    }

    // BOOST bloom/exposition au climax = la cloche du DÉBORDEMENT (pic ~1.6 s).
    return deb;
  }

  /**
   * Synchronise les volumes 3D des Piuws sur la liste du vrai système (cerveau).
   * Crée un volume pour chaque nouveau Piuw, le positionne, et retire les morts.
   * Repère : la coordonnée `y` MONDE (verticale du jeu 2D) devient la HAUTEUR 3D.
   */
  synchroniserPiuws(liste: Piuw[], zone = 0): void {
    const dx = this.ileVisus[zone]?.dx ?? 0;
    const mesh = this.piuwMesh[zone];
    const zurg = zone === 1;                                    // le ZURG = peuple des 8 rêves
    const vivants = new Set(liste);
    const t = performance.now() / 1000;
    const px = this.phantom.position.x, pz = this.phantom.position.z;   // Phantom (monde 3D)

    // ── ÉLECTION DU VEILLEUR : parmi les Piuws « sauver » de CETTE zone, on élit le PLUS
    //    PROCHE de Phantom. Seul lui fera la garde/le rattrapage ; les autres restent calmes.
    //    Passe légère (O(n), pas d'allocation) sur leurs meshes (position de la frame d'avant).
    this.veilleurElu = undefined;
    if (zurg) {
      let meilleur = Infinity;
      for (const p of liste) {
        if (p.reve !== "sauver") continue;
        const g = mesh.get(p);
        if (!g) continue;                                       // pas encore de volume (frame de naissance)
        const ddx = g.position.x - px, ddz = g.position.z - pz;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < meilleur) { meilleur = d2; this.veilleurElu = g; }
      }
    }

    for (const p of liste) {
      let grp = mesh.get(p);
      if (!grp) {
        if (zurg) {
          // PIUW-RÊVE : base + trait de forme + couleur du rêve (cf. creerPiuwReve).
          // Halo VOLONTAIREMENT plus petit/discret (0.7) qu'au jardin : il doit AURÉOLER
          // le Piuw sans NOYER son corps coloré ni son trait de forme (auréole, comète…).
          grp = creerPiuwReve(p.reve);
          const halo = faireHalo(0.7, COULEUR_PIUW_ZURG[p.reve], 0.15); grp.add(halo);
          grp.userData.halo = halo;
          grp.userData.varScale = 0.85 + Math.random() * 0.5;   // un peu de variété de taille
          // ONDE DE RÉCEPTION (le Colporteur, transmettre) : un anneau d'onde que CE Piuw
          // (n'importe quel rêve) émet quand il « reçoit » une nouvelle → il la RÉPÈTE.
          const onde = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 24),
            new THREE.MeshBasicMaterial({ color: 0xffe3a8, transparent: true, opacity: 0,
              side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
          onde.rotation.x = -Math.PI / 2; grp.add(onde);
          grp.userData.onde = onde;
          grp.userData.ondeT = -1;        // -1 = pas d'onde ; ≥0 = avancement (s) d'une onde
          grp.userData.haloBoost = 0;     // surbrillance temporaire du halo (réception/dépôt)
        } else {
          // JARDIN (zone A) : Piuws sobres, couleur du rêve pure (matériau partagé).
          grp = creerPiuw(matPiuw(p.reve));
          const halo = faireHalo(0.9, COULEUR_REVE[p.reve], 0.2); grp.add(halo);
          grp.userData.halo = halo;
          grp.userData.varScale = 1;
        }
        // Orbite PROPRE à chaque Piuw → ils ne se collent pas et tournent, espacés.
        grp.userData.ang0 = Math.random() * Math.PI * 2;
        grp.userData.ray = 0.9 + Math.random() * 1.0;
        grp.userData.spin = (0.5 + Math.random() * 0.6) * (Math.random() < 0.5 ? -1 : 1);
        grp.userData.hOff = (Math.random() - 0.5) * 0.6;
        // « SOUFFLE COMMUN » : chaque Piuw a SA phase de respiration (sa danse). Elle
        // dérive vers celle des voisins/du Phare → synchronisation locale (lucioles).
        grp.userData.breath = Math.random() * TAU;
        // Historique de positions pour le sillage (se-souvenir : suit Phantom en retard).
        grp.userData.trail = [] as { x: number; y: number; z: number }[];
        this.scene.add(grp);
        mesh.set(p, grp);
      }
      // Position LOGIQUE du Piuw (cerveau pur) → 3D, décalée à la zone.
      const ang = grp.userData.ang0 + t * grp.userData.spin;
      const ray = grp.userData.ray as number;
      const cx = (p.pos.x - 160) / ECH + dx;
      const cy = 1.0 + Math.max(0, (144 - p.pos.y) / ECH) * 0.5 + p.bond * 0.3;
      // CORRECTIF 19/08/2026 (checklist v1 §12, occlusion du Piuw) : la caméra regarde vers
      // +x (cf. ORIENT_VERS_CAMERA) donc +x = DERRIÈRE le Cœur/l'Arbre de son point de vue.
      // Une orbite en cercle complet (cos(ang) plein) amenait le Piuw pile derrière le tronc
      // fin (occlusion totale) à mi-parcours. On APLATIT l'arrière de l'orbite (jamais plus
      // loin que cx + 0.15·ray) : le Piuw continue de tourner (bz garde son amplitude
      // complète, l'effet de « danse » reste) mais ne disparaît plus derrière le décor.
      let bx = cx + Math.min(Math.cos(ang), 0.15) * ray;
      let by = cy + grp.userData.hOff + Math.sin(t * 1.5 + grp.userData.ang0) * 0.15;
      let bz = Math.sin(ang) * ray;

      // ── MOUVEMENT SIGNATURE (ZURG) : un OFFSET de rendu par-dessus la position logique
      //    (le cerveau pur reste intact). Chacun « dit son rêve » par sa façon de bouger.
      if (zurg) {
        const off = this.mouvementReve(p.reve, grp, t, bx, by, bz, px, pz, mesh);
        bx = off.x; by = off.y; bz = off.z;
      }
      grp.position.set(bx, by, bz);

      const op = PiuwSystem.opacite(p);
      const vs = (grp.userData.varScale as number) ?? 1;
      grp.scale.setScalar(p.taille * 0.7 * vs * op);
      // Orientation : par défaut le Piuw regarde dans le sens de son orbite. Le VEILLEUR
      // (sauver) PEUT imposer un yaw (regarde le vide, puis se tourne vers Phantom).
      const yawForce = grp.userData.sauverYaw as number | null | undefined;
      grp.rotation.y = (yawForce != null) ? yawForce : ang + Math.PI / 2;

      // ── SOUFFLE COMMUN : le halo PULSE. Au repos chacun sa phase ; RAPPROCHÉ d'un voisin
      //    (ou du Phare), sa phase s'ALIGNE doucement (sync locale). Le souffle SE BRISE
      //    quand la vie BAISSE (respiration irrégulière) → le déclin devient visible.
      let breath = grp.userData.breath as number;
      if (zurg) {
        // Cible de sync : la phase du Phare-Corolle si Phantom est proche du Cœur, sinon
        // une cadence commune lente. On rapproche doucement (couplage faible = lucioles).
        const cible = this.soufflePhase % TAU;
        const diff = Math.atan2(Math.sin(cible - breath), Math.cos(cible - breath));
        breath += diff * 0.02;          // couplage doux vers la phase commune
        breath += 1.6 * (1 / 60);       // avance propre
        grp.userData.breath = breath;
        // BRISURE AU DÉCLIN : plus la vie du Zurg est BASSE, plus on injecte du bruit
        // (la respiration devient irrégulière). `souffleVie` ∈ [0,1] vient du Phare.
        const sain = Math.max(0, Math.min(1, this.souffleVie));
        const jitter = (1 - sain) * Math.sin(t * 7.3 + grp.userData.ang0) * 0.5;
        const halo = grp.userData.halo as THREE.Sprite;
        // GARDE du VEILLEUR (sauver) : pendant la garde, son halo SE DÉTACHE du souffle
        // commun → il RALENTIT et s'ÉLARGIT pour t'envelopper (présence rassurante, pas
        // une alarme). Hors garde, il respire avec la famille.
        const sg = grp.userData.sauverHalo as number | null | undefined;
        if (sg != null && sg > 0.05) {
          const lent = 0.5 + 0.5 * Math.sin(t * 0.6);              // respiration LENTE
          halo.material.opacity = (0.12 + 0.18 * lent) * op;
          halo.scale.setScalar(0.7 * (1 + 1.5 * sg));             // s'ÉLARGIT pour ENVELOPPER Phantom
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(breath + jitter);
          // Halo doux + BOOST temporaire (vases communicants du Colporteur : monte quand le
          // Piuw reçoit/dépose, retombe doucement). Le souffle reste subtil sinon.
          const boost = (grp.userData.haloBoost as number) ?? 0;
          halo.material.opacity = (0.09 + 0.13 * pulse + boost * 0.25) * op;
          halo.scale.setScalar(0.7 * (1 + boost * 0.4));
        }
        grp.userData.haloBoost = Math.max(0, ((grp.userData.haloBoost as number) ?? 0) - 1.2 / 60);
      } else {
        (grp.userData.halo as THREE.Sprite).material.opacity = 0.22 * op;
      }

      // ── CONTAMINATION (étape 3, N'IMPORTE QUEL Piuw) : si le Colporteur lui a posé
      //    `repeterOnde`, il émet à son tour la MÊME onde quand le minuteur tombe (il a
      //    « compris » → la nouvelle vit en lui). C'est l'âme du rêve « transmettre ».
      const rep = grp.userData.repeterOnde as number | undefined;
      if (rep !== undefined) {
        const nr = rep - 1 / 60;
        if (nr <= 0) { grp.userData.ondeT = 0; grp.userData.repeterOnde = undefined; }
        else grp.userData.repeterOnde = nr;
      }
      // ── ONDE (réception/dépôt/répétition) : un anneau qui s'élargit et s'estompe.
      //    `ondeT` ≥ 0 = onde en cours (avancement en s). N'importe quel Piuw peut en émettre.
      const onde = grp.userData.onde as THREE.Mesh | undefined;
      if (onde) {
        const ot = grp.userData.ondeT as number;
        if (ot >= 0) {
          const ot2 = ot + 1 / 60;
          const f = ot2 / 0.6;                       // ~0,6 s par onde
          if (f >= 1) { grp.userData.ondeT = -1; (onde.material as THREE.MeshBasicMaterial).opacity = 0; }
          else {
            grp.userData.ondeT = ot2;
            onde.scale.setScalar(0.4 + f * 1.6);
            (onde.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.9;
          }
        }
      }
    }
    // Retrait des volumes dont le Piuw a disparu de la liste (mort).
    for (const [p, grp] of mesh) {
      if (!vivants.has(p)) { this.scene.remove(grp); mesh.delete(p); }
    }
    // GLYPHES (Piuw « créer ») : on avance le pool UNE fois par frame, côté Zurg.
    if (zurg) {
      const dtG = Math.min(0.05, t - (this.glyDernierT || t));
      this.glyDernierT = t;
      this.majGlyphes(dtG);
    }
  }

  /**
   * MOUVEMENT SIGNATURE d'un Piuw-rêve (ZURG) : renvoie une position de RENDU (offset
   * par-dessus la position logique). Anime aussi ses pièces de forme (anneaux, ondes…).
   * Tout est cosmétique (le cerveau pur n'est pas touché). Les plus lisibles sont faits ;
   * les autres sont des variantes douces (cf. rapport pour ce qui est simplifié).
   */
  private mouvementReve(reve: Reve, grp: THREE.Group, t: number,
                        bx: number, by: number, bz: number,
                        px: number, pz: number,
                        mesh?: Map<Piuw, THREE.Group>): { x: number; y: number; z: number } {
    const anim = grp.userData.anim as Record<string, THREE.Object3D | THREE.Object3D[]> | undefined;
    let x = bx, y = by, z = bz;
    switch (reve) {
      case "explorer": {  // FILE loin, STOPPE net, revient en zigzag (cycle ~3 s)
        const ph = (t * 0.33 + (grp.userData.ang0 as number)) % 1;   // 0→1
        const elan = ph < 0.5 ? smoothstep5(0, 0.5, ph) : smoothstep5(1, 0.5, ph);  // va puis revient
        const dir = new THREE.Vector2(px - x, pz - z); if (dir.lengthSq() < 1e-4) dir.set(1, 0);
        dir.normalize();
        x += dir.x * elan * 3.2 + (-dir.y) * Math.sin(t * 9) * elan * 0.6;   // file + zigzag
        z += dir.y * elan * 3.2 + (dir.x) * Math.sin(t * 9) * elan * 0.6;
        break;
      }
      case "esperer": {   // MONTE toujours un peu (flotte plus haut)
        y += 0.5 + Math.sin(t * 1.3 + (grp.userData.ang0 as number)) * 0.12;
        break;
      }
      case "proteger": {  // ORBITE ample autour de Phantom + anneaux croisés qui tournent
        const a = t * 0.7 + (grp.userData.ang0 as number);
        x = px + Math.cos(a) * 3.0; z = pz + Math.sin(a) * 3.0;
        const an = anim?.anneaux as THREE.Mesh[] | undefined;
        if (an) { an[0].rotation.z += 0.03; an[1].rotation.x -= 0.03; }
        break;
      }
      case "se-souvenir": { // SUIT la trajectoire de Phantom avec ~2 s de retard + échos
        const trail = grp.userData.trail as { x: number; y: number; z: number }[];
        trail.push({ x: px, y: by, z: pz });
        if (trail.length > 130) trail.shift();                       // ~2 s à 60 fps
        const cible = trail[0];
        if (cible) { x += (cible.x - x) * 0.06; z += (cible.z - z) * 0.06; }
        const echos = anim?.echos as THREE.Mesh[] | undefined;       // images fantômes en sillage
        if (echos) echos.forEach((e, i) => {
          const c = trail[Math.max(0, trail.length - 1 - (i + 1) * 18)];
          if (c) { e.visible = true; e.position.set(c.x - x, 0.1, c.z - z); }
        });
        break;
      }
      case "sauver": {
        // « LE VEILLEUR PENCHÉ » : il veille sur TOI, pas te bloquer. On détecte si Phantom
        // est PRÈS DU BORD/DU VIDE de la zone B : distance au centre de zone (+DX) vs RBORD.
        const versBord = new THREE.Vector2(px - DX, pz);
        const distCentre = versBord.length();
        if (versBord.lengthSq() < 1e-4) versBord.set(1, 0); else versBord.normalize();
        // UN SEUL Veilleur (le PLUS PROCHE de Phantom) fait la garde ; les autres restent
        // calmes → pour eux, `auBord`/`rattrape` valent 0 (gardeK retombe doucement à 0).
        const estElu = grp === this.veilleurElu;
        // RATTRAPAGE : quand la CONTENANCE douce ramène Phantom (il a frôlé le vide), le
        // Veilleur ÉLU passe en garde immédiate et se précipite vers lui pour le retenir.
        const rattrape = estElu ? Math.min(1, this.contenanceDehors * 1.5) : 0;
        // « près du bord » = Phantom approche du bord du PLATEAU MARCHABLE (RPLAT_2) → le
        // Veilleur commence à glisser AVANT que la contenance ne le retienne. Le rattrapage
        // (contenanceDehors) prend le relais s'il pousse jusqu'au vide.
        const auBord = (estElu && (distCentre > 0.82 * RPLAT_2 || rattrape > 0.05)) ? 1 : 0;
        // gardeK : 0 (loin, calme) → 1 (garde pleine). Plus rapide pendant un rattrapage.
        const vitG = 0.04 + rattrape * 0.12;
        const gardeK = (grp.userData.gardeK as number ?? 0) + (auBord - (grp.userData.gardeK as number ?? 0)) * vitG;
        grp.userData.gardeK = Math.max(gardeK, rattrape);           // le rattrapage force la garde
        // gardePhase : temps passé EN garde (sert au moment « il se retourne vers toi »).
        const gp = Math.max(0, Math.min(3, (grp.userData.gardePhase as number ?? 0)
                    + (auBord ? 1 : -2) * (1 / 60)));
        grp.userData.gardePhase = gp;
        // « il se retourne vers toi » : après ~1,3 s de garde — OU tout de suite s'il te
        // RATTRAPE (il te regarde en te ramenant : « je ne te laisse pas tomber »).
        const retourne = Math.max(smoothstep5(1.3, 1.9, gp), rattrape);

        // POSITION : (a) loin → flotte près de Phantom, face à lui. (b) garde → glisse au
        // BORD, À CÔTÉ de Phantom. (c) RATTRAPAGE → il se précipite SUR Phantom (le retient).
        const lat = new THREE.Vector2(-versBord.y, versBord.x);     // tangente (côté)
        const cibleLoin = { x: px + versBord.x * 1.4, z: pz + versBord.y * 1.4 };   // un peu devant
        const cibleBord = { x: px + versBord.x * 1.0 + lat.x * 1.4,
                            z: pz + versBord.y * 1.0 + lat.y * 1.4 };               // à côté, vers le bord
        let cx2 = cibleLoin.x + (cibleBord.x - cibleLoin.x) * grp.userData.gardeK;
        let cz2 = cibleLoin.z + (cibleBord.z - cibleLoin.z) * grp.userData.gardeK;
        // En rattrapage il vient TOUT PRÈS de Phantom, côté vide (comme s'il l'enlaçait).
        cx2 += (px + versBord.x * 0.5 - cx2) * rattrape;
        cz2 += (pz + versBord.y * 0.5 - cz2) * rattrape;
        const vitPos = 0.05 + rattrape * 0.15;                      // plus vif en rattrapage
        x += (cx2 - x) * vitPos; z += (cz2 - z) * vitPos;

        // INCLINAISON de la forme : penché ~25° AU-DESSUS DU VIDE pendant la garde, PUIS il
        // se redresse (×(1-retourne)). On incline le sous-groupe « forme » autour de l'axe
        // tangent au bord (comme s'il regardait en bas vers le vide).
        const gK = grp.userData.gardeK as number;
        const forme = anim?.forme as THREE.Group | undefined;
        if (forme) {
          const inclin = gK * (1 - retourne) * THREE.MathUtils.degToRad(25);
          // axe d'inclinaison = direction du bord projetée : on penche vers +versBord (le vide).
          forme.rotation.z = -inclin * versBord.x;
          forme.rotation.x = inclin * versBord.y;
        }
        // VOILE : s'allume pendant la garde (~0.12 → ~0.5), au plein pendant le rattrapage.
        const voile = anim?.voile as THREE.Mesh | undefined;
        if (voile) (voile.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.38 * Math.max(gK, rattrape);

        // REGARD : pendant la garde il regarde d'abord le VIDE (yaw vers le bord), puis se
        // tourne vers PHANTOM (retourne). On EXPOSE le yaw cible + un mode garde pour que
        // synchroniserPiuws l'applique (sinon la rotation par défaut l'écraserait).
        const yawVide = Math.atan2(versBord.x, versBord.y);
        const yawPhantom = Math.atan2(px - x, pz - z);
        const yawCible = yawVide + (yawPhantom - yawVide) * retourne;
        grp.userData.sauverYaw = gK > 0.05 ? yawCible : null;      // null = rotation par défaut
        // HALO : pendant la garde, il RALENTIT et S'ÉLARGIT pour t'envelopper. En rattrapage
        // il l'enveloppe PLUS (le coussin qui le ramène). On stocke l'ampleur (max garde/rattrape).
        grp.userData.sauverHalo = gK > 0.05 ? Math.max(gK, rattrape) : null;
        break;
      }
      case "transmettre": {
        // « LE COLPORTEUR » : il porte une nouvelle de Piuw en Piuw ; le receveur la RÉPÈTE.
        // ANNEAUX ORBITAUX : tournent lentement EN SENS INVERSE (signature « celui qui relie »).
        const aA = anim?.anneauA as THREE.Group | undefined;
        const aB = anim?.anneauB as THREE.Group | undefined;
        if (aA) aA.rotation.z += THREE.MathUtils.degToRad(8) / 60;    // ~8°/s
        if (aB) aB.rotation.z -= THREE.MathUtils.degToRad(6) / 60;    // ~-6°/s (inverse)

        // État de la chorégraphie (stocké sur le groupe). dt ~ 1/60.
        const ud = grp.userData;
        let ph = (ud.colPhase as string) ?? "cherche";
        let pt = ((ud.colT as number) ?? 0) + 1 / 60;

        if (ph === "cherche") {
          // Trouver le Piuw le PLUS PROCHE (autre que lui) → cible du dépôt.
          let best = Infinity, cible: THREE.Group | undefined;
          if (mesh) for (const g of mesh.values()) {
            if (g === grp) continue;
            const ddx = g.position.x - x, ddz = g.position.z - z, d2 = ddx * ddx + ddz * ddz;
            if (d2 < best) { best = d2; cible = g; }
          }
          if (cible) {
            ud.colCible = cible; ud.colDepart = new THREE.Vector3(x, y, z);
            // POINT DE CONTRÔLE Bézier décalé sur le CÔTÉ → trajectoire en ARC (jamais droite).
            const mx = (x + cible.position.x) / 2, mz = (z + cible.position.z) / 2;
            const perpx = -(cible.position.z - z), perpz = (cible.position.x - x);
            const pl = Math.hypot(perpx, perpz) || 1;
            const cote = (Math.random() < 0.5 ? 1 : -1) * 1.6;
            ud.colCtrl = new THREE.Vector3(mx + perpx / pl * cote, y + 0.5, mz + perpz / pl * cote);
            ph = "approche"; pt = 0;
          }
        } else if (ph === "approche") {            // ~1,2 s : glisse en ARC vers la cible
          const cible = ud.colCible as THREE.Group | undefined;
          const dep = ud.colDepart as THREE.Vector3, ctrl = ud.colCtrl as THREE.Vector3;
          if (!cible || !dep || !ctrl) { ph = "cherche"; pt = 0; }
          else {
            const f = Math.min(1, pt / 1.2), u = smoothstep5(0, 1, f);   // ease
            // Bézier quadratique dep → ctrl → cible (ARC).
            const oneU = 1 - u;
            x = oneU * oneU * dep.x + 2 * oneU * u * ctrl.x + u * u * cible.position.x;
            y = oneU * oneU * dep.y + 2 * oneU * u * ctrl.y + u * u * (cible.position.y + 0.1);
            z = oneU * oneU * dep.z + 2 * oneU * u * ctrl.z + u * u * cible.position.z;
            if (f >= 1) { ph = "depot"; pt = 0; }
          }
        } else if (ph === "depot") {               // ~0,4 s : il dépose l'onde (effleurement)
          const cible = ud.colCible as THREE.Group | undefined;
          if (cible) { x = cible.position.x; y = cible.position.y + 0.1; z = cible.position.z; }
          if ((ud.colT as number) < 1 / 30) {       // 1re frame du dépôt → vases communicants
            grp.userData.ondeT = 0;                 // le Colporteur émet une onde
            grp.userData.haloBoost = Math.max(0, (grp.userData.haloBoost as number ?? 0) - 0.4); // son halo BAISSE d'un cran
            if (cible) {
              cible.userData.haloBoost = (cible.userData.haloBoost as number ?? 0) + 0.7; // receveur MONTE
              cible.userData.repeterOnde = 0.3;     // CONTAMINATION : il répétera l'onde dans 0,3 s
            }
          }
          if (pt >= 0.4) { ph = "repart"; pt = 0; }
        } else if (ph === "repart") {              // petite pause puis on recommence (autre Piuw)
          if (pt >= 0.6) { ph = "cherche"; pt = 0; ud.colCible = undefined; }
        }
        ud.colPhase = ph; ud.colT = pt;
        break;
      }
      case "comprendre": { // HÉSITE : avance/recule + l'antenne se balance (penche la tête)
        const h = Math.sin(t * 1.1 + (grp.userData.ang0 as number));
        const dir = new THREE.Vector2(px - x, pz - z); if (dir.lengthSq() > 1e-4) dir.normalize();
        x += dir.x * h * 0.5; z += dir.y * h * 0.5;
        const ant = anim?.antenne as THREE.Mesh | undefined;
        if (ant) ant.position.x = 0.25 + h * 0.05;
        break;
      }
      case "creer": {     // il ÉCRIT un langage inconnu : trace des GLYPHES dans l'air.
        // Léger flottement vivant (il « pense » en bougeant), discret.
        x += Math.sin(t * 1.6 + (grp.userData.ang0 as number)) * 0.25;
        z += Math.cos(t * 1.9 + (grp.userData.ang0 as number)) * 0.25;
        // Minuteur d'écriture propre à chaque Piuw : toutes les ~2-4 s il lance un glyphe.
        let prochain = grp.userData.prochainGlyphe as number | undefined;
        if (prochain === undefined) prochain = t + 1 + Math.random() * 2;
        if (t >= prochain) {
          this.lancerGlyphe(x, z);                 // trace un signe près de lui (au sol-aérien)
          prochain = t + 2 + Math.random() * 2;    // re-programme (2-4 s)
        }
        grp.userData.prochainGlyphe = prochain;
        break;
      }
    }
    return { x, y, z };
  }

  // ── GLYPHES (Piuw « créer ») : pool de RUBANS violets ÉPAIS (mesh de quads) qui se
  //    tracent, se suspendent puis s'effacent, FACE À LA CAMÉRA. Construit à la 1re
  //    demande (besoin de la scène). Zéro alloc/frame (buffers fixes recyclés).
  private initGlyphes(): void {
    if (this.glyphesInit) return;
    this.glyphesInit = true;
    // Index FIXE d'un ruban : 2 vertices par point (gauche/droite), 2 triangles par segment.
    const idx: number[] = [];
    for (let k = 0; k < GLYPHE_N - 1; k++) {
      const a = k * 2, b = k * 2 + 1, c = (k + 1) * 2, d = (k + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    const indexArr = new Uint16Array(idx);
    for (let i = 0; i < 6; i++) {
      const pos = new Float32Array(GLYPHE_N * 2 * 3);          // 2 vertices par point
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(indexArr.slice(), 1));
      geo.setDrawRange(0, 0);
      const mat = new THREE.MeshBasicMaterial({ color: GLYPHE_COULEUR, transparent: true,
        opacity: GLYPHE_OPACITE, blending: THREE.AdditiveBlending, depthWrite: false,
        side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.renderOrder = 22; mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.glyphes.push({ mesh, pos, libre: true, t: 0, pts: [],
        ox: 0, oy: 0, oz: 0, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0 });
    }
    for (let i = 0; i < 8; i++) {
      const s = faireHalo(0.5, 0xe6d2ff, 0); this.scene.add(s); this.glyEtincelles.push(s);
    }
  }

  /** Lance le TRACÉ d'un glyphe (signe inconnu) près de (x,z), suspendu en l'air, FACE caméra. */
  lancerGlyphe(x: number, z: number): void {
    this.initGlyphes();
    const g = this.glyphes.find((q) => q.libre);
    if (!g) return;                                     // pool plein → on saute (plafond dur)
    g.libre = false; g.t = 0;
    g.pts = GLYPHES_PTS[(Math.random() * GLYPHES_PTS.length) | 0];
    // Centre du signe, suspendu en l'air un peu à côté du Piuw.
    g.ox = x + (Math.random() - 0.5) * 0.8;
    g.oy = 1.6 + Math.random() * 0.8;
    g.oz = z + (Math.random() - 0.5) * 0.8;
    // BILLBOARD : on calcule le plan du signe pour qu'il FASSE FACE à la caméra. `right`
    // = horizontale perpendiculaire à la vue ; `up` ≈ vertical monde (le signe reste droit).
    const vx = this.camera.position.x - g.ox, vz = this.camera.position.z - g.oz;
    const vl = Math.hypot(vx, vz) || 1;
    // right = (vue) tournée de 90° dans le plan horizontal.
    g.rx = -vz / vl; g.ry = 0; g.rz = vx / vl;
    g.ux = 0; g.uy = 1; g.uz = 0;                        // « haut » = vertical monde
    g.mesh.visible = true;
    g.mesh.geometry.setDrawRange(0, 0);
  }

  /** Avance TOUS les glyphes actifs (une fois/frame) : tracé → suspension → effacement. */
  private majGlyphes(dt: number): void {
    if (!this.glyphesInit) return;
    const T = GLYPHE_TRACE, S = GLYPHE_SUSPENS, E = GLYPHE_EFFACE;
    const segTot = (GLYPHE_N - 1) * 6;                   // nb d'indices (3 par triangle)
    let etinc = 0;
    for (const g of this.glyphes) {
      if (g.libre) continue;
      g.t += dt;
      // Reconstruit le RUBAN en monde : chaque point du chemin → 2 vertices (±largeur),
      // perpendiculaire au tracé DANS le plan du signe (base rx/ux face caméra).
      const w = GLYPHE_LARGEUR, sc = GLYPHE_TAILLE;
      for (let k = 0; k < GLYPHE_N; k++) {
        const p = g.pts[k];
        // point central du chemin en monde.
        const cxp = g.ox + (p.x * sc) * g.rx + (p.y * sc) * g.ux;
        const cyp = g.oy + (p.x * sc) * g.ry + (p.y * sc) * g.uy;
        const czp = g.oz + (p.x * sc) * g.rz + (p.y * sc) * g.uz;
        // tangente locale (dans l'espace du signe) → normale = tangente tournée de 90°.
        const kn = Math.min(GLYPHE_N - 1, k + 1), kp = Math.max(0, k - 1);
        const tlx = g.pts[kn].x - g.pts[kp].x, tly = g.pts[kn].y - g.pts[kp].y;
        const tl = Math.hypot(tlx, tly) || 1;
        const nlx = -tly / tl, nly = tlx / tl;           // normale locale 2D
        // normale en monde (combinaison des axes du plan) × largeur.
        const nx = (nlx * g.rx + nly * g.ux) * w;
        const ny = (nlx * g.ry + nly * g.uy) * w;
        const nz = (nlx * g.rz + nly * g.uz) * w;
        const o = k * 6;
        g.pos[o]     = cxp - nx; g.pos[o + 1] = cyp - ny; g.pos[o + 2] = czp - nz;
        g.pos[o + 3] = cxp + nx; g.pos[o + 4] = cyp + ny; g.pos[o + 5] = czp + nz;
      }
      (g.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      const mat = g.mesh.material as THREE.MeshBasicMaterial;
      if (g.t < T) {
        // TRACÉ : on révèle du début → fin (drawRange sur les indices ; 6 par segment).
        const f = g.t / T;
        g.mesh.geometry.setDrawRange(0, Math.max(6, Math.floor(f * (GLYPHE_N - 1)) * 6));
        mat.opacity = GLYPHE_OPACITE;
      } else if (g.t < T + S) {
        // SUSPENSION : signe complet figé en l'air.
        g.mesh.geometry.setDrawRange(0, segTot);
        mat.opacity = GLYPHE_OPACITE;
      } else if (g.t < T + S + E) {
        // EFFACEMENT dans l'ORDRE DU TRACÉ (début → fin) : le départ disparaît en 1er.
        const f = (g.t - T - S) / E;
        const startSeg = Math.floor(f * (GLYPHE_N - 1));
        g.mesh.geometry.setDrawRange(startSeg * 6, Math.max(0, segTot - startSeg * 6));
        mat.opacity = GLYPHE_OPACITE * (1 - f * 0.4);
        // ÉTINCELLES au POINT FINAL à la 1re frame d'effacement (le signe « sèche »).
        if (g.t - dt < T + S) {
          const fin = g.pts[GLYPHE_N - 1];
          const fxp = g.ox + (fin.x * sc) * g.rx + (fin.y * sc) * g.ux;
          const fyp = g.oy + (fin.x * sc) * g.ry + (fin.y * sc) * g.uy;
          const fzp = g.oz + (fin.x * sc) * g.rz + (fin.y * sc) * g.uz;
          for (let j = 0; j < 3 && etinc < this.glyEtincelles.length; j++) {
            const s = this.glyEtincelles[etinc++];
            s.position.set(fxp + (Math.random() - 0.5) * 0.25, fyp + (Math.random() - 0.5) * 0.2, fzp);
            s.userData.vie = 0.5; s.material.opacity = 0.8;
          }
        }
      } else {
        g.libre = true; g.mesh.visible = false; g.mesh.geometry.setDrawRange(0, 0);
      }
    }
    // ÉTINCELLES : petite vie qui décroît + montée douce.
    for (const s of this.glyEtincelles) {
      const vie = (s.userData.vie as number) ?? 0;
      if (vie <= 0) { s.material.opacity = 0; continue; }
      const nv = vie - dt;
      s.userData.vie = nv;
      s.position.y += dt * 0.3;
      s.material.opacity = Math.max(0, nv / 0.5) * 0.8;
    }
  }

  /** Les DOUBLES D'ATTENTION : échos pâles qui orbitent autour des nœuds très vivants. */
  synchroniserDoubles(liste: DoubleAttention[], zone = 0): void {
    const dx = this.ileVisus[zone]?.dx ?? 0;
    const mesh = this.doubleMesh[zone];
    const vivants = new Set(liste);
    for (const d of liste) {
      let s = mesh.get(d);
      if (!s) { s = faireHalo(1.1, 0xbfe8ff, 0); this.scene.add(s); mesh.set(d, s); }
      s.position.set((d.pos.x - 160) / ECH + dx,
        0.7 + Math.max(0, (144 - d.pos.y) / ECH), Math.sin(d.phase) * 0.4);
      s.material.opacity = DoublesSystem.opacite(d) * 0.4;
    }
    for (const [d, s] of mesh)
      if (!vivants.has(d)) { this.scene.remove(s); mesh.delete(d); }
  }

  /** Le PIUW PERDU de l'intro : gris et plaintif, il reverdit quand on le sauve.
   *  PHASE 2 : il vit en ZONE A (dx = -DX par défaut). */
  majIntro(intro: PiuwPerdu, dx = -DX): void {
    if (!this.introGrp) {
      this.introMat = (M.vert as THREE.MeshToonMaterial).clone();
      this.introGrp = creerPiuw(this.introMat);
      const halo = faireHalo(1.2, 0x9fb0d0, 0.2); this.introGrp.add(halo);
      this.introGrp.userData.halo = halo;
      this.scene.add(this.introGrp);
    }
    const g = this.introGrp;
    // Posé AU SOL comme tout le décor (même projection que les nœuds), avec un
    // faible flottement : avant, sa coord. monde y était mise en HAUTEUR → il
    // planait à ~3,5 et devenait inatteignable. Maintenant il est sur l'île, bas.
    g.position.copy(mondeVers3D(intro.pos, 0.5 + intro.bond * 0.3, dx));
    // « Vue de face » : le Piuw nous REGARDE (face vers la caméra) + léger balancement.
    g.rotation.y = ORIENT_VERS_CAMERA + Math.sin(intro.phase) * 0.4;
    // Vivacité k : 0 (perdu, gris) → 1 (sauvé, vert). Couleur du corps + halo suivent.
    const k = intro.etat === "perdu" ? intro.sauveProgress : 1;
    g.scale.setScalar(0.55 + k * 0.3);
    this.introMat!.color.copy(new THREE.Color(0x8a93ad).lerp(new THREE.Color(0x57d36a), k));
    const halo = g.userData.halo as THREE.Sprite;
    halo.material.color.copy(new THREE.Color(0x9fb0d0).lerp(new THREE.Color(0x6effa0), k));
    // « APPEL » : tant qu'il est perdu, son halo PULSE comme un petit cœur fragile
    // dans le noir → c'est le seul mouvement à l'écran, l'œil y va tout seul (onboarding).
    // L'appel s'éteint à mesure qu'il est sauvé (facteur 1-k).
    const pulse = (0.5 + 0.5 * Math.sin(this.horloge.elapsedTime * 1.8)) * 0.35 * (1 - k);
    halo.material.opacity = 0.18 + k * 0.25 + pulse;

    // PAROLE : une bulle d'onomatopée flotte au-dessus de lui quand il « parle »
    // (« Piu…? » plaintif, puis « Piuw ! » joyeux une fois sauvé). C'est le cœur
    // wordless de la 1re scène — sans ça, l'intro était muette. Texture refaite
    // uniquement quand le mot change (sinon réutilisée).
    if (intro.mot) {
      if (!this.introMot) {
        this.introMot = new THREE.Sprite(new THREE.SpriteMaterial({
          transparent: true, depthTest: false }));
        this.introMot.scale.set(1.7, 0.85, 1);
        this.introMot.renderOrder = 30;
        this.scene.add(this.introMot);
      }
      if (intro.mot !== this.introMotDernier) {
        const mat = this.introMot.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.map = texteTexture(intro.mot);
        mat.needsUpdate = true;
        this.introMotDernier = intro.mot;
      }
      this.introMot.visible = true;
      this.introMot.position.set(g.position.x, g.position.y + 1.0 + intro.bond * 0.3, g.position.z);
    } else if (this.introMot) {
      this.introMot.visible = false;
      this.introMotDernier = null;
    }

    // FIL DE LUMIÈRE Phantom → Piuw pendant le sauvetage : rend la CAUSALITÉ visible
    // (« c'est MA présence qui le ravive »). N'apparaît que quand Phantom est assez
    // proche (sauveProgress monte), opacité = avancement du sauvetage. Fil ténu, additif.
    if (intro.etat === "perdu" && intro.sauveProgress > 0.02) {
      if (!this.introFil) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          [new THREE.Vector3(), new THREE.Vector3()]);
        this.introFil = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: 0x9fe6ff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false }));
        this.introFil.renderOrder = 24;
        this.scene.add(this.introFil);
      }
      const p = this.introFil.geometry.attributes.position as THREE.BufferAttribute;
      p.setXYZ(0, this.phantom.position.x, this.phantom.position.y, this.phantom.position.z);
      p.setXYZ(1, g.position.x, g.position.y + 0.15, g.position.z);
      p.needsUpdate = true;
      (this.introFil.material as THREE.LineBasicMaterial).opacity = intro.sauveProgress * 0.8;
      this.introFil.visible = true;
    } else if (this.introFil) {
      this.introFil.visible = false;
    }
  }

  /** Le GRAND ÉVEIL de la région : vagues de lumière + gros flash + embellie du monde.
   *  PHASE 2 : `dx` = décalage de la zone concernée. */
  grandEveil(pos: Vec2, dx = 0): void {
    const p = mondeVers3D(pos, 0.1, dx);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.95, 48),
        new THREE.MeshBasicMaterial({ color: 0x9effd0, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(p); ring.position.y = 0.12 + i * 0.04;
      this.scene.add(ring);
      this.anneaux.push({ mesh: ring, vie: 2 + i * 0.4, max: 2 + i * 0.4 });
    }
    const flash = faireHalo(7, 0xcfffe6, 1); flash.position.copy(p); flash.position.y = 1.6;
    this.scene.add(flash); this.flashs.push({ halo: flash, vie: 1.8 });
    // Colonne de lumière verticale qui jaillit du Cœur (très lisible, spectaculaire).
    if (this.beam) this.scene.remove(this.beam);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.0, 14, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xc6ffe6, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.position.copy(p); this.beam.position.y = 6;
    this.scene.add(this.beam);
    this.celebration = 4;
  }

  /**
   * Déclenche le CLIMAX « Le Don » (~9 s) : Phantom marche jusqu'au Cœur, se dissout
   * dedans (sa lumière passe dans le monde via l'embrasement), le monde reste lumineux
   * sans lui. Appelé par main3d à l'éveil de la DERNIÈRE région. Idempotent.
   */
  jouerFin(coeur: Vec2, dx = 0): void {
    if (this.finSeq >= 0) return;
    this.finSeq = 0;
    this.finEmbrase = false;
    this.finCoeur2D = { ...coeur };
    this.finCoeurDx = dx;
    this.finCoeur3D.copy(mondeVers3D(coeur, 0.95, dx));
    this.finDepart.copy(this.phantom.position);
    this.controls.enabled = false;             // on prend la main sur la caméra (recul final)
    // On CLONE les matériaux de Phantom → on pourra le faire fondre SEUL, sans toucher
    // les Piuws qui partagent les mêmes matériaux de base. (Restaurés dans reset().)
    this.finMats = []; this.finRestore = [];
    this.phantom.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.Material | undefined;
      if (m && !Array.isArray(m)) {
        this.finRestore.push({ mesh, mat: m });            // l'original, à remettre dans reset()
        const c = m.clone() as THREE.Material & { transparent: boolean; depthWrite: boolean };
        c.transparent = true; c.depthWrite = false; c.needsUpdate = true; // toggler `transparent` = recompile
        mesh.material = c; this.finMats.push(c);
      }
    });
  }

  /** Le climax est-il terminé ? (main3d révèle alors l'écran de clôture sobre.) */
  finTerminee(): boolean { return this.finSeq >= 9.0; }

  /** Anime la séquence de fin (appelée par rendre tant qu'elle est active). 4 temps. */
  private animerFin(dt: number): void {
    this.finSeq += dt;
    const s = this.finSeq;
    const op = (v: number) => { for (const m of this.finMats)
      (m as THREE.Material & { opacity: number }).opacity = v; };

    if (s <= 2.5) {
      // T1 — LA MARCHE OFFERTE : Phantom glisse doucement vers le Cœur.
      const u = smoothstep5(0, 1, s / 2.5);
      this.phantom.position.x = this.finDepart.x + (this.finCoeur3D.x - this.finDepart.x) * u;
      this.phantom.position.z = this.finDepart.z + (this.finCoeur3D.z - this.finDepart.z) * u;
      this.phantom.rotation.y = Math.atan2(this.finCoeur3D.x - this.finDepart.x,
                                           this.finCoeur3D.z - this.finDepart.z);
    } else if (s <= 5.5) {
      // T2 — LA DISSOLUTION / L'EMBRASEMENT : arrivé au Cœur, il se transvase dans le
      // monde. Embrasement déclenché une fois ; son opacité descend vers 0 (après un
      // court « inspir »), pendant que le monde monte en lumière (le flash de l'éveil).
      this.phantom.position.x = this.finCoeur3D.x;
      this.phantom.position.z = this.finCoeur3D.z;
      if (!this.finEmbrase) { this.finEmbrase = true; this.grandEveil(this.finCoeur2D, this.finCoeurDx); }
      const p = (s - 2.5) / 3.0;
      op(1 - smoothstep5(0.3, 1.0, p));
    } else if (s <= 7.5) {
      // T3 — LE MONDE SANS LUI : Phantom a disparu ; la caméra recule doucement
      // (on passe « de lui » au « tout »). Les Piuws continuent d'exister.
      op(0);
      const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
      const cible = new THREE.Vector3().copy(this.controls.target).add(dir.multiplyScalar(15));
      this.camera.position.lerp(cible, 0.04);
    } else {
      // T4 — on tient l'état (Phantom invisible) ; main3d affiche l'écran de clôture.
      op(0);
    }
  }

  /** Le « regard » courant (souris projetée sur le sol), en coordonnées monde 2D. */
  getRegard(): Vec2 | null { return this.regardMonde; }

  /** ILLUMINATION : le joueur tient-il la touche d'illumination (Espace) ? */
  estIllumine(): boolean { return !!this.touches["Space"]; }

  /** ONBOARDING : le joueur demande-t-il un DÉPLACEMENT (ZQSD/WASD/flèches) ?
   *  Sert à savoir s'il a « compris qu'il peut bouger » → on retire l'indice ZQSD. */
  deplacementDemande(): boolean {
    const k = this.touches;
    return !!(k["KeyW"] || k["KeyZ"] || k["ArrowUp"] || k["KeyS"] || k["ArrowDown"] ||
              k["KeyD"] || k["ArrowRight"] || k["KeyA"] || k["KeyQ"] || k["ArrowLeft"]);
  }

  /** ONBOARDING : position ÉCRAN (en pixels) de Phantom, pour poser un indice de
   *  touches JUSTE au-dessus de lui. null tant qu'il n'y a pas encore de rendu. */
  phantomEcran(): { x: number; y: number } | null {
    const v = this.phantom.position.clone();
    v.y += 0.9;   // un peu au-dessus de sa « tête »
    v.project(this.camera);
    if (v.z > 1) return null;   // derrière la caméra → on ne montre pas
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  }

  /**
   * ILLUMINATION : main3d nous dit si l'illumination est ACTIVE (touche tenue ET
   * réserve de lumière dispo) + le niveau de lumière ∈ [0,1], pour le FEEDBACK
   * visuel (halo qui s'intensifie). Le rendu ne décide rien : il LIT l'état.
   */
  setIllumination(actif: boolean, lumiere: number): void {
    this.illumineActif = actif;
    this.niveauLumiere = lumiere;
  }

  /**
   * VFX (chantier 3) : le FILET DE LUMIÈRE. Quand Phantom illumine, un fin faisceau
   * lumineux relie son corps à la cible la plus proche à portée → on VOIT sa lumière
   * « toucher » l'élément qu'il ravive. Lecture seule (ne change aucun état de jeu).
   */
  private majFilet(): void {
    // Création paresseuse (la scène existe) : un cône fin émissif, en fondu additif
    // (il « brille » avec le bloom). Invisible par défaut.
    if (!this.filet) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbff4ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.filet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, 1, 8), mat);
      this.filet.visible = false;
      this.scene.add(this.filet);
    }
    const f = this.filet;
    const mat = f.material as THREE.MeshBasicMaterial;

    // Pas d'illumination (ou plus de lumière) → pas de filet.
    if (!this.illumineActif || this.niveauLumiere <= 0) { f.visible = false; return; }

    // Cible = l'élément (nœud) 3D le plus proche de Phantom, s'il est à portée.
    let best: THREE.Vector3 | null = null;
    let bestD = Infinity;
    for (const vn of this.noeuds.values()) {
      const d = this.phantom.position.distanceTo(vn.groupe.position);
      if (d < bestD) { bestD = d; best = vn.groupe.position; }
    }
    const PORTEE = 3.5;   // unités 3D : le filet apparaît quand on illumine près d'un élément
    if (!best || bestD > PORTEE) { f.visible = false; return; }

    // Oriente le faisceau de Phantom (a) vers la cible (b) : on le pose au milieu,
    // on l'étire à la bonne longueur, et on le tourne de l'axe Y vers la direction.
    f.visible = true;
    const a = this.phantom.position;
    const dir = new THREE.Vector3().subVectors(best, a);
    const len = dir.length() || 0.001;
    f.position.copy(a).addScaledVector(dir, 0.5);
    f.scale.set(1, len, 1);
    f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    // Opacité qui pulse doucement, proportionnelle à la lumière restante.
    mat.opacity = 0.55 * this.niveauLumiere * (0.8 + 0.2 * Math.sin(this.horloge.elapsedTime * 8));
  }

  /**
   * RÉVÉLATION PROGRESSIVE (chantier UX 2) : décide ce qui ÉMERGE de la brume selon
   * l'état de la ZONE A. La Maison apparaît quand l'Arbre (Cœur) revit ; le pont et
   * toute la zone B apparaissent quand R1 est bien réveillée. Tout en fondu doux.
   * Appelée chaque frame par main3d. Le rendu LIT `reveal` dans synchroniser().
   * @param arbreVieA vie ∈[0,1] de l'Arbre-Cœur de la zone A.
   * @param progA     progression ∈[0,1] de la zone A (R1).
   * @param dt        pas de temps (s) pour le fondu.
   */
  majRevelation(arbreVieA: number, zoneAEveillee: boolean, dt: number): void {
    const k = Math.min(1, dt * 2);                          // vitesse de fondu (~0.5 s)
    const maisonCible = smoothstep5(0.35, 0.60, arbreVieA); // émerge quand l'Arbre revit
    // Le pont + l'autre rive n'apparaissent QUE lorsque R1 est VRAIMENT réveillée (drapeau
    // d'éveil de zone), plus tôt ça donnait un pont « fantôme » transparent prématuré (playtest).
    const zoneBCible = zoneAEveillee ? 1 : 0;
    for (const vu of this.noeuds.values()) {
      const cible = vu.zone === 1 ? zoneBCible
                  : vu.type === "maison" ? maisonCible : 1;
      // MONOTONE : une fois révélé, ça ne se RE-CACHE plus (sinon ça clignote quand la vie
      // baisse — surtout depuis que le déclin est plus fort). Ce qui a émergé reste.
      vu.revealCible = Math.max(vu.revealCible, cible);
      vu.reveal += (vu.revealCible - vu.reveal) * k;
    }
    // Le PONT + L'AUTRE RIVE émergent avec la zone B (même déclencheur) → « le pont apparaît au fond ».
    this.pontReveleCible = Math.max(this.pontReveleCible, zoneBCible);
    this.pontRevele += (this.pontReveleCible - this.pontRevele) * k;
    const rB = this.pontRevele;
    if (this.pont) {
      this.pont.visible = rB > 0.004;
      for (const m of this.pontMats) m.opacity = rB;
    }
    // ÎLE B (terrain de l'autre rive) : fondu opacité. Au plein (rB≈1) on REPASSE en opaque
    // (transparent coûte au tri et peut mal trier un grand sol) ; sinon on la fond.
    const ileB = this.ileVisus[1];
    if (ileB) {
      const opaque = rB >= 0.999;
      for (const mat of [ileB.solMatToon as THREE.Material & { opacity: number }, ileB.solContourMat]) {
        mat.transparent = !opaque; mat.depthWrite = opaque; mat.opacity = opaque ? 1 : rB;
      }
      ileB.sol.visible = rB > 0.004; ileB.solContour.visible = rB > 0.004;
    }
    // BIOMES du ZURG : même fondu (ils peuplent l'autre rive).
    for (const m of this.biomeMats) m.opacity = rB;
    for (const b of this.biomes) b.visible = rB > 0.004;
  }

  /** PHASE 2 : décalage 3D sur X d'une zone (0 = A / -DX, 1 = B / +DX). main3d s'en
   *  sert pour nourrir chaque région et placer les effets, sans dupliquer la constante. */
  zoneDx(index: number): number { return index === 0 ? -DX : DX; }

  /** PHASE 2 : l'île (0 = A, 1 = B) la plus proche de Phantom en ce moment — sert à
   *  savoir quelle zone montrer dans l'UI (ex : barre d'éveil) quand les deux coexistent. */
  zoneProche(): 0 | 1 {
    return Math.abs(this.phantom.position.x - (-DX)) <= Math.abs(this.phantom.position.x - DX) ? 0 : 1;
  }

  /**
   * PHASE 2 : le REGARD de Phantom DANS le repère 2D d'une zone décalée de `dx`.
   * On retire le décalage 3D de la zone avant de reprojeter en coordonnées monde 2D
   * → chaque région reçoit le regard dans SON propre repère (et seule la zone proche
   * réagit, l'autre étant hors de portée `attR`). Renvoie null tant que Phantom n'a
   * pas de position (avant le 1er rendu).
   */
  getRegardPourZone(dx: number): Vec2 | null {
    if (!this.regardMonde) return null;
    return { x: (this.phantom.position.x - dx) * ECH + 160,
             y: this.phantom.position.z * ECH + 144 };
  }

  /**
   * Avance toutes les animations et dessine une frame.
   * @param neant ∈ [0,1] l'oubli (resserre la brume, éteint la lumière).
   * @param progression ∈ [0,1] la vie revenue (éclaircit le ciel, réchauffe la lumière).
   */
  /**
   * APERÇUS du Néant à COMPARER (prototypes). Appelé en fin de `rendre`, APRÈS la
   * modulation normale du ciel/brume → il la surcharge selon `this.apercu` :
   *   0 = normal (rien) · 1 = « L'Appel » (le monde se termine dans une mer de lumière
   *   nacrée) · 2 = « Le reflet » (le sol devient un miroir d'eau noire).
   */
  private appliquerApercu(): void {
    const enReflet = this.apercu === 2;
    if (this.miroir) this.miroir.visible = enReflet;
    // Les sols toon restent TOUJOURS visibles : le miroir se pose PAR-DESSUS la zone A
    // et n'apparaît que dans les zones négligées (alpha transparent près de Phantom).

    const fog = this.scene.fog as THREE.Fog;
    if (this.apercu === 1) {
      // « L'APPEL » : la brume devient CLAIRE et se rapproche → le décor se dissout dans
      // une lumière nacrée (pas dans le noir). Le ciel s'embrase de blanc à l'horizon.
      fog.color.setHex(0xeae6f2);
      fog.near = 9; fog.far = 30;
      (this.cielMat.uniforms.horizon.value as THREE.Color).setHex(0xf3eff8);
      (this.cielMat.uniforms.haut.value as THREE.Color).setHex(0xd2d4ea);
      (this.cielMat.uniforms.bas.value as THREE.Color).setHex(0xe9e5f1);
      this.renderer.toneMappingExposure += 0.25;   // base posée juste avant dans rendre()
      this.bloom.strength += 0.2;
    } else if (this.apercu === 2) {
      // « LE REFLET » : eau noire et brume sombre pour que le miroir et ses reflets ressortent.
      fog.color.setHex(0x05060d);
      fog.near = 10; fog.far = 44;
      (this.cielMat.uniforms.bas.value as THREE.Color).setHex(0x05060d);
    } else {
      // Normal : on restaure le bas du ciel (horizon/haut sont déjà remis par rendre()).
      (this.cielMat.uniforms.bas.value as THREE.Color).setHex(0x0a0a1a);
    }
  }

  /**
   * PHASE 2 : met à jour UNE île (zone) selon SA propre vie. Appelée par main3d pour
   * chaque zone, AVANT rendre(). Pilote la couleur du sol (terne→vif) et l'érosion (qui
   * reste cosmétique depuis la Phase 1 : l'île reste pleine, juste plus terne).
   * @param i      index de zone (0 = A / -DX, 1 = B / +DX)
   * @param neant  ∈[0,1] l'oubli de CETTE zone
   * @param vie    ∈[0,1] la vie de CETTE zone (progression)
   */
  majIle(i: number, neant: number, vie: number): void {
    const ile = this.ileVisus[i];
    if (!ile) return;
    // Palette de sol PAR ZONE : jardin vert intime (A) vs Zurg ocre/monde ouvert (B).
    const terne = i === 1 ? this.solTerneZurg : this.solTerne;
    const vif   = i === 1 ? this.solVivantZurg : this.solVivant;
    ile.solMatToon.color.copy(terne).lerp(vif, vie);
    ile.erosion.uNeant.value = neant;
    ile.erosion.uFrem.value = neantFremissement(this.horloge.elapsedTime, neant);
  }

  rendre(neant: number, progression = 0): void {
    const dt = Math.min(this.horloge.getDelta(), 0.05);
    const t = this.horloge.elapsedTime;

    // CLIMAX DE FIN « Le Don » : si actif, il pilote Phantom + la caméra (et neutralise
    // le déplacement clavier ci-dessous via le garde `finSeq < 0`).
    if (this.finSeq >= 0) this.animerFin(dt);

    // 1) DÉPLACEMENT de Phantom au clavier (Z Q S D / flèches), relatif à la
    //    caméra. La caméra le SUIT, et son « regard » = là où il se trouve :
    //    s'approcher d'un élément (porter sa présence dessus), c'est le raviver.
    const avant = new THREE.Vector3();
    this.camera.getWorldDirection(avant); avant.y = 0; avant.normalize();
    const droite = new THREE.Vector3().crossVectors(avant, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    const k = this.touches;
    if (k["KeyW"] || k["KeyZ"] || k["ArrowUp"]) mv.add(avant);
    if (k["KeyS"] || k["ArrowDown"]) mv.sub(avant);
    if (k["KeyD"] || k["ArrowRight"]) mv.add(droite);
    if (k["KeyA"] || k["KeyQ"] || k["ArrowLeft"]) mv.sub(droite);
    if (this.finSeq < 0 && mv.lengthSq() > 0) {
      mv.normalize().multiplyScalar(4 * dt);
      this.phantom.position.x += mv.x; this.phantom.position.z += mv.z;
      this.camera.position.add(mv);                          // la caméra le suit
      this.phantom.rotation.y = Math.atan2(mv.x, mv.z);      // il se tourne vers où il va
    }
    // ── CONTENANCE DOUCE : Phantom ne TOMBE PLUS dans le vide. Si sa position déborde de
    //    la surface marchable (îles + pont), une « marée » tendre le ramène vers le bord
    //    le plus proche. Il peut FRÔLER le vide (on laisse `dehors` grandir un peu) mais
    //    ne le franchit jamais. La caméra suit la même correction (sinon elle dériverait).
    if (this.finSeq < 0) {
      const c = contenir(this.phantom.position.x, this.phantom.position.z);
      // Force du coussin : douce quand on effleure, plus ferme plus on s'enfonce dans le
      // vide (mais jamais sèche). lerp ∈ [0.06 ; 0.5].
      const force = c.dehors > 0 ? Math.min(0.5, 0.06 + c.dehors * 0.25) : 0;
      this.contenanceDehors = c.dehors;                       // pour le Veilleur (rattrapage)
      this.contenanceCible.set(c.x, this.phantom.position.y, c.z);
      if (force > 0) {
        const corrX = (c.x - this.phantom.position.x) * force;
        const corrZ = (c.z - this.phantom.position.z) * force;
        this.phantom.position.x += corrX; this.phantom.position.z += corrZ;
        this.camera.position.x += corrX; this.camera.position.z += corrZ;   // la caméra suit
      }
    }
    // La caméra vise Phantom (suivi 3e personne souple).
    this.controls.target.lerp(
      new THREE.Vector3(this.phantom.position.x, 1.5, this.phantom.position.z), 0.2);
    // Le REGARD du jeu = la position de Phantom, en coordonnées monde 2D NON décalées
    // (repère « centré »). main3d le re-décale par zone pour nourrir chaque région.
    this.regardMonde = { x: this.phantom.position.x * ECH + 160,
                         y: this.phantom.position.z * ECH + 144 };
    this.phantom.position.y = 0.95 + Math.sin(t * 1.1) * 0.1;
    if (this.finSeq < 0) {
      // FEEDBACK D'ILLUMINATION : quand Phantom illumine, son halo s'intensifie
      // nettement (on VOIT qu'il donne sa lumière). Sinon, halo de présence normal.
      const boostIllum = this.illumineActif ? 0.22 * this.niveauLumiere : 0;
      this.phantomHalo.material.opacity =
        0.07 + this.veilleuseAllumage * 0.16 + Math.sin(t * 2) * 0.025 + boostIllum;
    }
    // VFX : le filet de lumière Phantom → cible illuminée.
    this.majFilet();

    // ── BRAISE → VEILLEUSE : la 1re flamme s'allume + la présence grandit ──────
    if (this.veilleuseFlamme) {
      // 1) ALLUMAGE DOUX : on monte de 0 → 1 en ~2,5 s (dt/2.5), jamais d'à-coup.
      this.veilleuseAllumage = Math.min(1, this.veilleuseAllumage + dt / 2.5);
      const a = smoothstep5(0, 1, this.veilleuseAllumage);   // courbe douce (ease)
      // 2) RESPIRATION : une fois allumée, elle pulse très légèrement (un souffle).
      const souffle = 0.88 + 0.12 * Math.sin(t * 1.6);       // ∈ [0,76 ; 1,00]
      this.veilleuseFlamme.material.opacity = a * 0.6 * souffle;
      // La flamme « respire » aussi en taille (imperceptible, juste vivant).
      const s = 1.25 * (0.96 + 0.04 * Math.sin(t * 1.6));
      this.veilleuseFlamme.scale.set(s, s, 1);
    }
    // 3) LA LUMIÈRE SORT DE LUI : le halo de présence grandit en douceur vers sa
    //    cible (lerp ~1,5 s). On SENT la lumière s'étendre et toucher le sol autour.
    //    On garde une taille de BASE qui converge vers la cible…
    this.veilleuseHaloBase = this.veilleuseHaloBase
      + (this.veilleuseHaloCible - this.veilleuseHaloBase) * Math.min(1, dt / 1.5);
    // …puis on retire le resserrement de l'INSPIR (T1 de la séquence) : Phantom prend
    // son souffle, le halo se replie un instant vers lui avant de déborder.
    const tailleHalo = this.veilleuseHaloBase * (1 - this.veilleuseInspir);
    this.phantomHalo.scale.set(tailleHalo, tailleHalo, 1);

    // ── LE MOMENT D'ÉVOLUTION « le monde s'embrase » (séquence ~3,5 s) ─────────
    // Avance la séquence et récupère le BOOST de climax (cloche du Débordement) à
    // ajouter au bloom/exposition plus bas. Hors séquence, renvoie 0 (aucun effet).
    const embrase = this.animerVeilleuseSeq(dt);

    // 2) Les nœuds respirent doucement.
    for (const vu of this.noeuds.values())
      vu.groupe.position.y = vu.base.y + Math.sin(t * 1.3 + vu.base.x) * 0.05;

    // 3) Engrammes qui montent.
    for (let i = 0; i < this.vitEngr.length; i++) {
      this.posEngr[i * 3 + 1] += this.vitEngr[i] * dt;
      if (this.posEngr[i * 3 + 1] > 12) this.posEngr[i * 3 + 1] = 0;
    }
    this.engrammes.geometry.attributes.position.needsUpdate = true;

    // 4) Flashs d'éveil : grandissent et s'effacent.
    for (let i = this.flashs.length - 1; i >= 0; i--) {
      const f = this.flashs[i]; f.vie -= dt * 1.2;
      f.halo.scale.setScalar(2 + (1 - f.vie) * 6);
      f.halo.material.opacity = Math.max(0, f.vie) * 0.9;
      if (f.vie <= 0) { this.scene.remove(f.halo); this.flashs.splice(i, 1); }
    }

    // 5) GRAND ÉVEIL : les anneaux de lumière s'étendent depuis le Cœur, puis s'effacent.
    for (let i = this.anneaux.length - 1; i >= 0; i--) {
      const a = this.anneaux[i]; a.vie -= dt;
      const k = 1 - a.vie / a.max;
      a.mesh.scale.setScalar(1 + k * 24);
      (a.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, a.vie / a.max) * 0.85;
      if (a.vie <= 0) { this.scene.remove(a.mesh); this.anneaux.splice(i, 1); }
    }
    if (this.celebration > 0) this.celebration = Math.max(0, this.celebration - dt);
    if (this.beam) {                          // la colonne de lumière monte et s'efface
      this.beam.rotation.y += dt * 0.6;
      this.beam.scale.x = this.beam.scale.z = 1 + (1 - this.celebration / 4) * 0.6;
      (this.beam.material as THREE.MeshBasicMaterial).opacity = (this.celebration / 4) * 0.55;
      if (this.celebration <= 0) { this.scene.remove(this.beam); this.beam = undefined; }
    }

    // 6) NÉANT ⟷ PROGRESSION : l'oubli resserre la brume et éteint la lumière ; la
    //    vie qui revient éclaircit le ciel et la réchauffe. L'Éveil final ajoute une
    //    embellie passagère (fete).
    const fete = this.celebration / 4;
    const vie = Math.min(1, progression + fete * 0.5);   // niveau de vie global 0→1
    // PHASE 2 : la COULEUR de chaque île et son ÉROSION sont pilotées par zone via
    // majIle() (chaque île suit SA vie). Ici `rendre` ne gère QUE l'ambiance GLOBALE
    // (ciel/brume/lumières) à partir du neant/progression combinés des deux zones.
    // Le monde S'OUVRE et S'ÉCLAIRE FRANCHEMENT avec la vie (lever de jour) ; le
    // Néant le referme et l'assombrit. C'est le contraste « la vie illumine ».
    // La brume (le bord du vide) FRÉMIT de façon inégale quand le Néant est intense
    // (fonction pure du core, ai-programmer) → le vide « ronge » au lieu d'avancer lisse.
    const fog = this.scene.fog as THREE.Fog;
    // PHASE 1 : le Néant ne RAPPROCHE plus que doucement le fond de brume (l'horizon
    // reste lointain et visible au repos), au lieu de claquer un mur près de l'île.
    fog.far = 32 - neant * FOG_RAPPROCHE_NEANT + progression * 18 + fete * 12
            + neantFremissement(t, neant) * 40;
    // COULEUR de la brume : tiède → CRÉPUSCULE doux quand le Néant monte (plus de noir-
    // vide), puis tiède → aube quand la vie revient. Deux lerps sur une couleur pré-allouée.
    fog.color.copy(this.fogTiede).lerp(this.fogCrepuscule, neant).lerp(this.fogVivant, vie * 0.6);
    // Le DÉBUT de la brume ne se rapproche QUE légèrement avec le Néant → la prairie
    // endormie reste lisible, elle ne « disparaît » pas dans la brume au repos.
    fog.near = 12 - neant * FOG_NEAR_NEANT + progression * 4;
    this.key.intensity = (2.0 + Math.sin(t * 0.35) * 0.3) * (1 - neant * LUM_BAISSE_KEY)
                       + progression * 0.95 + fete * 1.0;
    this.amb.intensity = 0.25 + progression * 0.7 + fete * 0.5;
    this.hemi.intensity = (0.65 + progression * 1.05 + fete) * (1 - neant * LUM_BAISSE_HEMI);
    (this.hemi.groundColor as THREE.Color).copy(
      new THREE.Color(0x2a3724).lerp(new THREE.Color(0x5b8f46), vie));
    this.rim.intensity = 0.85 + fete * 0.6;
    (this.cielMat.uniforms.horizon.value as THREE.Color).copy(
      new THREE.Color(0x16203a).lerp(new THREE.Color(0x7596bb), vie));  // ciel de lever de jour
    // PHASE 1 : le HAUT du ciel ne se referme PLUS vers le noir dans le Néant — il glisse
    // vers un crépuscule présent (CIEL_HAUT_CREPUSCULE), et s'éclaircit avec la vie.
    (this.cielMat.uniforms.haut.value as THREE.Color).copy(
      new THREE.Color(0x0a0f1f).lerp(new THREE.Color(CIEL_HAUT_CREPUSCULE), neant).lerp(
        new THREE.Color(0x18233f), vie * 0.7));

    // ── L'EFFACEMENT du CIEL (global, piloté par le neant combiné) ────────────
    // (L'érosion du SOL est par île, mise à jour dans majIle().)
    this.cielMat.uniforms.uNeant.value = neant;
    // « LE REFLET » : le masque du miroir suit la PRÉSENCE de Phantom (il recule près de lui)
    // et l'intensité du NÉANT (il gagne du terrain quand on néglige). Frontière qui ondule.
    if (this.miroir) {
      const mu = (this.miroir.material as THREE.ShaderMaterial).uniforms;
      (mu.uPhantom.value as THREE.Vector2).set(this.phantom.position.x, this.phantom.position.z);
      mu.uNeantM.value = neant;
      mu.uFremM.value = neantFremissement(t, neant);
      mu.uTimeM.value = t;
    }
    // L'HORIZON DISPARAÎT aussi via les poussières lointaines (engrammes) qui s'effacent
    // avec le Néant : moins de repères au loin → le vide devient continu.
    (this.engrammes.material as THREE.PointsMaterial).opacity = 0.6 * (1 - neant * 0.9);

    // POST-TRAITEMENT piloté par l'état du jeu : le Néant DÉSATURE l'image (la couleur
    // QUITTE le monde) ; la vie l'ÉCLAIRE et la RECOLORE FORTEMENT. Bloom qui enfle au
    // climax. On garde une EXPOSITION minimale même au Néant fort : on veut un noir NET
    // (le contraste vient du fond sombre + bloom), pas une bouillie sous-éclairée.
    this.grade.uniforms.saturation.value = -0.45 * neant + 0.35 * progression + fete * 0.2;
    // (3d) Au climax du DÉBORDEMENT, le bloom GONFLE et l'exposition monte un peu, puis
    //      tout revient (la cloche `embrase` retombe à 0). PLAFOND DUR 1.0 sur le bloom :
    //      jamais de flash plein écran (sécurité épilepsie). `embrase` mène vers ~0.95.
    // Glow de base BAS (couleurs/formes lisibles), + un peu avec la vie ; les BOOSTS du
    // climax « Le Don » (fete/embrase) restent forts pour que le moment éclate (plafond 1.0).
    this.bloom.strength = Math.min(1.0,
      BLOOM_BASE + neant * 0.12 + progression * BLOOM_VIE + fete * 0.45 + embrase * 0.18);
    this.renderer.toneMappingExposure = 0.92 + progression * 0.4 + fete * 0.12
                                            + embrase * 0.12;   // base sombre, monte au pic

    this.appliquerApercu();   // aperçus du Néant à comparer (touches 1 / 2 / 0)
    this.controls.update();
    this.composer.render();
  }
}

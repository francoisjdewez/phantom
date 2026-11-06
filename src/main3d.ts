// ════════════════════════════════════════════════════════════════════════
//  PHANTOM — POINT D'ENTRÉE 3D (Three.js) — LE VRAI JEU.
//
//  PHASE 2 « MONDE CONTINU » : R1 (zone A) et R2 (zone B) coexistent dans UNE
//  scène, reliées par un PONT que Phantom traverse à pied. Les DEUX régions sont
//  VIVANTES en même temps : chaque frame, on fait penser les deux cerveaux et on
//  rend les deux décors (chacun à son décalage 3D). Plus d'écran ni de cinématique
//  entre les régions. Fil du jeu :
//      écran-titre → on JOUE le monde (2 zones) → quand les DEUX sont réveillées
//                  → climax « Le Don » → écran de fin → (rejouer)
//
//  Qui fait quoi :
//   - core/flux.ts : DIT dans quel écran on est (pur).
//   - core/Region  : LE CERVEAU d'une zone (logique pure). On en a DEUX.
//   - ce fichier   : nourrit les deux cerveaux avec le regard de Phantom DANS leur
//                    repère local, et dessine les deux décors via le renderer.
// ════════════════════════════════════════════════════════════════════════

import { Region } from "./core/Region.js";
import { Phantom } from "./core/phantom.js";
import { attentionAt } from "./core/attention.js";
import { Flux } from "./core/flux.js";
import { PiuwSystem } from "./core/piuws.js";
import { DoublesSystem } from "./core/doubles.js";
import { PiuwPerdu } from "./core/introPiuw.js";
import { Renderer3D } from "./render3d/Renderer3D.js";
import { Musique } from "./audio/musique.js";
import type { Reve, Vec2 } from "./core/types.js";

// ── LE VILLAGE DU ZURG (zone B) : les 8 RÊVES y vivent ENSEMBLE, en permanence. ──
// Le rêve d'un Piuw ne sert qu'au RENDU/caractère (couleur, forme, geste) — le
// distribuer ne touche PAS l'équilibrage (le soutien reste plafonné à PIUW_PLAFOND_SOIN,
// les Piuws ne peuvent jamais éveiller un nœud seuls).
const REVES_ZURG: readonly Reve[] = [
  "sauver", "creer", "explorer", "esperer", "proteger", "comprendre", "transmettre", "se-souvenir",
];
const VILLAGE_VIE = 60;     // vie LONGUE des Piuws du ZURG (s) → population stable, pas « 10 s »
const VILLAGE_CIBLE = 16;   // rééq. 19/08 (playtest, 32→16) : trop de Piuws à l'écran

// Les deux zones du monde : leur cerveau (Region), leurs systèmes vivants (Piuws/
// Doubles), et leur index de zone côté rendu (0 = A / -DX, 1 = B / +DX).
interface Zone {
  region: Region;
  piuws: PiuwSystem;
  doubles: DoublesSystem;
  index: number;
}

function demarrer(): void {
  const hote = document.getElementById("app");
  if (!hote) throw new Error("Élément #app introuvable dans index3d.html");

  // Les écrans qui RESTENT : titre + fin (l'écran de victoire de région a disparu).
  const ecranTitre = document.getElementById("ecran-titre")!;
  const ecranFin = document.getElementById("ecran-fin")!;

  // ── ONBOARDING (chantier UX 1) : les indices de touches du « tutoriel invisible ».
  // Deux petits indices près de Phantom, en fondu, qui DISPARAISSENT à jamais une fois
  // le geste appris (1er pas → ZQSD ; 1re illumination → Espace). Aucun texte permanent.
  const indDeplacement = document.getElementById("indice-deplacement")!;
  const indIllumination = document.getElementById("indice-illumination")!;
  // Barre d'éveil R1 (haut-centre) : avancée visible pendant qu'on joue (choix de design).
  const barreEveil = document.getElementById("barre-eveil")!;
  const barreEveilFill = barreEveil.querySelector(".remplissage") as HTMLElement;
  let obBouge = false;        // le joueur a-t-il déjà bougé ? (retire ZQSD à jamais)
  let obIllumine = false;     // a-t-il déjà illuminé ? (retire Espace à jamais)
  let obTpsEnJeu = 0;         // temps écoulé depuis l'entrée en monde (hésitation ZQSD)
  let obTpsPresPiuw = 0;      // temps passé près du Piuw perdu sans illuminer (hésitation Espace)
  let tempsImmobile = 0;      // temps sans appuyer de touche de déplacement (→ Piuw compagnon guide)

  // LE FIL DU JEU (machine à états pure). On démarre sur l'écran-titre.
  const flux = new Flux();
  (window as unknown as { __flux: Flux }).__flux = flux;

  // LES YEUX 3D : créés UNE SEULE FOIS et RÉUTILISÉS (rebuild du monde au « rejouer »).
  const r3d = new Renderer3D(hote);
  (window as unknown as { __r3d: Renderer3D }).__r3d = r3d;
  (window as unknown as { __essaimerMaintenant: () => number }).__essaimerMaintenant =
    () => r3d.essaimerMaintenant();

  // L'AUDIO : « La Petite Lumière » (couche par-dessus, LIT l'état). Muette tant que
  // le joueur n'a pas cliqué pour entrer (politique navigateur).
  const musique = new Musique();
  (window as unknown as { __musique: Musique }).__musique = musique;

  // L'ÉTAT LUMINEUX du joueur : sa réserve de lumière pour ILLUMINER (geste central).
  // Persistant sur la session ; remis à plein au « rejouer » (dans construireMonde).
  const phantom = new Phantom();

  // ── L'ÉTAT VIVANT DU MONDE : DEUX zones + le Piuw perdu d'intro (en zone A). ──
  let zones: Zone[];
  let introPiuw: PiuwPerdu;
  // Le climax de fin « Le Don » est-il en cours ? (bloque l'écran de clôture + appuis.)
  let finEnCours = false;
  // La victoire finale a-t-elle déjà été déclenchée ? (évite de relancer le climax.)
  let finDeclenchee = false;

  /**
   * (RE)CONSTRUIT tout le MONDE CONTINU : les deux cerveaux (Region A & B), leurs
   * systèmes vivants, le Piuw perdu d'intro, et le décor 3D des deux zones en une fois.
   */
  function construireMonde(): void {
    const data = flux.regions;   // [region1, region2]
    zones = data.map((d, i) => ({
      region: new Region(d),
      piuws: new PiuwSystem(),
      doubles: new DoublesSystem(),
      index: i,
    }));
    // Debug : la zone A inspectable (window.__phantom = cerveau de R1, comme avant).
    (window as unknown as { __phantom: Region }).__phantom = zones[0].region;
    (window as unknown as { __zones: Zone[] }).__zones = zones;
    // Le Piuw perdu d'intro vit en ZONE A (sa « fleur » de référence = le Cœur de A).
    // PARCOURS « vue de face » : le Piuw est la 1re rencontre, droit devant sur l'axe
    // d'avancée (entre le départ de Phantom et l'Arbre).
    introPiuw = new PiuwPerdu({ x: 76, y: 144 });
    finEnCours = false;
    finDeclenchee = false;
    phantom.lumiere = 1;   // réserve de lumière pleine au (re)départ
    // Onboarding remis à neuf : un monde frais = un tutoriel invisible frais.
    obBouge = false; obIllumine = false; obTpsEnJeu = 0; obTpsPresPiuw = 0;
    tempsImmobile = 0;
    // Le décor 3D : les deux îles + le pont existent déjà (créés une fois dans le
    // renderer). On y POSE les nœuds des deux régions, chacun à son décalage.
    r3d.construireMondeContinu(zones[0].region.tousLesNoeuds(),
                              zones[1].region.tousLesNoeuds());
  }

  /** Met l'AFFICHAGE des overlays en accord avec l'étape du flux (titre / fin). */
  function majEcrans(): void {
    ecranTitre.classList.toggle("visible", flux.etape === "titre");
    ecranFin.classList.toggle("visible", flux.etape === "victoire-finale" && !finEnCours);
  }

  /**
   * ONBOARDING (chantier UX 1) : gère les indices de touches du tutoriel invisible.
   * - ZQSD : apparaît si le joueur n'a pas bougé après ~3 s d'hésitation ; disparaît
   *   à jamais dès le 1er pas.
   * - ESPACE : apparaît quand il s'approche du Piuw perdu sans l'illuminer (après une
   *   courte hésitation) ; disparaît à jamais dès la 1re illumination.
   * Les deux ne sont jamais visibles en même temps (l'un exige « pas encore bougé »,
   * l'autre « a bougé »). On les pose JUSTE au-dessus de Phantom à l'écran.
   */
  function majIndices(dt: number, enJeu: boolean, illumine: boolean, intro: PiuwPerdu): void {
    if (!enJeu) {
      indDeplacement.classList.remove("visible");
      indIllumination.classList.remove("visible");
      return;
    }
    obTpsEnJeu += dt;
    // Gestes appris = irréversibles (une fois compris, l'indice ne revient jamais).
    if (r3d.deplacementDemande()) obBouge = true;
    if (illumine) obIllumine = true;

    // INDICE ZQSD : tant qu'il n'a pas bougé, après une hésitation de ~3 s.
    const montrerDep = !obBouge && obTpsEnJeu > 3;
    indDeplacement.classList.toggle("visible", montrerDep);

    // INDICE ESPACE : a bougé, pas encore illuminé, proche du Piuw encore perdu,
    // après ~1,5 s d'hésitation à côté de lui.
    const regardA = r3d.getRegardPourZone(r3d.zoneDx(0));
    const presDuPiuw = !!regardA && intro.etat === "perdu" &&
      Math.hypot(regardA.x - intro.pos.x, regardA.y - intro.pos.y) < 45;
    obTpsPresPiuw = presDuPiuw ? obTpsPresPiuw + dt : 0;
    const montrerIll = obBouge && !obIllumine && presDuPiuw && obTpsPresPiuw > 1.5;
    indIllumination.classList.toggle("visible", montrerIll);

    // Positionnement : juste au-dessus de Phantom à l'écran (il est suivi par la caméra).
    if (montrerDep || montrerIll) {
      const ecran = r3d.phantomEcran();
      if (ecran) {
        const left = ecran.x + "px", top = (ecran.y - 64) + "px";
        const cible = montrerDep ? indDeplacement : indIllumination;
        cible.style.left = left; cible.style.top = top;
      }
    }
  }

  // ── APPUIS du JOUEUR (clic/touche) : entrer depuis le titre, ou rejouer à la fin. ──
  function avancerSurAppui(): void {
    if (finEnCours) return;   // pendant le climax « Le Don », les appuis sont ignorés
    if (flux.etape === "titre") {
      flux.commencer();        // titre → on JOUE le monde continu (déjà bâti en fond)
      // MUSIQUE DÉSACTIVÉE (19/08) — après une journée d'essais (timbres, tempo,
      // fondu, accordage 432Hz, version minimaliste...), aucune version n'a convaincu.
      // Retour au silence, comme le 22/06. Pour la réactiver un jour :
      // décommenter la ligne ci-dessous (le code de `musique.ts` reste disponible).
      // void musique.demarrerSurGeste();
    } else if (flux.etape === "victoire-finale") {
      flux.rejouer();          // fin → retour au titre
      construireMonde();       // on remet le monde à neuf pour rejouer
    }
    majEcrans();
  }
  addEventListener("pointerdown", avancerSurAppui);
  addEventListener("keydown", () => {
    // On n'avance les écrans que lorsqu'un écran est affiché (titre/fin).
    if (flux.etape !== "region") avancerSurAppui();
  });

  // On démarre sur le titre, mais on construit DÉJÀ le monde en fond (joli décor 3D).
  construireMonde();
  majEcrans();

  // ── LA BOUCLE de jeu (tourne toujours ; le rendu de fond continue sous les écrans). ──
  let dernier = performance.now();
  function frame(maintenant: number): void {
    const dt = Math.min(0.05, (maintenant - dernier) / 1000);
    dernier = maintenant;

    // On ne fait PENSER le monde que pendant qu'on JOUE (étape "region").
    const enJeu = flux.etape === "region";

    // ILLUMINATION : actif si Espace tenu ET réserve de lumière dispo. Calculé en
    // a), réutilisé en c) pour le Piuw d'intro → déclaré ici (portée de la frame).
    let illumineActif = false;

    // a) PENSER : chaque zone reçoit le regard de Phantom DANS SON repère local
    //    (on retire le décalage 3D de la zone). La portée `attR` fait que seule la
    //    zone proche réagit → pas besoin de garde manuel.
    if (enJeu) {
      // Le joueur tient-il Espace ? On calcule la « vie proche » de Phantom (pour sa
      // recharge) = le meilleur (proximité × vie) sur tous les nœuds des deux zones.
      // Puis sa réserve de lumière décide si l'illumination est ACTIVE (core/phantom.ts).
      const illumineDemande = r3d.estIllumine();
      let vieProche = 0;
      for (const z of zones) {
        const regardZone = r3d.getRegardPourZone(r3d.zoneDx(z.index));
        if (!regardZone) continue;
        for (const n of z.region.tousLesNoeuds())
          vieProche = Math.max(vieProche, attentionAt(regardZone, n.pos, n.attR) * n.v);
      }
      illumineActif = phantom.update(dt, illumineDemande, vieProche);

      // On nourrit chaque zone : un élément ne GRANDIT que si l'illumination est active.
      for (const z of zones) {
        const regardZone = r3d.getRegardPourZone(r3d.zoneDx(z.index));
        z.region.update(dt, regardZone, illumineActif);
      }
      // Feedback visuel : le halo de Phantom s'intensifie quand il illumine.
      r3d.setIllumination(illumineActif, phantom.lumiere);
    }

    // b) Moments marquants des DEUX zones (flashs, naissances de Piuws, éveils).
    for (const z of zones) {
      const dx = r3d.zoneDx(z.index);
      for (const ev of z.region.viderEvenements()) {
        if (ev.type === "region-eveillee") {
          if (z.index === 1) {
            // ZURG éveillé → on AMORCE le VILLAGE : au moins 1 Piuw de CHACUN des 8 rêves
            // (les 8 variétés visibles d'emblée), avec une vie longue (village persistant).
            for (const r of REVES_ZURG) z.piuws.naitre(ev.pos, 1, r, VILLAGE_VIE);
            z.piuws.naitre(ev.pos, 14, ev.reve, VILLAGE_VIE);   // + un gros lot festif
          } else {
            z.piuws.naitre(ev.pos, 14, ev.reve);
          }
          // Une zone vient de s'éveiller : célébration in-world (pas d'écran).
          r3d.grandEveil(ev.pos, dx);
          // DÉCLENCHEUR DE FIN ROBUSTE : on s'appuie sur les DRAPEAUX LATCHÉS (eveillee
          // reste vrai une fois acquis). Si les DEUX zones sont éveillées → climax.
          if (!finDeclenchee && zones[0].region.eveillee && zones[1].region.eveillee) {
            finDeclenchee = true;
            finEnCours = true;
            flux.mondeEveille();
            // Le climax « Le Don » se joue au Cœur de la zone B (la dernière atteinte
            // narrativement). On lui passe son décalage pour viser le bon endroit.
            r3d.jouerFin(zones[1].region.coeur.pos, r3d.zoneDx(1));
            majEcrans();
          }
        } else {
          r3d.eveil(ev.pos, ev.nodeType, dx);
          if (z.index === 1) {
            // ZURG : un nœud s'éveille → un petit lot VARIÉ (pas juste son rêve).
            for (let i = 0; i < 6; i++)
              z.piuws.naitre(ev.pos, 1, REVES_ZURG[(Math.random() * REVES_ZURG.length) | 0], VILLAGE_VIE);
          } else {
            z.piuws.naitre(ev.pos, 4, ev.reve);
          }
          // [DÉSACTIVÉ 22/06] La transformation « Braise → Veilleuse »
          // (1re évolution = lanterne habitée) masquait le feedback d'ILLUMINATION (son gros
          // halo noyait le geste). On la retire POUR LE MOMENT pour que l'illumination reste
          // toujours visible. À réactiver plus tard, une fois le VFX d'illumination distinct.
          // r3d.allumerVeilleuse(ev.reve);
        }
      }
    }

    // Le climax de fin « Le Don » est terminé → on révèle l'écran de clôture sobre.
    if (finEnCours && r3d.finTerminee()) { finEnCours = false; majEcrans(); }

    // c) LES SYSTÈMES VIVANTS de chaque zone avancent (purs). Figés hors-jeu.
    if (enJeu) {
      for (const z of zones) {
        const noeuds = z.region.tousLesNoeuds();
        // ZURG (zone B) : VILLAGE PERSISTANT → production VARIÉE (8 rêves) + vie longue +
        // population-cible maintenue tant qu'il est vivant. Zone A : production sobre (défaut).
        const village = z.index === 1
          ? { reves: REVES_ZURG, vie: VILLAGE_VIE, cible: VILLAGE_CIBLE } : undefined;
        // CORTÈGE : on donne aux Piuws la position de Phantom (repère de la zone) +
        // s'il illumine → ceux qui sont proches s'accrochent et le suivent.
        const regardZone = r3d.getRegardPourZone(r3d.zoneDx(z.index));
        const phantomZone = regardZone ? { pos: regardZone, illumine: illumineActif } : undefined;
        z.piuws.update(dt, noeuds, village, phantomZone);
        z.doubles.update(dt, noeuds);
      }
      // COMPAGNON (chantier UX 4) : hésitation du joueur = pas de touche de déplacement.
      if (r3d.deplacementDemande()) tempsImmobile = 0; else tempsImmobile += dt;
      const joueurHesite = tempsImmobile > 0.8;
      // La PROCHAINE chose à raviver en zone A : l'Arbre tant qu'il dort, puis la Maison.
      // (On vise l'Arbre d'abord ; la Maison ensuite, une fois qu'elle a émergé.)
      const za = zones[0].region;
      let prochaineCible: Vec2 | null = null;
      if (!za.coeur.eveille) prochaineCible = za.coeur.pos;
      else {
        const m = za.tousLesNoeuds().find((n) => n.id === "r1-maison" && !n.eveille);
        if (m) prochaineCible = m.pos;
      }
      // Le Piuw d'intro : perdu → sauvé → COMPAGNON qui suit Phantom et guide à l'hésitation.
      introPiuw.update(dt, r3d.getRegardPourZone(r3d.zoneDx(0)), prochaineCible, illumineActif, joueurHesite);
    }

    // RÉVÉLATION PROGRESSIVE (chantier UX 2) : la Maison émerge quand l'Arbre revit ;
    // le pont + toute la zone B émergent quand R1 se réveille. (Avance seulement en jeu.)
    if (enJeu) r3d.majRevelation(zones[0].region.coeur.v, zones[0].region.eveillee, dt);

    // BARRE D'ÉVEIL (haut-centre) : remplie selon la progression de la zone où est
    // Phantom EN CE MOMENT (r3d.zoneProche()). CORRECTIF 19/08 (playtest,
    // « toujours remplie en passant en R2 ») : avant, elle affichait TOUJOURS la zone A
    // — normal qu'elle reste pleine (R1 acquis) une fois passé côté R2, comme si R2
    // était déjà fini. Elle bascule maintenant sur la vraie zone courante.
    barreEveil.classList.toggle("visible", enJeu);
    if (enJeu) {
      const zoneIndex = r3d.zoneProche();
      const zoneUI = zones[zoneIndex].region;
      const progUI = zoneUI.progressionVersVictoire();
      barreEveilFill.style.width = Math.round(progUI * 100) + "%";
      // Couleur par zone (choix de design) : vert R1, orange R2.
      barreEveilFill.classList.toggle("zone-r2", zoneIndex === 1);
      barreEveilFill.classList.toggle("a-de-la-vie", progUI > 0);
    }

    // d) DESSINER : Piuws/Doubles par zone (à leur décalage), île par île (sa vie),
    //    puis UN SEUL appel synchroniser() avec TOUS les nœuds des deux zones (les
    //    positions sont déjà décalées au build → un seul passage évite que le `dt`
    //    interne ne soit consommé deux fois, ce qui figerait les minuteurs d'essaimage).
    const tousLesNoeuds = [];
    for (const z of zones) {
      r3d.synchroniserPiuws(z.piuws.liste, z.index);
      r3d.synchroniserDoubles(z.doubles.liste, z.index);
      r3d.majIle(z.index, z.region.neant, z.region.progression());
      tousLesNoeuds.push(...z.region.tousLesNoeuds());
    }
    r3d.synchroniser(tousLesNoeuds);
    r3d.majIntro(introPiuw, r3d.zoneDx(0));   // le Piuw perdu d'intro, rendu en zone A

    // AMBIANCE GLOBALE (ciel/brume/lumières) : on prend le neant/vie COMBINÉS des deux
    // zones (max du néant = le pire des deux ; moyenne de la vie = ambiance d'ensemble).
    const neantGlobal = Math.max(zones[0].region.neant, zones[1].region.neant);
    const vieGlobale = (zones[0].region.progression() + zones[1].region.progression()) / 2;
    r3d.rendre(neantGlobal, vieGlobale);

    // d-bis) ONBOARDING : indices de touches (après rendre → position de Phantom à jour).
    majIndices(dt, enJeu, illumineActif, introPiuw);

    // e) L'AUDIO lit l'état : on lui passe la vie GLOBALE (moyenne des deux zones).
    musique.majDepuisEtat(vieGlobale);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  console.log("[PHANTOM-3D] Monde continu démarré ✔ — titre → 2 zones vivantes → Le Don → fin");
}

demarrer();

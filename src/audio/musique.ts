// ════════════════════════════════════════════════════════════════════════
//  audio/musique.ts — LE PREMIER SON DE PHANTOM : « La Petite Lumière ».
//
//  Ce module est une COUCHE par-dessus le jeu, exactement comme le rendu :
//  il LIT l'état (la progression de la région) et fait du son. Il n'écrit
//  JAMAIS dans le core (zéro pollution → les tests du core restent verts).
//
//  Règle n°1 ABSOLUE (sinon le jeu est muet) : aucun son ne démarre tant que
//  le joueur n'a pas fait un GESTE (clic/touche). Les navigateurs interdisent
//  l'autoplay audio. On démarre donc dans le clic de l'écran-titre, via
//  `Musique.demarrerSurGeste()` qui appelle `await Tone.start()`.
//
//  REMIS À PLAT le 19/08/2026 (retour : « ça ne me plaît pas,
//  réinitialise tout, je veux quelque chose de minimaliste et chill »).
//  Tout ce qui avait été ajouté dans la journée (3 timbres alternés, fondu
//  enchaîné entre paliers, nappe basse séparée) est retiré : c'était plus
//  d'ingrédients, pas plus « chill ». Ici : UN seul synthé doux, UNE poignée
//  de notes très espacées, un delay léger façon lo-fi. Rien d'autre.
// ════════════════════════════════════════════════════════════════════════

import * as Tone from "tone";

// ── LE THÈME, minimaliste : 3 paliers SEULEMENT, 2-3 notes chacun, beaucoup
// de silence entre elles. Toujours en Ré dorien (D). Format Tone.js
// « Bars:Beats:Sixteenths ». Plus le monde revit, plus le palier monte.
type Phrase = { time: string; note: string; dur: string }[];

const calme: Phrase = [
  { time: "0:0", note: "D3", dur: "2n" },
  { time: "2:0", note: "A3", dur: "1n" },
];

const eveil: Phrase = [
  { time: "0:0", note: "D3", dur: "2n" },
  { time: "1:2", note: "F3", dur: "4n" },
  { time: "2:0", note: "A3", dur: "1n" },
];

const lumiere: Phrase = [
  { time: "0:0", note: "D4", dur: "2n" },
  { time: "1:2", note: "A3", dur: "4n" },
  { time: "2:0", note: "F4", dur: "1n" },
];

// L'ordre des paliers, du plus dormant au plus lumineux.
const PALIERS = [calme, eveil, lumiere] as const;
type IdPalier = 0 | 1 | 2;

/**
 * Choisit le palier à jouer selon la PROGRESSION de la région (0→1) :
 *   0–0.33 → Calme · 0.33–0.75 → Éveil · 0.75–1 → Lumière.
 */
function palierPour(progression: number): IdPalier {
  if (progression < 0.33) return 0;
  if (progression < 0.75) return 1;
  return 2;
}

/**
 * LA MUSIQUE de PHANTOM. Une seule instance pour toute l'appli (un seul
 * AudioContext). On l'allume sur le geste d'entrée, puis on lui pousse l'état
 * du jeu chaque frame via `majDepuisEtat()` — elle reste douce et ne bloque
 * jamais le rendu (Tone.js tourne sur son propre thread audio).
 */
export class Musique {
  private demarree = false;

  // UN SEUL synthé, chaud et doux (fatsine1 = sinus très légèrement détuné,
  // presque pur). Chaîne minimaliste : synthé → delay léger (esprit lo-fi,
  // sans lequel les notes sonnent trop nues) → reverb douce.
  private synthe?: Tone.Synth;
  private delay?: Tone.FeedbackDelay;
  private reverb?: Tone.Reverb;

  // La boucle qui rejoue la phrase courante (Tone.Part).
  private part?: Tone.Part;

  // Quel palier joue actuellement ? (-1 = aucun encore planifié).
  private palierActuel = -1;

  /**
   * À APPELER DANS UN GESTE UTILISATEUR (le clic d'entrée de l'écran-titre).
   * Débloque l'AudioContext (politique navigateur), construit le synthé et
   * lance le thème en boucle douce. Idempotent : un seul démarrage.
   */
  async demarrerSurGeste(): Promise<void> {
    if (this.demarree) return;
    this.demarree = true;

    // 1) Débloquer l'audio (OBLIGATOIRE, sinon silence total).
    await Tone.start();

    // 2) La chaîne sonore, minimaliste.
    this.reverb = new Tone.Reverb({ decay: 3, wet: 0.3 }).toDestination();
    this.delay = new Tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.25, wet: 0.22 }).connect(this.reverb);
    this.synthe = new Tone.Synth({
      oscillator: { type: "fatsine1", spread: 15 } as Tone.OmniOscillatorOptions,
      envelope: { attack: 0.6, decay: 0.5, sustain: 0.4, release: 2.5 },
    }).connect(this.delay);
    // Volume DOUX : -20 dB (repris de la version précédente, jugé bien dosé).
    this.synthe.volume.value = -20;

    // 3) L'horloge centrale : 50 BPM, chill, et on BOUCLE sur 3 mesures (la
    //    plus longue phrase tient en 3 mesures → tout boucle proprement).
    const transport = Tone.getTransport();
    transport.bpm.value = 50;
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = "3m";

    // 4) On planifie le palier de départ (Calme) et on lance le Transport
    //    avec un petit délai (+0.1) → évite les craquements de démarrage.
    this.planifierPalier(0);
    transport.start("+0.1");
  }

  /**
   * LE LIEN AVEC LE JEU : à appeler chaque frame avec la progression de la
   * région (region.progression() ∈ [0,1]). Si le palier correspondant change,
   * on bascule sur la nouvelle phrase. Ne fait RIEN tant que le son n'est
   * pas démarré (avant le clic d'entrée).
   */
  majDepuisEtat(progression: number): void {
    if (!this.demarree || !this.synthe) return;
    const cible = palierPour(progression);
    if (cible !== this.palierActuel) {
      this.planifierPalier(cible);
    }
  }

  /**
   * Remplace la phrase en boucle par celle du palier demandé. On dispose de
   * l'ancien Tone.Part (anti-fuite) avant d'en créer un nouveau, et on cale la
   * boucle interne sur 3 mesures pour rester synchro avec le Transport.
   */
  private planifierPalier(id: IdPalier): void {
    if (!this.synthe) return;
    this.palierActuel = id;

    // On retire l'ancienne boucle proprement (sinon : notes qui s'empilent = fuite).
    this.part?.stop();
    this.part?.dispose();

    const phrase = PALIERS[id];
    this.part = new Tone.Part((time, val) => {
      // Callback AUDIO : surtout pas de DOM/Three.js ici (mauvais thread).
      // Petite humanisation (esprit lo-fi, jamais tout à fait mécanique) : léger
      // décalage de timing et de volume à chaque passage.
      const jitter = (Math.random() - 0.5) * 0.05;            // ± 25 ms
      const velocite = 0.7 + Math.random() * 0.3;              // 0.7–1.0
      // Accordage 432Hz (choix de design) au lieu du standard 440Hz.
      const frequence = Tone.Frequency(val.note).toFrequency() * (432 / 440);
      this.synthe!.triggerAttackRelease(frequence, val.dur, time + jitter, velocite);
    }, phrase.map((n) => [n.time, n] as [string, (typeof phrase)[number]]));

    this.part.loop = true;
    this.part.loopStart = 0;
    this.part.loopEnd = "3m";
    this.part.start(0);
  }

  /**
   * Coupe tout et LIBÈRE les ressources audio (anti-fuite). À appeler si on
   * veut éteindre la musique (non utilisé pour l'instant — la musique tourne
   * tant que la page vit — mais présent pour ne pas fuir si on l'ajoute).
   */
  dispose(): void {
    this.part?.stop();
    this.part?.dispose();
    Tone.getTransport().stop();
    this.synthe?.dispose();
    this.delay?.dispose();
    this.reverb?.dispose();
    this.part = undefined;
    this.synthe = undefined;
    this.delay = undefined;
    this.reverb = undefined;
    this.demarree = false;
    this.palierActuel = -1;
  }
}

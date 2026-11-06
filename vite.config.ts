import { defineConfig } from "vite";

// Configuration volontairement minimale.
export default defineConfig({
  // Chemins relatifs dans le build (indispensable pour l'hébergement itch.io,
  // qui sert le jeu depuis un sous-dossier type /html/12345/ et non la racine).
  base: "./",
  // Le jeu est servi depuis la racine du depot.
  server: { open: true },
  build: {
    rollupOptions: {
      output: {
        // Nom de fichier unique à CHAQUE build (horodatage en plus du hash de
        // contenu). Contournement d'un souci constaté sur itch.io le 19/08 :
        // leur CDN semble garder un blob cassé pour un nom de fichier déjà vu
        // (même après ré-upload), ce qui donnait des 404/503 permanents sur
        // le .js malgré un ZIP local correct.
        // Dossier "code/" plutôt que le "assets/" par défaut de Vite : soupçon
        // que "assets" entre en collision avec un chemin interne réservé côté
        // itch.io (leurs .js à eux restaient introuvables (404) en boucle même
        // juste après un ré-upload frais, alors que index.html se chargeait
        // toujours bien — seul le sous-dossier assets/ posait systématiquement
        // problème). Test du 19/08.
        entryFileNames: `code/index-[hash]-${Date.now()}.js`,
        chunkFileNames: `code/[name]-[hash].js`,
        assetFileNames: `code/[name]-[hash][extname]`,
        // Sépare les grosses librairies (three.js, tone.js) du code du jeu :
        // évite un seul fichier proche de 900 Ko (soupçonné de coincer sur le
        // CDN d'itch.io, cf. commentaire ci-dessus).
        manualChunks: {
          three: ["three"],
          tone: ["tone"],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "node", // les tests de logique (core/) tournent sans navigateur
  },
});

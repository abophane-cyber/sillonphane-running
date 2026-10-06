import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// `--mode capacitor` (voir `npm run build:cap`, utilisé par android:sync) : build destiné à être
// empaqueté dans l'APK. On y désactive le service worker PWA — inutile quand les assets sont déjà
// servis en local par la WebView, et surtout source de blocages « ancienne version affichée après
// mise à jour » (l'ancien SW continue de servir son cache).
export default defineConfig(({ mode }) => ({
  // Site : sillonphane.fr/running/ ; APK : racine de la WebView.
  base: mode === 'capacitor' ? '/' : '/running/',
  build: {
    // Deux pages statiques : la landing SEO à la racine, l'outil React sur /app.html
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'capacitor', // pas de service worker dans l'APK (voir commentaire en tête)
      registerType: 'autoUpdate', // le SW s'active tout seul (skipWaiting) — plus d'ancienne page servie depuis le cache
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Sillonphane-Running',
        short_name: 'Sillonphane',
        description: 'Animez et partagez vos parcours GPX avec photos et vidéos',
        lang: 'fr',
        dir: 'ltr',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        // Au lancement de l'appli installée : on ouvre la landing page (index.html),
        // depuis laquelle l'utilisateur entre dans l'outil via "Ouvrir l'appli".
        id: '/running/',
        start_url: '/running/',
        scope: '/running/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache-first pour les assets de l'appli
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // La landing (index.html) n'est pas l'app installable : le PWA pointe sur /app.html
        navigateFallback: '/running/app.html',
        // Ne pas servir l'app en fallback pour ces fichiers statiques (SEO + téléchargements) —
        // sans /downloads/, ouvrir l'APK ou version.json en navigation plein écran (ex. bouton
        // "Mettre à jour" de la bannière, qui ouvre le navigateur système) atterrissait sur l'app
        // shell (app.html) au lieu de télécharger le fichier demandé.
        navigateFallbackDenylist: [/^\/running\/$/, /\/sitemap\.xml$/, /\/robots\.txt$/, /\/downloads\//],
        runtimeCaching: [
          {
            // Modèles 3D des randonneurs (.glb, clips compris) et leur décodeur — non précachés (trop
            // lourds, ~9 Mo) mais mis en cache dès le 1er chargement réussi, pour qu'ils s'affichent
            // hors-ligne et si la prod est momentanément injoignable.
            urlPattern: /\/perso\/(models|draco)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'character-models',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Tuiles IGN Géoportail (data.geopf.fr) — cache-first, 30 jours
            // cacheName en "-v2" : le prechargement (tilePrefetch.ts) chargeait ces tuiles via
            // <img> sans crossOrigin, produisant des reponses "opaques" que ce cache acceptait
            // (statuses incluait 0) — le navigateur refuse ensuite de les servir aux vraies
            // requetes CORS de la carte, faisant echouer TOUTES les tuiles. Renommer le cache
            // abandonne les entrees deja empoisonnees chez les utilisateurs ayant deja la PWA.
            urlPattern: /^https:\/\/data\.geopf\.fr\/wmts/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'ign-tiles-v2',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Météo Open-Meteo — NetworkFirst, cache 1 jour
            urlPattern: /^https:\/\/archive-api\.open-meteo\.com/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'meteo',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              networkTimeoutSeconds: 5,
            },
          },
        ],
      },
    }),
  ],
}))

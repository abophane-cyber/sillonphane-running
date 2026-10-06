/**
 * Bande-son des films (2D et 3D).
 *
 * Rôle : décoder une ou plusieurs sources audio (musique de fond du bundle ou
 * fichier fourni par l'utilisateur ; le mixage reste générique et sait empiler
 * d'autres sources), les mixer sur la durée EXACTE du film via un
 * `OfflineAudioContext`, puis encoder le résultat en AAC et l'injecter dans le
 * `mp4-muxer` déjà utilisé pour la vidéo.
 *
 * Contraintes assumées (voir décision produit) :
 *   - piste audio ajoutée UNIQUEMENT sur le chemin WebCodecs (`VideoEncoder` +
 *     `mp4-muxer`). Le repli `MediaRecorder` reste muet.
 *   - aucune piste embarquée pour l'instant : les sources `music` pointent vers
 *     des URLs qui peuvent ne pas exister encore -> on ignore silencieusement
 *     une source qui ne se décode pas.
 */

export type FilmAudioKind = 'music' | 'ambience' | 'upload'

export interface FilmAudioSource {
  kind: FilmAudioKind
  /** Source distante (piste du bundle). Ignorée si `blob` est fourni. */
  url?: string
  /** Fichier fourni par l'utilisateur (upload) ou blob déjà en mémoire. */
  blob?: Blob
  /** Gain linéaire appliqué à cette source. Défaut selon `kind`. */
  gain?: number
  /** Boucler la source si elle est plus courte que le film. Défaut : true. */
  loop?: boolean
  /** Décalage de départ dans la source, en secondes. Défaut 0. */
  startAtS?: number
}

export interface FilmAudioSpec {
  sources: FilmAudioSource[]
  /** Fondu d'entrée, en secondes. Défaut 1,5. */
  fadeInS?: number
  /** Fondu de sortie, en secondes. Défaut 2. */
  fadeOutS?: number
  /** Gain linéaire global appliqué au mix. Défaut 1. */
  masterGain?: number
}

const SAMPLE_RATE = 48_000
const CHANNELS = 2

// ─── Catalogue des pistes du bundle ──────────────────────────────────────────
// Les fichiers sont servis depuis `public/audio/`. Tant qu'ils ne sont pas
// déposés, `buildFilmAudioTrack` ignore silencieusement la source (404) et le
// film reste muet — l'UI reste donc utilisable, l'upload fonctionne dès à présent.
// Ajouter une ambiance musicale = une ligne ici + le fichier correspondant.

export interface FilmMusicChoice {
  id: string
  label: string
  /** Description courte affichée sous le libellé. */
  hint: string
  url: string
}

export const FILM_MUSIC: FilmMusicChoice[] = [
  { id: 'folk',   label: 'Folk',   hint: 'guitare acoustique, chaleureux',       url: `${import.meta.env.BASE_URL}audio/music-folk.mp3` },
  { id: 'nature', label: 'Nature', hint: 'nappe new age, ambiance plein air',     url: `${import.meta.env.BASE_URL}audio/music-nature.mp3` },
]

const DEFAULT_GAIN: Record<FilmAudioKind, number> = {
  music: 0.35,     // sous les overlays, discrète
  ambience: 0.5,   // nappe de fond (source programmatique — plus d'option dans l'UI)
  upload: 0.9,     // choix explicite de l'utilisateur -> quasi plein niveau
}

/** Le mux audio n'est possible que si WebCodecs sait encoder de l'audio. */
export function filmAudioSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined'
}

/** Vrai si la spec contient au moins une source exploitable. */
export function hasFilmAudio(spec: FilmAudioSpec | undefined | null): spec is FilmAudioSpec {
  return !!spec && spec.sources.some(s => !!s.url || !!s.blob)
}

async function sourceToArrayBuffer(src: FilmAudioSource, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  try {
    if (src.blob) return await src.blob.arrayBuffer()
    if (src.url) {
      const res = await fetch(src.url, { signal })
      if (!res.ok) { console.warn(`[filmAudio] source indisponible (${res.status}) : ${src.url}`); return null }
      return await res.arrayBuffer()
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e
    console.warn('[filmAudio] échec chargement source :', e)
  }
  return null
}

/**
 * Décode + mixe toutes les sources sur `durationS` secondes.
 * Renvoie `null` si aucune source n'est exploitable (le film reste alors muet).
 */
export async function buildFilmAudioTrack(
  spec: FilmAudioSpec,
  durationS: number,
  signal?: AbortSignal,
): Promise<AudioBuffer | null> {
  if (!hasFilmAudio(spec) || durationS <= 0) return null

  const totalFrames = Math.max(1, Math.ceil(durationS * SAMPLE_RATE))
  const ctx = new OfflineAudioContext(CHANNELS, totalFrames, SAMPLE_RATE)

  const master = ctx.createGain()
  master.gain.value = spec.masterGain ?? 1
  master.connect(ctx.destination)

  // Fondus appliqués sur le bus master (donc sur le mix complet).
  const fadeIn = Math.max(0, spec.fadeInS ?? 1.5)
  const fadeOut = Math.max(0, spec.fadeOutS ?? 2)
  const g = master.gain.value
  if (fadeIn > 0) {
    master.gain.setValueAtTime(0, 0)
    master.gain.linearRampToValueAtTime(g, Math.min(fadeIn, durationS))
  }
  if (fadeOut > 0 && durationS > fadeOut) {
    master.gain.setValueAtTime(g, durationS - fadeOut)
    master.gain.linearRampToValueAtTime(0, durationS)
  }

  let decoded = 0
  for (const src of spec.sources) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    const buf = await sourceToArrayBuffer(src, signal)
    if (!buf) continue
    let audio: AudioBuffer
    try {
      audio = await ctx.decodeAudioData(buf)
    } catch (e) {
      console.warn('[filmAudio] décodage impossible :', e)
      continue
    }

    const node = ctx.createBufferSource()
    node.buffer = audio
    node.loop = src.loop ?? true

    const gain = ctx.createGain()
    gain.gain.value = src.gain ?? DEFAULT_GAIN[src.kind] ?? 0.5
    node.connect(gain).connect(master)
    node.start(0, Math.max(0, src.startAtS ?? 0))
    decoded++
  }

  if (decoded === 0) return null
  return await ctx.startRendering()
}

interface MuxerLike {
  addAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata): void
}

/** Config audio à passer au constructeur `Muxer` de mp4-muxer quand une piste existe. */
export const MUXER_AUDIO_CONFIG = { codec: 'aac', numberOfChannels: CHANNELS, sampleRate: SAMPLE_RATE } as const

/**
 * Encode `audioBuffer` en AAC et pousse les chunks dans le muxer.
 * À appeler APRÈS `videoEncoder.flush()` et AVANT `muxer.finalize()`.
 */
export async function encodeFilmAudio(
  audioBuffer: AudioBuffer,
  muxer: MuxerLike,
  signal?: AbortSignal,
): Promise<void> {
  const sr = audioBuffer.sampleRate
  const total = audioBuffer.length
  const ch0 = audioBuffer.getChannelData(0)
  const ch1 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : ch0

  let encoderError: unknown = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: e => { encoderError = e; console.error('[filmAudio] AudioEncoder :', e) },
  })
  encoder.configure({
    codec: 'mp4a.40.2',              // AAC-LC
    sampleRate: sr,
    numberOfChannels: CHANNELS,
    bitrate: 192_000,
  })

  const CHUNK = 9_600 // 0,2 s à 48 kHz
  for (let offset = 0; offset < total; offset += CHUNK) {
    if (signal?.aborted) { try { encoder.close() } catch { /* */ } throw new DOMException('aborted', 'AbortError') }
    if (encoderError) break
    const n = Math.min(CHUNK, total - offset)
    // AudioData planaire : [canal 0 (n échantillons)] puis [canal 1 (n échantillons)].
    const planar = new Float32Array(n * CHANNELS)
    planar.set(ch0.subarray(offset, offset + n), 0)
    planar.set(ch1.subarray(offset, offset + n), n)
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: sr,
      numberOfFrames: n,
      numberOfChannels: CHANNELS,
      timestamp: Math.round((offset / sr) * 1_000_000),
      data: planar,
    })
    encoder.encode(data)
    data.close()
    if ((offset / CHUNK) % 32 === 0) await new Promise(r => setTimeout(r, 0))
  }

  await encoder.flush()
  encoder.close()
  if (encoderError) throw encoderError
}

/**
 * Ajout d'une bande-son à un film DÉJÀ exporté, sans re-rendre ni ré-encoder la vidéo.
 *
 * Pipeline : mp4box.js démuxe la piste vidéo du MP4 (échantillons H.264/HEVC bruts +
 * configuration codec avcC/hvcC) → `filmAudio.ts` décode/mixe/encode l'AAC → `mp4-muxer`
 * recompose un MP4 vidéo + audio. Quelques secondes, même pour un survol 3D de plusieurs minutes.
 *
 * Une éventuelle piste audio de la source est ignorée (remplacée) : re-mixer une autre musique
 * repart donc proprement.
 */

import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import {
  buildFilmAudioTrack, encodeFilmAudio, filmAudioSupported, hasFilmAudio,
  MUXER_AUDIO_CONFIG, type FilmAudioSpec,
} from './filmAudio'

/** Le remux n'est possible que si WebCodecs sait encoder de l'audio (cf. `filmAudioSupported`). */
export const filmRemuxSupported = filmAudioSupported

/**
 * Une image encodée + ses temps en microsecondes. mp4-muxer attend le PTS (`ctsUs`) comme
 * `timestamp` et calcule le DTS par `timestamp − compositionTimeOffset`, d'où `ctoUs = CTS − DTS`.
 */
interface VideoUnit {
  chunk: EncodedVideoChunk
  ctsUs: number
  ctoUs: number
}

interface DemuxResult {
  units: VideoUnit[]
  meta: EncodedVideoChunkMetadata
  width: number
  height: number
  durationS: number
  codec: 'avc' | 'hevc'
}

/** Sérialise la box de configuration codec (avcC/hvcC) en descripteur WebCodecs (entête retiré). */
function extractCodecDescription(file: ReturnType<typeof createFile>, trackId: number): Uint8Array {
  // Typage volontairement lâche : la traversée stsd -> entries -> avcC n'est pas exposée finement.
  const trak = file.getTrackById(trackId) as unknown as {
    mdia?: { minf?: { stbl?: { stsd?: { entries?: Array<Record<string, { write(s: DataStream): void }>> } } } }
  }
  const entries = trak?.mdia?.minf?.stbl?.stsd?.entries ?? []
  for (const entry of entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C
    if (box) {
      const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
      box.write(ds)
      return new Uint8Array(ds.buffer, 8) // 8 octets d'entête de box
    }
  }
  throw new Error('configuration codec vidéo (avcC/hvcC) introuvable')
}

async function demuxVideo(blob: Blob): Promise<DemuxResult> {
  // `true` = conserver les données mdat : sans ça `sample.data` est vide.
  const file = createFile(true)
  const units: VideoUnit[] = []
  let vtrack: import('mp4box').Track | undefined
  let movie: import('mp4box').Movie | undefined
  let settled = false

  const done = new Promise<void>((resolve, reject) => {
    const fail = (msg: string) => { if (!settled) { settled = true; reject(new Error(msg)) } }
    file.onError = (m, msg) => fail(`mp4box: ${m} — ${msg}`)
    file.onReady = info => {
      movie = info
      vtrack = info.videoTracks[0]
      if (!vtrack) { fail('aucune piste vidéo dans ce fichier'); return }
      file.setExtractionOptions(vtrack.id, undefined, { nbSamples: vtrack.nb_samples })
      file.start()
    }
    file.onSamples = (_id, _user, samples) => {
      for (const s of samples) {
        if (!s.data) continue
        const cts = Math.round((1e6 * s.cts) / s.timescale)
        const dts = Math.round((1e6 * s.dts) / s.timescale)
        units.push({
          chunk: new EncodedVideoChunk({
            type: s.is_sync ? 'key' : 'delta',
            timestamp: cts,
            duration: Math.round((1e6 * s.duration) / s.timescale),
            data: s.data,
          }),
          ctsUs: cts,
          ctoUs: cts - dts,
        })
      }
      if (vtrack && units.length >= vtrack.nb_samples && !settled) { settled = true; resolve() }
    }
  })

  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error('démuxage MP4 trop long (fichier illisible ?)')), 30_000))

  const ab = await blob.arrayBuffer()
  file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0), true)
  file.flush()
  await Promise.race([done, timeout])

  if (!vtrack || !movie) throw new Error('MP4 illisible (boîte moov introuvable)')
  if (units.length === 0) throw new Error('aucune image vidéo extraite')

  const description = extractCodecDescription(file, vtrack.id)
  const width = vtrack.video?.width ?? vtrack.track_width
  const height = vtrack.video?.height ?? vtrack.track_height
  const durationS = vtrack.movie_timescale
    ? vtrack.movie_duration / vtrack.movie_timescale
    : movie.duration / movie.timescale

  return {
    units,
    meta: { decoderConfig: { codec: vtrack.codec, codedWidth: width, codedHeight: height, description } },
    width,
    height,
    durationS,
    codec: /hvc1|hev1|hevc/i.test(vtrack.codec) ? 'hevc' : 'avc',
  }
}

/**
 * Renvoie un nouveau Blob MP4 = vidéo de `videoBlob` + bande-son décrite par `spec`.
 * Lève si la vidéo est illisible, si la bande-son ne se construit pas, ou si l'audio n'est
 * pas encodable sur ce navigateur.
 */
export async function remuxFilmAudio(
  videoBlob: Blob,
  spec: FilmAudioSpec,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!hasFilmAudio(spec)) return videoBlob
  if (!filmAudioSupported()) throw new Error("Ce navigateur ne sait pas encoder l'audio (WebCodecs AudioEncoder).")

  const dem = await demuxVideo(videoBlob)
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')

  const audioBuffer = await buildFilmAudioTrack(spec, dem.durationS, signal)
  if (!audioBuffer) throw new Error('Bande-son vide : la piste choisie est introuvable ou illisible.')

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: dem.codec, width: dem.width, height: dem.height },
    audio: MUXER_AUDIO_CONFIG,
    // Les CTS d'un MP4 avec images B ne démarrent pas forcément à 0 -> on laisse le muxer recaler.
    firstTimestampBehavior: 'offset',
    fastStart: 'in-memory',
  })
  // mp4-muxer : `timestamp` = PTS, DTS = timestamp − compositionTimeOffset. On passe donc CTS et
  // le décalage de composition (CTS − DTS) pour respecter le réordonnancement des images B.
  dem.units.forEach((u, i) =>
    muxer.addVideoChunk(u.chunk, i === 0 ? dem.meta : undefined, u.ctsUs, u.ctoUs))
  await encodeFilmAudio(audioBuffer, muxer, signal)
  muxer.finalize()

  return new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' })
}

import type { GpxPoint } from '../types'
import { haversine, bearing, angleDiff } from './gpx'

export interface RawFix {
  lat: number
  lon: number
  ele: number
  time: number       // ms epoch
  accuracy?: number  // mètres
  // Dénivelé barométrique cumulé (gain / perte, m) depuis le début du suivi, calculé nativement
  // par le service (algo OpenTracks). Absent = pas de baromètre → repli sur l'altitude GPS.
  baroGain?: number
  baroLoss?: number
}

export interface RecordingSnapshot {
  points: GpxPoint[]
  distance: number         // mètres, cumulée sur tout le tracé
  elevGain: number
  elevLoss: number
  movingDurationMs: number // hors arrêts détectés
  totalDurationMs: number  // durée écoulée traitée (le hook exclut lui-même les pauses manuelles)
  idle: boolean
  currentEle: number
  acceptedFixCount: number  // relevés GPS effectivement ingérés (diagnostic terrain)
  rejectedAccuracyCount: number     // relevés jetés faute de précision suffisante (diagnostic terrain)
  noAccuracyFixCount: number         // relevés sans info de précision — gardés, mais soumis au filtre vitesse/distance — diagnostic
  rejectedTimeCount: number         // relevés jetés car horodatage ≤ au précédent (dtMs ≤ 0) — diagnostic
  jumpCount: number                 // relevés écartés pour vitesse implicite impossible / trop loin — diagnostic
  jumpMetersDropped: number         // mètres de ces relevés écartés (absents distance ET tracé) — diagnostic
  longGapCount: number              // segments > LONG_GAP_M acceptés (coupures de signal) — diagnostic
  elevSource: 'baro' | 'gps'        // d'où vient le dénivelé affiché — diagnostic
}

// Seuils inspirés du fonctionnement d'OpenTracks (open-source, Apache-2.0), adaptés au GPS seul,
// sans support de segments multiples : https://github.com/OpenTracksApp/OpenTracks — voir
// sensors/GpsManager.java, data/models/Position.java, services/TrackRecordingManager.java,
// stats/TrackStatisticsUpdater.java.
//
// Précision horizontale minimale pour accepter un point. Monté de 50 à 100 m (OpenTracks défaut =
// 50) : téléphone en poche/sac pendant une rando, le FusedLocationProvider rapporte souvent
// 50–100 m de façon prolongée — à 50 m tous ces points étaient rejetés et le tracé restait figé.
// ⚠️ Dépend d'un test terrain (cf. memory apk_update_check) : ne pas rebaisser sans le refaire.
const ACCURACY_THRESHOLD_M = 100
// OpenTracks écarte d'office tout relevé sans précision (Position.fulfillsAccuracy exige
// hasHorizontalAccuracy). Test terrain 2026-09-07 : sur ce Samsung ~1 relevé sur 6 arrive sans
// précision — les jeter troue le tracé. On les GARDE, mais ils ne peuvent pas cautionner un
// segment rapide/lointain (voir `badAccuracy` plus bas) : un relevé sans précision ET aberrant
// est quand même rejeté par le filtre vitesse/distance.
// Précision « bonne » : en dessous, on cautionne un relevé même rapide/lointain (télésiège,
// tronçon en voiture d'approche) au lieu de le prendre pour un glitch.
const GOOD_ACCURACY_M = 20
// Vitesse implicite max entre deux relevés — CALÉ POUR LA MARCHE (~43 km/h, très au-dessus du
// trail en descente ≈ 6 m/s). Au-delà ET sans bonne précision → aberration : relevé écarté
// entièrement. OpenTracks n'a pas ce filtre : il s'en passe grâce à un seuil de précision plus
// strict (50 m) + le rejet des relevés sans précision, et sait rompre le tracé en segments.
// Sillon garde 100 m et une polyligne unique, d'où ce garde-fou explicite.
// ⚠️ L'appli cyclo à venir devra relever ce seuil (~30 m/s, descente sur route).
const MAX_PLAUSIBLE_SPEED_MS = 12
// Rejet absolu : un relevé à plus de 1 km du dernier point sûr, sans bonne précision, est un
// artefact même après une longue coupure — borne le cas où dtMs est assez grand pour que la
// vitesse implicite d'un gros garbage repasse sous MAX_PLAUSIBLE_SPEED_MS.
const HARD_JUMP_M = 1000
// Au-delà, segment géométriquement suspect même à vitesse plausible (longue coupure de signal :
// la corde qui comble le trou peut raccourcir un vrai détour). Distance comptée quand même
// (comme OpenTracks), mais altitude re-calée sans compter le dénivelé accumulé sur le trou.
const LONG_GAP_M = 400
const IDLE_TIMEOUT_MS = 60_000         // pas de mouvement significatif depuis 1 min → considéré à l'arrêt
const IDLE_EXIT_DISTANCE_M = 10        // il faut 10m parcourus depuis le début de l'arrêt pour en ressortir
const MOVING_SPEED_THRESHOLD_MS = 0.5  // m/s, en dessous = à l'arrêt pour ce point
const ALTITUDE_NOISE_THRESHOLD_M = 3   // deltas d'altitude sous ce seuil ignorés (bruit GPS)
// Distance minimale depuis le dernier point conservé pour en stocker un nouveau (identique à
// OpenTracks : recording_distance_interval défaut = 10 m). N'affecte que le point stocké : la
// distance/dénivelé/détection d'arrêt restent calculés sur chaque relevé brut. Inchangé :
// baisser gonflerait le tracé partout, coûteux pour le checkpoint localStorage réécrit toutes
// les 10 s sur une sortie de 8–10 h.
const RECORD_DISTANCE_M = 10
// Stocke aussi un point si le cap a tourné d'au moins cet angle depuis le dernier point conservé
// (les lacets ne sont plus rabotés en ligne droite). Ignoré si la précision est mauvaise (le cap
// calculé n'est alors que du bruit). OpenTracks n'en a pas besoin : il accepte des tracés plus
// denses par un pas plus fin.
const RECORD_BEARING_CHANGE_DEG = 30
// Filet de sécurité temporel : sans lui, rester quasi immobile pendant longtemps ne stocke jamais
// aucun nouveau point (aucun ne franchit les 10m), et la durée du tracé exporté retombe à 0 quel
// que soit le temps réellement écoulé (un seul point = pas d'écart de temps calculable).
const RECORD_INTERVAL_MS = 30_000

export class GpsRecordingEngine {
  private lastFix: RawFix | null = null
  private lastStoredFix: RawFix | null = null
  private lastMovingFixTime = 0
  private idle = false
  private idleOrigin: RawFix | null = null
  private smoothedEle = 0
  private lastStoredBearing: number | null = null
  // Dénivelé barométrique : le service envoie un cumul depuis SON démarrage ; on n'ajoute que la
  // progression en avant (baroGain/Loss courant − dernière valeur vue), ce qui absorbe une remise
  // à zéro du service sur reprise après pause sans rien retrancher.
  private baroGainSeen: number | null = null
  private baroLossSeen: number | null = null
  private elevFromBaro = false

  points: GpxPoint[] = []
  distance = 0
  elevGain = 0
  elevLoss = 0
  movingDurationMs = 0
  totalDurationMs = 0
  acceptedFixCount = 0
  rejectedAccuracyCount = 0
  noAccuracyFixCount = 0
  rejectedTimeCount = 0
  jumpCount = 0
  jumpMetersDropped = 0
  longGapCount = 0

  /** ms epoch du dernier relevé effectivement ingéré — sert au hook à ne pas réinjecter deux fois
   * un relevé déjà reçu en direct quand il vide le tampon natif d'arrière-plan. */
  get lastFixTime(): number {
    return this.lastFix?.time ?? 0
  }

  /** Ingère un nouveau relevé GPS. Renvoie false si le point a été rejeté (précision, horodatage
   * non croissant, ou aberration de vitesse/distance). */
  ingest(fix: RawFix): boolean {
    if (fix.accuracy == null) {
      this.noAccuracyFixCount++
      // Pas de rejet d'office : voir la note sur les relevés sans précision plus haut. Ils
      // restent soumis au filtre vitesse/distance ci-dessous (badAccuracy les vise).
    } else if (fix.accuracy > ACCURACY_THRESHOLD_M) {
      this.rejectedAccuracyCount++
      return false
    }

    const point: GpxPoint = { lat: fix.lat, lon: fix.lon, ele: fix.ele, time: new Date(fix.time) }

    if (!this.lastFix) {
      this.acceptedFixCount++
      this.lastFix = fix
      this.lastStoredFix = fix
      this.lastMovingFixTime = fix.time
      this.smoothedEle = fix.ele
      this.points.push(point)
      return true
    }

    const dtMs = fix.time - this.lastFix.time
    if (dtMs <= 0) { this.rejectedTimeCount++; return false }

    const segDist = haversine(this.lastFix, fix)
    const speedMs = segDist / (dtMs / 1000)
    const badAccuracy = fix.accuracy == null || fix.accuracy > GOOD_ACCURACY_M

    // Aberration : trop loin dans l'absolu, ou vitesse implicite impossible à pied — et pas de
    // bonne précision pour la cautionner. On NE chaîne PAS (lastFix reste le dernier point sain)
    // pour qu'un aberrant isolé ne provoque pas un 2e faux saut au relevé suivant.
    if (badAccuracy && (segDist > HARD_JUMP_M || speedMs > MAX_PLAUSIBLE_SPEED_MS)) {
      this.jumpCount++
      this.jumpMetersDropped += segDist
      return false
    }

    this.acceptedFixCount++
    const longGap = segDist > LONG_GAP_M
    if (longGap) this.longGapCount++
    this.distance += segDist

    if (fix.baroGain != null && fix.baroLoss != null) {
      // Dénivelé par le baromètre (algo OpenTracks côté natif) : bien plus fiable que l'altitude
      // GPS. Valeurs cumulées → on n'ajoute que la progression en avant ; un recul (remise à zéro
      // du service après une pause) re-cale la référence sans rien retrancher.
      this.elevFromBaro = true
      if (this.baroGainSeen == null || fix.baroGain < this.baroGainSeen) this.baroGainSeen = fix.baroGain
      if (this.baroLossSeen == null || fix.baroLoss < this.baroLossSeen) this.baroLossSeen = fix.baroLoss
      this.elevGain += fix.baroGain - this.baroGainSeen
      this.elevLoss += fix.baroLoss - this.baroLossSeen
      this.baroGainSeen = fix.baroGain
      this.baroLossSeen = fix.baroLoss
    } else {
      // Repli : dénivelé depuis l'altitude GPS brute, seuil de bruit ALTITUDE_NOISE_THRESHOLD_M.
      const eleDelta = fix.ele - this.smoothedEle
      if (!longGap && Math.abs(eleDelta) >= ALTITUDE_NOISE_THRESHOLD_M) {
        if (eleDelta > 0) this.elevGain += eleDelta
        else this.elevLoss += -eleDelta
        this.smoothedEle = fix.ele
      } else if (longGap) {
        // Dénivelé accumulé sur un trou de signal = non fiable : on re-cale sans compter.
        this.smoothedEle = fix.ele
      }
    }

    if (speedMs >= MOVING_SPEED_THRESHOLD_MS) this.lastMovingFixTime = fix.time

    if (!this.idle && fix.time - this.lastMovingFixTime >= IDLE_TIMEOUT_MS) {
      this.idle = true
      this.idleOrigin = this.lastFix
    }

    if (this.idle && this.idleOrigin && haversine(this.idleOrigin, fix) >= IDLE_EXIT_DISTANCE_M) {
      this.idle = false
      this.idleOrigin = null
      this.lastMovingFixTime = fix.time
    }

    if (!this.idle) this.movingDurationMs += dtMs
    this.totalDurationMs += dtMs

    if (this.lastStoredFix) {
      const movedFromStored = haversine(this.lastStoredFix, fix)
      const brg = bearing(this.lastStoredFix, fix)
      // Virage marqué : point conservé même en deçà de RECORD_DISTANCE_M pour ne pas raboter les
      // lacets. Cap fiable seulement sur une base suffisante et avec une précision correcte.
      const turned =
        this.lastStoredBearing != null &&
        !badAccuracy &&
        movedFromStored >= RECORD_DISTANCE_M * 0.6 &&
        angleDiff(brg, this.lastStoredBearing) >= RECORD_BEARING_CHANGE_DEG
      if (
        movedFromStored >= RECORD_DISTANCE_M ||
        fix.time - this.lastStoredFix.time >= RECORD_INTERVAL_MS ||
        turned
      ) {
        this.points.push(point)
        this.lastStoredFix = fix
        this.lastStoredBearing = brg
      }
    }
    this.lastFix = fix
    return true
  }

  /** À appeler une seule fois à l'arrêt de l'enregistrement : force l'ajout du tout dernier relevé
   * au tracé stocké s'il n'y est pas déjà, pour garantir au moins 2 points (le minimum exigé par
   * parseGpx pour reconnaître un tracé) même sur un enregistrement court ou quasi immobile qui n'a
   * jamais franchi les seuils RECORD_DISTANCE_M/RECORD_INTERVAL_MS après le tout premier point. */
  finalize(): void {
    if (this.lastFix && this.lastFix !== this.lastStoredFix) {
      this.points.push({ lat: this.lastFix.lat, lon: this.lastFix.lon, ele: this.lastFix.ele, time: new Date(this.lastFix.time) })
      this.lastStoredFix = this.lastFix
    }
  }

  /** Force la sortie de l'état "à l'arrêt" sans attendre les 10m de mouvement détecté — appelé
   * quand l'utilisateur appuie explicitement sur le bouton de reprise pendant l'immobilité. */
  clearIdle(): void {
    this.idle = false
    this.idleOrigin = null
    if (this.lastFix) this.lastMovingFixTime = this.lastFix.time
  }

  snapshot(): RecordingSnapshot {
    return {
      points: this.points,
      distance: this.distance,
      elevGain: this.elevGain,
      elevLoss: this.elevLoss,
      movingDurationMs: this.movingDurationMs,
      totalDurationMs: this.totalDurationMs,
      idle: this.idle,
      currentEle: this.lastFix?.ele ?? 0,
      acceptedFixCount: this.acceptedFixCount,
      rejectedAccuracyCount: this.rejectedAccuracyCount,
      noAccuracyFixCount: this.noAccuracyFixCount,
      rejectedTimeCount: this.rejectedTimeCount,
      jumpCount: this.jumpCount,
      jumpMetersDropped: this.jumpMetersDropped,
      longGapCount: this.longGapCount,
      elevSource: this.elevFromBaro ? 'baro' : 'gps',
    }
  }
}

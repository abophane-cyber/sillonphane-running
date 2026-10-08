import { useState } from 'react'
import type { LocalityInfo, ColMarker } from '../hooks/useLocality'
import type { AddPanelInfo } from './AnimationControls'
import { OnboardingBubble } from './OnboardingBubble'
import { PANEL_DRAG_MIME } from '../lib/panelDrag'
import type { EndpointKind } from '../hooks/useTrackNaming'
import {
  DEFAULT_SPEED_KMH, SPEED_SLICE_KM, formatElapsed, formatKm, parseRavitoKms, hasPlannedSpeeds, plannedElapsedS, speedSliceCount,
  type BannerText, type RaceSettings,
} from '../lib/raceSplits'
import { fetchRouteStreets, isMainStreet, type StreetRun } from '../lib/routeStreets'
import type { GpxPoint } from '../types'

/** « 12 h 41 (3 h 41'00") », ou la durée seule sans heure de départ. */
function plannedFinish(startTime: string, elapsedS: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime)
  if (!m) return formatElapsed(elapsedS)
  const t = (Number(m[1]) * 60 + Number(m[2])) * 60 + elapsedS
  const h = Math.floor(t / 3600) % 24, min = Math.floor((t % 3600) / 60)
  return `${h} h ${String(min).padStart(2, '0')} (${formatElapsed(elapsedS)})`
}

interface Props {
  startName: string
  endName: string
  localities: LocalityInfo[]
  cols: ColMarker[]
  excluded: Set<string>
  customLocalities: LocalityInfo[]
  onStartNameChange: (v: string) => void
  onEndNameChange: (v: string) => void
  /** Style du panneau de départ / d'arrivée (localité ou lieu-dit) ; un col garde son style col. */
  startKind: EndpointKind
  endKind: EndpointKind
  startIsCol?: boolean
  endIsCol?: boolean
  onStartKindChange: (k: EndpointKind) => void
  onEndKindChange: (k: EndpointKind) => void
  onToggleLocality: (name: string) => void
  onAddPanel: (info: AddPanelInfo) => void
  onRemoveCustomLocality: (name: string) => void
  onComplete: () => void
  /** Bornes tous les 5 km et temps de passage. */
  race: RaceSettings
  onRaceChange: (r: RaceSettings) => void
  /** Le GPX porte des heures réelles : choix entre temps du GPX et temps prévus. */
  realTimes: boolean
  totalDistance: number
  /** Ravitaillements effectivement placés sur le tracé. */
  ravitoCount: number
  /** Inscription par défaut de l'épreuve (exemples des champs). */
  bannerDefaults: BannerText
  /** Tracé : recherche des rues empruntées (IGN). */
  points: GpxPoint[]
  distances: number[]
  /** Titre du film (= nom de l'épreuve). */
  onFilmTitleChange: (v: string) => void
  departureTime: string
  onDepartureTimeChange: (v: string) => void
  showHint?: boolean
  onDismissHint?: () => void
}

export function PanelWizard({
  startName, endName, localities, cols,
  excluded, customLocalities, onStartNameChange, onEndNameChange,
  startKind, endKind, startIsCol, endIsCol, onStartKindChange, onEndKindChange,
  onToggleLocality, onAddPanel, onRemoveCustomLocality, onComplete,
  race, onRaceChange, realTimes, totalDistance, ravitoCount, bannerDefaults, points, distances, onFilmTitleChange, departureTime, onDepartureTimeChange,
  showHint, onDismissHint,
}: Props) {
  const depHidden = excluded.has(startName)
  const arrHidden = excluded.has(endName)
  // Boucle : le même nom au départ et à l'arrivée ne donne qu'un seul panneau.
  // Temps prévus : trace sans heures réelles, ou temps prévus choisis à la place de ceux du GPX.
  const planned = !(realTimes && !race.plannedTimes)
  const isLoop = !!startName && !!endName && startName.trim().toLowerCase() === endName.trim().toLowerCase()

  const [addType, setAddType] = useState<'localite' | 'lieudit' | 'col' | 'poi'>('localite')
  const [addName, setAddName] = useState('')
  // Rues empruntées : liste trouvée à la demande (IGN) ; les rues cochées sont dans race.streets.
  const [streetList, setStreetList] = useState<StreetRun[] | null>(null)
  const [streetState, setStreetState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [allStreets, setAllStreets] = useState(false) // petites rues affichées aussi
  const chosenStreets = race.streets ?? []
  // Une ligne par nom (une rue empruntée plusieurs fois, ex. sur une boucle, n'apparaît qu'une fois) : cocher la
  // rue choisit toutes ses portions. Liste : rues importantes (isMainStreet), plus les petites sur demande, plus
  // celles déjà choisies.
  const byName = new Map<string, StreetRun[]>()
  for (const r of [...(streetList ?? []), ...chosenStreets.filter(c => !(streetList ?? []).some(s => s.name === c.name))])
    byName.set(r.name, [...(byName.get(r.name) ?? []), r])
  const groups = [...byName.entries()].map(([name, runs]) => ({ name, runs: runs.sort((a, b) => a.startM - b.startM) }))
    .sort((a, b) => a.runs[0].startM - b.runs[0].startM)
  const streetLength = (runs: StreetRun[]) => {
    const m = runs.reduce((a, r) => a + r.endM - r.startM, 0)
    return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`
  }
  const isChosen = (name: string) => chosenStreets.some(c => c.name === name)
  const minorCount = groups.filter(g => !isMainStreet(g.runs) && !isChosen(g.name)).length
  const shownGroups = groups.filter(g => allStreets || isMainStreet(g.runs) || isChosen(g.name))
  const setChosen = (names: Set<string>) => onRaceChange({
    ...race, streets: groups.filter(g => names.has(g.name)).flatMap(g => g.runs).sort((a, b) => a.startM - b.startM),
  })
  const chosenNames = new Set(chosenStreets.map(c => c.name))
  const toggleStreet = (name: string) => {
    const next = new Set(chosenNames)
    if (next.has(name)) next.delete(name); else next.add(name)
    setChosen(next)
  }
  const allShownChosen = shownGroups.length > 0 && shownGroups.every(g => chosenNames.has(g.name))
  const toggleAllStreets = () => {
    const next = new Set(chosenNames)
    for (const g of shownGroups) if (allShownChosen) next.delete(g.name); else next.add(g.name)
    setChosen(next)
  }
  const findStreets = () => {
    setStreetState('loading')
    fetchRouteStreets(points, distances)
      .then(list => { setStreetList(list); setStreetState('idle') })
      .catch(e => { console.error('[rues]', e); setStreetState('error') })
  }
  const [addEle, setAddEle] = useState('')

  function submitAdd() {
    if (!addName.trim()) return
    onAddPanel({
      type: addType === 'col' ? 'col' : 'locality',
      name: addName.trim(),
      // Point d'intérêt / ravitaillement : une localité à placeType 'poi' / 'ravito', chacun avec son écriture sur la carte.
      placeType: addType === 'lieudit' ? 'hamlet' : addType === 'localite' ? 'village' : addType === 'poi' ? 'poi' : undefined,
      ele: addType === 'col' ? (parseInt(addEle) || undefined) : undefined,
    })
    setAddName(''); setAddEle('')
  }

  // Choix localité / lieu-dit sous le nom de départ / d'arrivée (masqué pour un col ou un panneau masqué).
  function kindPicker(kind: EndpointKind, onChange: (k: EndpointKind) => void) {
    return (
      <div className="add-panel-form__row pwiz-kind">
        {(['localite', 'lieudit'] as const).map(k => (
          <button
            key={k}
            type="button"
            className={`add-panel-form__type-btn${kind === k ? ' active' : ''}`}
            onClick={() => onChange(k)}
          >
            {k === 'localite' ? 'Localité' : 'Lieu-dit'}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="pwiz-overlay">
      <div className="pwiz-stack">
        {showHint && onDismissHint && (
          <OnboardingBubble icon="👋" onClose={onDismissHint} className="onboarding-bubble--pwiz">
            Personnalisez vos panneaux : changez les infos de départ et d'arrivée si vous voulez,
            retirez ceux que vous ne souhaitez pas voir, et ajoutez ceux qui comptent pour vous !
            Cliquez sur Terminer en bas
          </OnboardingBubble>
        )}
      <div className="pwiz-card">
        <div className="pwiz-header">
          <span className="pwiz-title">Panneaux du film</span>
        </div>

        {/* ── Départ ── */}
        <div className="pwiz-section pwiz-section--endpoint">
          <span className="pwiz-section-label">🚩 {isLoop ? 'Départ / arrivée' : 'Départ'}</span>
          <div className="pwiz-row">
            <input
              className="pwiz-input"
              value={startName}
              disabled={depHidden}
              placeholder="Nom du lieu de départ"
              onChange={e => onStartNameChange(e.target.value)}
            />
            <label className="pwiz-toggle" title="Afficher / masquer">
              <input
                type="checkbox"
                checked={!depHidden}
                onChange={() => onToggleLocality(startName)}
              />
              <span className="pwiz-toggle-track" />
            </label>
          </div>
          {!depHidden && !startIsCol && kindPicker(startKind, onStartKindChange)}
        </div>

        {/* ── Cols repérés (décochés par défaut) ── */}
        {cols.length > 0 && (
          <div className="pwiz-section pwiz-section--cols">
            <span className="pwiz-section-label">Cols</span>
            <ul className="pwiz-list">
              {cols.map(col => (
                <li key={col.name} className="pwiz-item">
                  <label className="pwiz-check">
                    <input
                      type="checkbox"
                      checked={!excluded.has(col.name)}
                      onChange={() => onToggleLocality(col.name)}
                    />
                    <span className="pwiz-check-name">{col.name}</span>
                    <span className="pwiz-check-type">▲ {col.ele} m</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Lieux intermédiaires ── */}
        <div className="pwiz-section pwiz-section--places">
          <span className="pwiz-section-label">Localités</span>
          {localities.length === 0 ? (
            <p className="pwiz-empty">Aucun lieu détecté sur ce tracé.</p>
          ) : (
            <ul className="pwiz-list">
              {localities.map(loc => (
                <li key={loc.name} className="pwiz-item">
                  <label className="pwiz-check">
                    <input
                      type="checkbox"
                      checked={!excluded.has(loc.name)}
                      onChange={() => onToggleLocality(loc.name)}
                    />
                    <span className="pwiz-check-name">{loc.name}</span>
                    <span className="pwiz-check-type">
                      {loc.type === 'col' ? '▲ Col' : loc.placeType === 'hamlet' || loc.placeType === 'locality' ? 'Lieu-dit' : 'Localité'}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Inscription de l'épreuve (nom, date, distance), mémorisée avec le tracé ; vide = valeur par défaut ── */}
        <div className="pwiz-section pwiz-section--banner">
          <span className="pwiz-section-label">🏁 Épreuve</span>
          {/* Nom de l'épreuve = titre du film (écran-titre, carton de fin, Mes sillons). */}
          <label className="pwiz-field-label" htmlFor="pwiz-film-title">Titre du film</label>
          <input
            id="pwiz-film-title" className="pwiz-input" value={bannerDefaults.title} placeholder="Nom de l'épreuve"
            onChange={e => onFilmTitleChange(e.target.value)}
          />
          {/* Localité de l'épreuve : cartouche du film (« LILLE » au-dessus du titre). */}
          <label className="pwiz-field-label" htmlFor="pwiz-event-place">Localité de l'épreuve</label>
          <input
            id="pwiz-event-place" className="pwiz-input" value={bannerDefaults.place ?? ''} placeholder="Localité"
            onChange={e => onRaceChange({ ...race, eventPlace: e.target.value })}
          />
          <div className="pwiz-row">
            <input
              className="pwiz-input" value={race.bannerDate ?? ''} placeholder={bannerDefaults.date || 'Date'}
              aria-label="Date de l'épreuve"
              onChange={e => onRaceChange({ ...race, bannerDate: e.target.value })}
            />
            <input
              className="pwiz-input pwiz-input--distance" value={race.bannerDistance ?? ''} placeholder={bannerDefaults.distance || 'Distance'}
              aria-label="Distance"
              onChange={e => onRaceChange({ ...race, bannerDistance: e.target.value })}
            />
          </div>
          <label className="pwiz-race-row">
            <span>N° de dossard</span>
            <input
              className="pwiz-input pwiz-input--bib" value={race.bibNumber ?? ''} placeholder="1234" maxLength={6}
              inputMode="numeric"
              onChange={e => onRaceChange({ ...race, bibNumber: e.target.value })}
            />
          </label>
          {/* Trace sans heures réelles (ou temps prévus choisis) : heure de départ prévue, écrite à l'ouverture du film
              (« Départ prévu… ») et point de départ des temps de passage prévus aux bornes. */}
          {planned && (
            <label className="pwiz-race-row">
              <span>Heure de départ prévue</span>
              <input
                type="time" className="pwiz-input pwiz-input--time"
                value={departureTime}
                onChange={e => onDepartureTimeChange(e.target.value)}
              />
            </label>
          )}
        </div>

        {/* ── Arrivée (masquée sur une boucle : le panneau de départ fait office d'arrivée) ── */}
        {!isLoop && <div className="pwiz-section pwiz-section--endpoint">
          <span className="pwiz-section-label">🏁 Arrivée</span>
          <div className="pwiz-row">
            <input
              className="pwiz-input"
              value={endName}
              disabled={arrHidden}
              placeholder="Nom du lieu d'arrivée"
              onChange={e => onEndNameChange(e.target.value)}
            />
            <label className="pwiz-toggle" title="Afficher / masquer">
              <input
                type="checkbox"
                checked={!arrHidden}
                onChange={() => onToggleLocality(endName)}
              />
              <span className="pwiz-toggle-track" />
            </label>
          </div>
          {!arrHidden && !endIsCol && kindPicker(endKind, onEndKindChange)}
        </div>}

        {/* ── Bornes tous les 5 km et temps de passage (cf. raceSplits.ts) ── */}
        <div className="pwiz-section pwiz-section--bornes">
          <div className="pwiz-row">
            <span className="pwiz-section-label">⏱ Bornes tous les 5 km</span>
            <label className="pwiz-toggle" title="Afficher / masquer les bornes">
              <input
                type="checkbox"
                checked={!race.bornesOff}
                onChange={() => onRaceChange({ ...race, bornesOff: !race.bornesOff })}
              />
              <span className="pwiz-toggle-track" />
            </label>
          </div>
          {!race.bornesOff && (
            <>
              {realTimes && (
                <div className="add-panel-form__row pwiz-kind">
                  {([false, true] as const).map(planned => (
                    <button
                      key={String(planned)} type="button"
                      className={`add-panel-form__type-btn${race.plannedTimes === planned ? ' active' : ''}`}
                      onClick={() => onRaceChange({ ...race, plannedTimes: planned })}
                    >
                      {planned ? 'Temps prévus' : 'Temps du GPX'}
                    </button>
                  ))}
                </div>
              )}
              {realTimes && !race.plannedTimes ? (
                <p className="pwiz-empty">Temps de passage réels, lus dans la trace enregistrée.</p>
              ) : (
                <>
                  <span className="pwiz-race-hint">Vitesse prévue (km/h), par tranche de {SPEED_SLICE_KM} km :</span>
                  {Array.from({ length: speedSliceCount(totalDistance) }, (_, i) => {
                    const a = i * SPEED_SLICE_KM
                    const b = Math.min((i + 1) * SPEED_SLICE_KM, totalDistance / 1000)
                    return (
                      <label key={i} className="pwiz-race-row">
                        <span>{a}–{Math.round(b * 10) / 10} km</span>
                        <input
                          type="number" min={3} max={30} step={0.1} inputMode="decimal"
                          className="pwiz-input pwiz-input--speed"
                          placeholder={i === 0 ? String(DEFAULT_SPEED_KMH) : 'idem'}
                          value={race.speeds[i] || ''}
                          onChange={e => {
                            const speeds = [...race.speeds]
                            speeds[i] = parseFloat(e.target.value.replace(',', '.')) || 0
                            onRaceChange({ ...race, speeds })
                          }}
                        />
                      </label>
                    )
                  })}
                  {hasPlannedSpeeds(race.speeds) && (
                    <p className="pwiz-race-total">
                      Arrivée prévue : {plannedFinish(departureTime, plannedElapsedS(totalDistance / 1000, race.speeds))}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        {/* ── Ravitaillements : kilomètres saisis, placés automatiquement sur le tracé ── */}
        <div className="pwiz-section pwiz-section--ravitos">
          <span className="pwiz-section-label">💧 Ravitaillements</span>
          <p className="pwiz-race-hint">
            Tapez le kilomètre de chaque poste, séparés par un point-virgule <kbd className="pwiz-key">;</kbd>
            {' '}— par exemple <strong className="pwiz-example">5 ; 9 ; 14 ; 18,5</strong> — ou collez la phrase de
            l’organisateur.
          </p>
          <input
            className="pwiz-input" value={race.ravitos ?? ''} placeholder="5 ; 9 ; 14 ; 18,5"
            aria-label="Kilomètres des ravitaillements"
            onChange={e => onRaceChange({ ...race, ravitos: e.target.value })}
          />
          {(() => {
            const kms = parseRavitoKms(race.ravitos)
            if (!kms.length) return null
            const placed = kms.slice(0, ravitoCount), beyond = kms.slice(ravitoCount)
            return (
              <div className="pwiz-ravito-ok" role="status">
                <span className="pwiz-ravito-ok__title">
                  ✓ {placed.length} ravitaillement{placed.length > 1 ? 's' : ''} placé{placed.length > 1 ? 's' : ''} sur le tracé
                </span>
                <span className="pwiz-ravito-chips">
                  {placed.map(km => <span key={km} className="pwiz-ravito-chip">💧 km {formatKm(km)}</span>)}
                </span>
                {beyond.length > 0 && (
                  <span className="pwiz-ravito-warn">
                    Ignoré{beyond.length > 1 ? 's' : ''} (au-delà de l’arrivée) : {beyond.map(km => `km ${formatKm(km)}`).join(', ')}
                  </span>
                )}
              </div>
            )
          })()}
        </div>

        {/* ── Rues empruntées (BD TOPO de l'IGN), écrites le long du tracé dans le film 2D ── */}
        <div className="pwiz-section pwiz-section--streets">
          <span className="pwiz-section-label">Rues empruntées</span>
          {shownGroups.length > 0 && (
            <ul className="pwiz-list">
              <li className="pwiz-item">
                <label className="pwiz-check">
                  <input type="checkbox" checked={allShownChosen} onChange={toggleAllStreets} />
                  <span className="pwiz-check-name">Tous</span>
                </label>
              </li>
              {shownGroups.map(g => (
                <li key={g.name} className="pwiz-item">
                  <label className="pwiz-check">
                    <input type="checkbox" checked={chosenNames.has(g.name)} onChange={() => toggleStreet(g.name)} />
                    <span className="pwiz-check-name">{g.name}</span>
                    {/* Longueur empruntée en tout (une rue trop courte passe trop vite à l'écran), puis km de passage. */}
                    <span className="pwiz-check-type">
                      <strong>{streetLength(g.runs)}</strong> · km {g.runs.map(r => formatKm(r.startM / 1000)).join(' · ')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {streetList !== null && (minorCount > 0 || allStreets) && (
            <button className="pwiz-btn" onClick={() => setAllStreets(v => !v)}>
              {allStreets ? 'Rues importantes seulement' : `Afficher aussi les petites rues (${minorCount})`}
            </button>
          )}
          {streetList === null && (
            <button className="pwiz-btn" disabled={streetState === 'loading'} onClick={findStreets}>
              {streetState === 'loading' ? 'Recherche…' : 'Chercher les rues du parcours (IGN)'}
            </button>
          )}
          {streetState === 'error' && <p className="pwiz-empty">Service IGN indisponible. Réessayez plus tard.</p>}
          {streetList !== null && streetList.length === 0 && <p className="pwiz-empty">Aucune rue nommée trouvée sur ce tracé.</p>}
        </div>

        {/* ── Panneaux ajoutés manuellement (après l'arrivée) ── */}
        <div className="pwiz-section pwiz-section--custom">
          <span className="pwiz-section-label">Panneau à ajouter</span>
          {customLocalities.length > 0 && (
            <ul className="pwiz-list">
              {customLocalities.map(loc => (
                <li
                  key={loc.name} className="pwiz-item pwiz-item--custom"
                  // Glisser le nom sur la carte pour y poser le panneau (voir panelDrag.ts).
                  draggable
                  title="Glisser sur la carte pour placer ce panneau"
                  onDragStart={e => {
                    e.dataTransfer.setData(PANEL_DRAG_MIME, loc.name)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <span className="pwiz-check-name">⠿ {loc.name}</span>
                  <span className="pwiz-check-type">
                    {loc.type === 'col' ? '▲ Col' : loc.placeType === 'hamlet' ? 'Lieu-dit' : loc.placeType === 'poi' ? "Point d'intérêt" : loc.placeType === 'ravito' ? 'Ravitaillement' : 'Localité'}
                  </span>
                  <button
                    className="pwiz-custom-remove"
                    title="Retirer ce panneau"
                    onClick={() => onRemoveCustomLocality(loc.name)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="pwiz-addform">
            <div className="add-panel-form__row">
              {(['localite', 'lieudit', 'poi', 'col'] as const).map(t => (
                <button
                  key={t}
                  className={`add-panel-form__type-btn${addType === t ? ' active' : ''}`}
                  onClick={() => setAddType(t)}
                >
                  {t === 'localite' ? 'Localité' : t === 'lieudit' ? 'Lieu-dit' : t === 'col' ? 'Col' : "Point d'intérêt"}
                </button>
              ))}
            </div>
            <div className="pwiz-addform__row">
              <input
                className="add-panel-form__input"
                placeholder="Nom du panneau…"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
              />
              {addType === 'col' && (
                <input
                  className="add-panel-form__input add-panel-form__input--short"
                  placeholder="Alt. (m)"
                  value={addEle}
                  onChange={e => setAddEle(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
                />
              )}
              <button
                className="add-panel-form__submit"
                disabled={!addName.trim()}
                onClick={submitAdd}
              >
                Ajouter
              </button>
            </div>
          </div>
        </div>

        <div className="pwiz-actions">
          <button className="pwiz-btn pwiz-btn--primary" onClick={onComplete}>
            Terminer ✓
          </button>
        </div>
      </div>
      </div>
    </div>
  )
}

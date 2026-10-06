import { useState } from 'react'
import type { LocalityInfo, ColMarker } from '../hooks/useLocality'
import type { AddPanelInfo } from './AnimationControls'
import { OnboardingBubble } from './OnboardingBubble'
import { PANEL_DRAG_MIME } from '../lib/panelDrag'
import type { EndpointKind } from '../hooks/useTrackNaming'

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
  showHint?: boolean
  onDismissHint?: () => void
}

export function PanelWizard({
  startName, endName, localities, cols,
  excluded, customLocalities, onStartNameChange, onEndNameChange,
  startKind, endKind, startIsCol, endIsCol, onStartKindChange, onEndKindChange,
  onToggleLocality, onAddPanel, onRemoveCustomLocality, onComplete,
  showHint, onDismissHint,
}: Props) {
  const depHidden = excluded.has(startName)
  const arrHidden = excluded.has(endName)
  // Boucle : le même nom au départ et à l'arrivée ne donne qu'un seul panneau.
  const isLoop = !!startName && !!endName && startName.trim().toLowerCase() === endName.trim().toLowerCase()

  const [addType, setAddType] = useState<'localite' | 'lieudit' | 'col' | 'poi'>('localite')
  const [addName, setAddName] = useState('')
  const [addEle, setAddEle] = useState('')

  function submitAdd() {
    if (!addName.trim()) return
    onAddPanel({
      type: addType === 'col' ? 'col' : 'locality',
      name: addName.trim(),
      // Point d'intérêt : une localité à placeType 'poi', dessinée en panneau touristique marron.
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
                    {loc.type === 'col' ? '▲ Col' : loc.placeType === 'hamlet' ? 'Lieu-dit' : loc.placeType === 'poi' ? "Point d'intérêt" : 'Localité'}
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
              {(['localite', 'lieudit', 'col', 'poi'] as const).map(t => (
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

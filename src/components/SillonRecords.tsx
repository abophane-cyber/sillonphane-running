import { useEffect, useMemo, useState } from 'react'
import type { Voyage, VoyageTrack } from '../types'
import { bestRecords, formatRecordTime, RECORD_CATEGORIES } from '../lib/records'
import { posterThumb } from '../lib/posterThumbs'

function shortDate(iso?: string) {
  if (!iso) return ''
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

/** Bandeau des records (5 km, 10 km, semi, marathon) des sillons donnés ; rien tant qu'aucune course n'a de temps. */
export function RecordsBanner({ voyages, title }: { voyages: Voyage[]; title: string }) {
  const best = useMemo(() => bestRecords(voyages), [voyages])
  if (!RECORD_CATEGORIES.some(c => best[c.id])) return null
  return (
    <section className="vp-records" aria-label={title}>
      <h2 className="vp-records__title">{title}</h2>
      <div className="vp-records__grid">
        {RECORD_CATEGORIES.map(c => {
          const r = best[c.id]
          return (
            <div key={c.id} className={`vp-records__cell${r ? '' : ' vp-records__cell--empty'}`}>
              <span className="vp-records__cat">{c.label}</span>
              {r ? (
                <>
                  <strong className="vp-records__time">
                    {formatRecordTime(r.timeS)}
                    {r.gps && <small title="Durée mesurée par le GPS : saisissez votre temps officiel sur l'affiche"> GPS</small>}
                  </strong>
                  <span className="vp-records__race" title={r.name}>{shortDate(r.date) || r.name}</span>
                </>
              ) : (
                <strong className="vp-records__time">—</strong>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Miniature de l'affiche d'une course (dessinée en arrière-plan). */
export function PosterThumb({ track, className }: { track: VoyageTrack; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    posterThumb(track).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [track])
  return (
    <span className={`vp-poster-thumb${className ? ` ${className}` : ''}`}>
      {url ? <img src={url} alt={`Affiche : ${track.name}`} /> : <span className="vp-poster-thumb__wait" />}
    </span>
  )
}

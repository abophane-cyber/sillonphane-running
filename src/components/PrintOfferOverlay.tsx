import { useEffect, useState } from 'react'
import { printPartnersFor, withPromos, POSTER_PARTNERS, PROMO_SCHEDULE, PROMO_URL, type PromoSchedule } from '../lib/printPartners'

interface Props {
  onClose: () => void
  /** Rappel affiché sous le sous-titre — ex. nombre de pages à saisir chez WhiteWall. */
  pageNote?: string
  /** Imprimeur du profil utilisé (voir PrintProfile.partnerId) — on ne propose que celui-là, le PDF
   * étant à ses dimensions. Absent (profil Personnalisé) ⇒ tous les partenaires. */
  partnerId?: string
  /** Album issu de la rando d'exemple : pas de code de réduction, on prévient à la place. */
  demo?: boolean
  /** Affiche de course (Running) : partenaires de tirage photo, libellés « affiche ». */
  poster?: boolean
}

/** Proposée juste après l'enregistrement du PDF : liens (affiliés) vers des services d'impression
 * de livre photo acceptant l'upload direct d'un PDF. */
export function PrintOfferOverlay({ onClose, pageNote, partnerId, demo = false, poster = false }: Props) {
  // Codes promo : calendrier embarqué tout de suite (secours hors connexion), remplacé par
  // public/promo.json dès qu'il est lu — les codes mensuels changent sans nouvelle APK.
  const [schedule, setSchedule] = useState<PromoSchedule>(PROMO_SCHEDULE)
  useEffect(() => {
    let alive = true
    fetch(PROMO_URL, { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: PromoSchedule | null) => { if (alive && data && typeof data === 'object') setSchedule(data) })
      .catch(() => { /* pas de réseau : on garde le calendrier embarqué */ })
    return () => { alive = false }
  }, [])
  // Rando d'exemple : les codes de réduction sont réservés aux albums de vos propres randonnées.
  const basePartners = poster ? POSTER_PARTNERS : printPartnersFor(partnerId)
  const partners = demo ? basePartners : withPromos(basePartners, schedule)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  function copyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(current => (current === code ? null : current)), 2000)
    })
  }

  return (
    <div className="backup-overlay">
      <span className="backup-overlay__label">{poster ? '🖼️ Affiche enregistrée !' : '📷 Album enregistré !'}</span>
      <span className="print-offer__subtitle">{poster ? 'Envie de la faire tirer ?' : 'Envie de le faire imprimer ?'}</span>
      {pageNote && <span className="print-offer__pagenote">{pageNote}</span>}
      {partners.length === 0 && (
        // Profil « Personnalisé » : format libre, non conforme aux exigences des imprimeurs
        // partenaires — on n'en propose aucun, on explique comment obtenir un PDF adapté.
        <>
          <span className="print-offer__subtitle print-offer__subtitle--info">
            🖨️ Vous pouvez l'imprimer chez vous, ou le confier à tout imprimeur qui accepte les fichiers PDF.
          </span>
          <span className="print-offer__pagenote">
            Ce PDF est au format personnalisé : il ne correspond pas aux exigences de nos imprimeurs
            partenaires. Pour le faire imprimer chez l'un d'eux, choisissez-le dans la liste
            « Imprimeur » de « Créer mon album-photo », puis exportez à nouveau le PDF.
          </span>
        </>
      )}
      {demo && partners.length > 0 && (
        <span className="print-offer__pagenote">
          Album de la rando d'exemple : les codes de réduction ne s'appliquent pas. Créez l'album
          d'une de vos randonnées pour en bénéficier.
        </span>
      )}
      <div className="print-offer__actions">
        {partners.length > 0 && <div className="print-offer__partners">
          {partners.map(partner => (
            <div key={partner.name} className="print-offer__partner-block">
              <a
                className="print-offer__partner"
                href={partner.url}
                target="_blank"
                rel="noopener noreferrer sponsored"
              >
                <span className="print-offer__partner-name">{partner.name}</span>
                <span className="print-offer__partner-desc">{partner.description}</span>
              </a>
              {partner.promoCode && (
                <button
                  type="button"
                  className="print-offer__promo"
                  onClick={() => copyCode(partner.promoCode!)}
                >
                  Code promo{partner.promoLabel ? ` ${partner.promoLabel}` : ''} : <strong>{partner.promoCode}</strong>
                  {copiedCode === partner.promoCode ? ' — copié !' : ' (copier)'}
                </button>
              )}
            </div>
          ))}
        </div>}
        <button className="backup-overlay__save-btn print-offer__back-btn" onClick={onClose}>{poster ? '← Retour à l\'affiche' : '← Retour à l\'album'}</button>
      </div>
    </div>
  )
}

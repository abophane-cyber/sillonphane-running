export interface PrintPartner {
  /** Identifiant stable — référencé par `PrintProfile.partnerId` (voir lib/printProfiles.ts). */
  id: string
  name: string
  /** Lien d'affiliation complet (avec ton identifiant de tracking). */
  url: string
  description: string
  /** Code promo à saisir sur le site du partenaire (accord sur-mesure hors réseau d'affiliation) —
   * jamais affiché sur une page publique, uniquement en fin de parcours d'export (voir mémoire projet). */
  promoCode?: string
  /** Pourcentage affiché à côté du code promo (ex. '-15 %') — propre à chaque partenaire, ne pas supposer -15 %. */
  promoLabel?: string
}

/** Partenaires d'impression proposés après l'export du PDF — les deux services pour lesquels un
 * profil d'export existe (voir lib/printProfiles.ts). `url` pointe directement sur la page de
 * téléversement du PDF. WhiteWall est un lien d'affiliation Awin (compte sillonphane.fr/rando, 3087427) ;
 * Flexilivre est un lien direct + code promo SILLONRANDO (-15 %, accord sur-mesure 15/15, actif
 * depuis le 2026-09-16, voir mémoire projet). CEWE.fr et Photobox n'acceptent pas l'upload PDF
 * direct. Blurb et Pixartprinting ont été retirés. */
export const PRINT_PARTNERS: PrintPartner[] = [
  {
    id: 'flexilivre',
    name: 'Flexilivre',
    url: 'https://www.flexilivre.com/fichier/',
    description: 'Téléversez directement votre PDF (couverture = 1re page, dos = dernière page)',
  },
  {
    id: 'whitewall',
    name: 'WhiteWall',
    url: 'https://www.awin1.com/cread.php?awinmid=113542&awinaffid=3087427&ued=https%3A%2F%2Fwww.whitewall.com%2Ffr%2Feditor%2Fbeau-livre%2Ftelechargement-pdf%23%26step%3DProduct_Card%26Product_config%3DA4landscape_paper-digital-glossy_cover-hardcover-glossy_bookEndPaper-white%26productId%3D318',
    description: 'Indiquez d’abord le nombre de pages, puis téléversez le PDF intérieur + le PDF de couverture (lien affilié)',
    // Code promo : voir PROMO_SCHEDULE / public/promo.json (code MENSUEL chez WhiteWall).
  },
]

/** Un code promo et sa période de validité (dates locales AAAA-MM-JJ, bornes incluses). */
export interface PromoEntry {
  code: string
  label?: string
  from?: string
  until?: string
}
export type PromoSchedule = Record<string, PromoEntry[]>

/** Calendrier des codes promo, par id de partenaire. La source de vérité est public/promo.json,
 * lu en ligne à l'ouverture de l'offre d'impression (voir PrintOfferOverlay) : changer un code se
 * fait donc par une simple publication du site, sans nouvelle APK. Cette copie ne sert que de
 * secours hors connexion — la garder alignée sur promo.json.
 * ⚠️ WhiteWall : code MENSUEL fourni par Vivien Liskovsky (WhiteWall Paris), à renouveler chaque
 * mois auprès d'elle (PRS3VLWW26 jusqu'au 30/09/2026, PRS4VLWW26 dès le 01/10/2026, annoncé le
 * 2026-09-25). Passé la dernière date connue, aucun code n'est affiché plutôt qu'un code périmé.
 * Flexilivre : SILLONRANDO (-15 %), accord sur-mesure 15/15 sans échéance. */
export const PROMO_SCHEDULE: PromoSchedule = {
  flexilivre: [{ code: 'SILLONRANDO', label: '-15 %' }],
  whitewall: [
    { code: 'PRS3VLWW26', label: '-3 %', until: '2026-09-30' },
    { code: 'PRS4VLWW26', label: '-3 %', from: '2026-10-01', until: '2026-10-31' },
  ],
}

/** URL absolue, domaine sans www (même contrainte CORS que version.json, voir useAppUpdateCheck). */
export const PROMO_URL = 'https://sillonphane.fr/rando/promo.json'

function todayLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Code valable aujourd'hui pour ce partenaire (le dernier de la liste qui couvre la date), ou undefined. */
export function currentPromo(schedule: PromoSchedule, partnerId: string, today = todayLocal()): PromoEntry | undefined {
  const entries = schedule[partnerId] ?? []
  return entries.filter(e => (!e.from || e.from <= today) && (!e.until || today <= e.until)).pop()
}

/** Partenaires avec le code promo du jour tiré du calendrier. */
export function withPromos(partners: PrintPartner[], schedule: PromoSchedule): PrintPartner[] {
  return partners.map(p => {
    const promo = currentPromo(schedule, p.id)
    return { ...p, promoCode: promo?.code, promoLabel: promo?.label }
  })
}

/** Partenaire(s) à proposer pour un profil donné : uniquement celui du profil utilisé (le PDF est
 * mis aux dimensions de cet imprimeur et ne passe pas ailleurs). `partnerId` absent (profil
 * Personnalisé) ⇒ aucun : ce PDF n'est conforme aux exigences d'aucun partenaire. */
export function printPartnersFor(partnerId: string | undefined): PrintPartner[] {
  if (!partnerId) return []
  const match = PRINT_PARTNERS.filter(p => p.id === partnerId)
  return match.length > 0 ? match : PRINT_PARTNERS
}

/** Génère le court texte d'ambiance d'une étape à partir de ses seules données chiffrées.
 * Entièrement local : aucun appel réseau, aucune donnée transmise.
 *
 * Le texte varie d'un tracé à l'autre (squelette + qualificatif choisis via une graine stable
 * dérivée de l'identifiant), mais reste identique d'un rendu à l'autre pour un même tracé.
 * On ne qualifie que ce que les chiffres disent (distance, dénivelé, boucle) — jamais le
 * paysage, qu'on ne connaît pas. */

interface EditorialInput {
  startLabel: string
  endLabel: string
  distanceKm: number
  elevGain: number
  seed: string
}

/** Nettoie un libellé de lieu géocodé : espaces et ponctuation résiduelle en bout de chaîne
 * (« Lapalisse, » → « Lapalisse »), à l'origine des « ,. » dans l'ancien gabarit. */
function cleanLabel(raw: string): string {
  return (raw || '').trim().replace(/[\s,;–-]+$/u, '').trim()
}

/** Hachage déterministe d'une chaîne vers un entier positif (djb2). */
function hash(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i)
  return h >>> 0
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]
}

export function buildEditorialText({ startLabel, endLabel, distanceKm, elevGain, seed }: EditorialInput): string {
  const dep = cleanLabel(startLabel) || 'le départ'
  const arr = cleanLabel(endLabel) || 'l’arrivée'
  const km = distanceKm.toFixed(1).replace('.', ',')
  const dPlus = Math.round(elevGain)
  const s = hash(seed)

  const isLoop = dep.toLowerCase() === arr.toLowerCase()

  // 1. Clause de liaison
  const linkVariants = isLoop
    ? [
        `Une boucle de ${km} km au départ de ${dep}.`,
        `${km} km en boucle depuis ${dep}.`,
        `Un circuit de ${km} km revenant à ${dep}.`,
      ]
    : [
        `Une étape de ${km} km de ${dep} à ${arr}.`,
        `De ${dep} à ${arr}, ${km} km de marche.`,
        `${km} km pour rejoindre ${arr} depuis ${dep}.`,
      ]

  // 2. Clause d'effort, calée sur le dénivelé positif
  let effortVariants: string[]
  if (dPlus < 150) {
    effortVariants = [
      `Un profil roulant, ${dPlus} m de montée cumulée seulement.`,
      `Le terrain reste facile : ${dPlus} m de dénivelé positif.`,
    ]
  } else if (dPlus < 500) {
    effortVariants = [
      `Le relief se fait sentir, avec ${dPlus} m de montée.`,
      `${dPlus} m de dénivelé positif à avaler en chemin.`,
    ]
  } else if (dPlus < 1000) {
    effortVariants = [
      `Une belle journée de dénivelé : ${dPlus} m de montée.`,
      `${dPlus} m de montée cumulée, les jambes s’en souviennent.`,
    ]
  } else {
    effortVariants = [
      `Grosse journée : ${dPlus} m de montée cumulée.`,
      `Un gros morceau, ${dPlus} m de dénivelé positif.`,
    ]
  }

  return `${pick(linkVariants, s)} ${pick(effortVariants, Math.floor(s / 7))}`
}

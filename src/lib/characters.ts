// ─── Personnages sélectionnables pour l'animation (un seul) ────────

export type CharacterId = 'coureuse1' | 'coureur1' | 'randonneur1' | 'randonneuse1' | 'randonneur2' | 'randonneuse2'

// Running : seuls les coureurs sont proposés (les randonneurs restent déclarés, repris de Sillonphane-Rando).
export const CHARACTER_IDS: CharacterId[] = ['coureuse1', 'coureur1']

// Figurines rendues depuis les modèles 3D des randonneurs (cf. characters3d.ts) : elles montrent le personnage
// tel qu'il apparaît à l'écran.
export const CHARACTER_ICON: Record<CharacterId, string> = {
  coureuse1: `${import.meta.env.BASE_URL}perso/icons/coureuse1.png`,
  coureur1: `${import.meta.env.BASE_URL}perso/icons/coureur1.png`,
  randonneur1: `${import.meta.env.BASE_URL}perso/icons/randonneur1.png`,
  randonneuse1: `${import.meta.env.BASE_URL}perso/icons/randonneuse1.png`,
  randonneur2: `${import.meta.env.BASE_URL}perso/icons/randonneur2.png`,
  randonneuse2: `${import.meta.env.BASE_URL}perso/icons/randonneuse2.png`,
}

// Portraits pré-cadrés (fond + cercle de couleur déjà inclus dans l'image) utilisés par le
// guide d'animation (GuidedTour) : pas besoin de crop CSS.
export const CHARACTER_FACE: Partial<Record<CharacterId, string>> = {
  randonneur1: `${import.meta.env.BASE_URL}randonneur1-face.jpg`,
  randonneuse1: `${import.meta.env.BASE_URL}randonneuse1-face.jpg`,
  randonneur2: `${import.meta.env.BASE_URL}randonneur2-face.jpg`,
  randonneuse2: `${import.meta.env.BASE_URL}randonneuse2-face.jpg`,
}

export const CHARACTER_LABEL: Record<CharacterId, string> = {
  coureuse1: 'Coureuse',
  coureur1: 'Coureur',
  randonneur1: 'Randonneur',
  randonneuse1: 'Randonneuse',
  randonneur2: 'Randonneur',
  randonneuse2: 'Randonneuse',
}

// Aucun personnage choisi par défaut : on force un choix explicite (personnage(s) ou ruban seul)
// avant l'aperçu/l'export plutôt que d'imposer randonneur1.
export const DEFAULT_CHARACTERS: CharacterId[] = []

/**
 * Choisit le personnage au clic : Running n'en montre qu'un (une seule course, un seul coureur). En choisir un autre
 * remplace le précédent ; recliquer sur le personnage choisi est sans effet (on ne descend jamais à 0).
 */
export function toggleCharacter(prev: CharacterId[], id: CharacterId): CharacterId[] {
  if (prev.length === 1 && prev[0] === id) return prev
  return [id]
}

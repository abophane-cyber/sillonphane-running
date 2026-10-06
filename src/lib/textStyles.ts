/** Options de mise en forme des cases-texte — partagées par l'éditeur de pages (AlbumPageEditor)
 * et l'éditeur de couverture/dos (VoyageCoverEditor) pour rester cohérentes. */

/** `value` = pile de familles CSS (avec repli). Les polices auto-hébergées (Playfair Display,
 * Caveat, Permanent Marker — voir @font-face dans App.css) rendent à l'identique hors ligne et
 * dans le PDF exporté ; les autres reposent sur une famille système avec repli générique. */
export const TEXT_FONTS: { value: string; label: string }[] = [
  { value: '', label: 'Défaut' },
  { value: "'Playfair Display', Georgia, serif", label: 'Élégante' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Serif' },
  { value: "'Times New Roman', Times, serif", label: 'Times' },
  { value: "'Trebuchet MS', 'Segoe UI', sans-serif", label: 'Sans-serif' },
  { value: "Arial, Helvetica, sans-serif", label: 'Arial' },
  { value: "Verdana, Geneva, sans-serif", label: 'Verdana' },
  { value: "'Courier New', Courier, monospace", label: 'Machine à écrire' },
  { value: "'Caveat', 'Segoe Script', cursive", label: 'Manuscrite' },
  { value: "'Permanent Marker', 'Comic Sans MS', cursive", label: 'Feutre' },
  { value: "'Brush Script MT', 'Segoe Script', cursive", label: 'Script' },
]

export const TEXT_ALIGNS: { value: 'left' | 'center' | 'right' | 'justify'; label: string; title: string }[] = [
  { value: 'left', label: '↤', title: 'Aligner à gauche' },
  { value: 'center', label: '↔', title: 'Centrer' },
  { value: 'right', label: '↦', title: 'Aligner à droite' },
  { value: 'justify', label: '≣', title: 'Justifier' },
]

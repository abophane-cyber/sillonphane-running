// Portion de rue passée au film 3D (part du parcours) ; les noms sont inscrits le long du parcours (cf. mapLabels.ts).

/** Portion de rue en part du parcours (0 = départ, 1 = arrivée), avec son importance IGN (1 = axe majeur). */
export interface StreetSpan { name: string; from: number; to: number; importance?: number }

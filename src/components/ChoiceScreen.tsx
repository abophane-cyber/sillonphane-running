import { useHeaderBack } from '../hooks/useHeaderBack'
import { SavedTracksBoxes } from './SavedTracksBoxes'

interface Props {
  onRecord: () => void
  onUpload: () => void
  onAlbum: () => void
  onVoyages: () => void
  onBack: () => void
}

export function ChoiceScreen({ onRecord, onUpload, onAlbum, onVoyages, onBack }: Props) {
  useHeaderBack('Retour', onBack)
  return (
    <div className="upload-screen">
      <div className="upload-screen__hero">
        <h1>Que voulez-vous faire ?</h1>
      </div>

      <div className="upload-screen__boxes">
        <div className="gpx-uploader gpx-uploader--record" onClick={onRecord}>
          <div className="gpx-uploader__icon">🔴</div>
          <p className="gpx-uploader__title">Enregistrez en direct votre course avec Sillonphane-Running <span className="gpx-uploader__badge">Android</span></p>
          <p className="gpx-uploader__hint">Sillonphane suit votre position pendant la sortie, même écran éteint</p>
          <p className="gpx-uploader__note">🔒 Tout fonctionne sur votre téléphone - aucune position ni fichier envoyé sur un serveur</p>
        </div>

        <div className="gpx-uploader gpx-uploader--upload" onClick={onUpload}>
          <div className="gpx-uploader__icon">🗺️</div>
          <p className="gpx-uploader__title">J'ai déjà mon GPX</p>
          <p className="gpx-uploader__hint">Importer un fichier GPX ou KML existant</p>
        </div>

        <SavedTracksBoxes onAlbum={onAlbum} onVoyages={onVoyages} />
      </div>
    </div>
  )
}

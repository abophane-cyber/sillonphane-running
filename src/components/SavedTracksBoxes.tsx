import { AppLogoIcon } from './AppLogoIcon'
import { AlbumIcon } from './AlbumIcon'

interface Props {
  onAlbum: () => void
  onVoyages: () => void
}

export function SavedTracksBoxes({ onAlbum, onVoyages }: Props) {
  return (
    <>
      <div className="gpx-uploader gpx-uploader--sillons" onClick={onVoyages}>
        <div className="gpx-uploader__icon"><AppLogoIcon size={48} /></div>
        <p className="gpx-uploader__title">Mes sillons</p>
        <p className="gpx-uploader__hint">Retrouver tous vos tracés enregistrés</p>
      </div>

      <div className="gpx-uploader gpx-uploader--album" onClick={onAlbum}>
        <div className="gpx-uploader__icon"><AlbumIcon size={48} /></div>
        <p className="gpx-uploader__title">Créer mon album-photo</p>
        <p className="gpx-uploader__hint">À partir de vos tracés déjà enregistrés</p>
      </div>
    </>
  )
}

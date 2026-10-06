import { useRef, useState } from 'react'
import { parseGpx, parseKml } from '../lib/gpx'
import type { ParsedGpx } from '../types'
import { MapIcon } from './MapIcon'

interface Props {
  onLoad: (gpx: ParsedGpx, fileName: string, rawText: string) => void
}

export function GpxUploader({ onLoad }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function processFile(file: File) {
    setError(null)
    const name = file.name.toLowerCase()
    const isGpx = name.endsWith('.gpx')
    const isKml = name.endsWith('.kml')
    if (!isGpx && !isKml) {
      setError('Veuillez sélectionner un fichier .gpx ou .kml')
      return
    }
    try {
      const text = await file.text()
      const gpx = isKml ? parseKml(text) : parseGpx(text)
      if (gpx.tracks.length === 0) {
        setError('Aucun tracé trouvé dans ce fichier')
        return
      }
      onLoad(gpx, file.name, text)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de lecture du fichier')
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  return (
    <div
      className={`gpx-uploader${dragging ? ' dragging' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      {/* Pas d'attribut accept : sur Android, le fournisseur de fichiers (pCloud, Drive, etc.)
          filtre selon le type MIME détecté plutôt que l'extension — les .gpx/.kml n'ayant pas de
          MIME standard, ils apparaissent grisés et non sélectionnables. Sans accept, tous les
          fichiers restent sélectionnables ; le filtrage .gpx/.kml se fait dans processFile. */}
      <input ref={inputRef} type="file" onChange={onFileChange} style={{ display: 'none' }} />
      <div className="gpx-uploader__icon"><MapIcon size={48} /></div>
      <p className="gpx-uploader__title">Importez votre fichier GPX ou KML</p>
      <p className="gpx-uploader__hint">Cliquez ou déposez votre fichier ici</p>
      {error && <p className="gpx-uploader__error">{error}</p>}
    </div>
  )
}

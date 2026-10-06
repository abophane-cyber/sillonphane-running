import { useHeaderBack } from '../hooks/useHeaderBack'
import { canRecordGps } from '../lib/device'
import { AppLogoIcon } from './AppLogoIcon'
import { MapIcon } from './MapIcon'
import { PhoneIcon } from './PhoneIcon'
import { RecordIcon } from './RecordIcon'

interface Props {
  onStart: () => void
  onBack: () => void
}

export function HowItWorks({ onStart, onBack }: Props) {
  useHeaderBack('Retour', onBack)
  return (
    <div className="how">
      <div className="how__hero-title">Comment ça marche ?</div>

      <div className="how__cards">

        <div className="how__card how__card--answer">
          <AppLogoIcon size={56} className="how__card-logo-img" />
          <div className="how__card-answer-text">
            <span className="how__brand">Sillonphane-Rando</span>
            <br />vous permet de créer un <strong>film</strong> et les <strong>albums-photos</strong> de vos randonnées
          </div>
        </div>

        <div className="how__connector">
          <div className="how__connector-line" />
          <div className="how__connector-arrow">↓</div>
          <div className="how__connector-line" />
        </div>

        <div className="how__card how__card--q">
          <div className="how__card-badge">02</div>
          <div className="how__card-icon"><MapIcon size={44} /></div>
          <div className="how__card-text">
            Pour cela vous avez besoin du <em>fichier GPX ou KML</em> de votre randonnée et de vos <em>photos</em>
          </div>
        </div>

        <div className="how__connector">
          <div className="how__connector-line" />
          <div className="how__connector-arrow">↓</div>
          <div className="how__connector-line" />
        </div>

        <div className="how__card how__card--q">
          <div className="how__card-badge">03</div>
          <div className="how__card-icon"><PhoneIcon size={44} /></div>
          <div className="how__card-text">
            Sillonphane-Rando fonctionne sur <em>navigateur web</em> comme sur <em>smartphone</em> — vous pouvez éditer vos traces GPX directement depuis votre mobile <em>(Android pour le moment)</em>
          </div>
        </div>

        {canRecordGps() && (
          <>
            <div className="how__connector">
              <div className="how__connector-line" />
              <div className="how__connector-arrow">↓</div>
              <div className="how__connector-line" />
            </div>

            <div className="how__card how__card--q">
              <div className="how__card-badge">04</div>
              <div className="how__card-icon"><RecordIcon size={44} /></div>
              <div className="how__card-text">
                Vous avez déjà la trace <em>GPX ou KML</em> de votre randonnée, ou <em>Sillonphane-Rando peut la faire au moment de votre sortie</em>
              </div>
            </div>
          </>
        )}

      </div>

      <button className="how__start" onClick={onStart}>
        Commencer <span className="how__start-arrow">→</span>
      </button>
    </div>
  )
}

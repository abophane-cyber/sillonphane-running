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
            <span className="how__brand">Sillonphane-Running</span>
            <br />transforme votre course sur route, du 5 km au marathon, en <strong>film animé</strong> et en <strong>affiche à encadrer</strong>
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
            Pour cela il suffit du <em>fichier GPX ou KML</em> de votre course : la trace donne le film 2D ou 3D et l'affiche. Vos <em>photos</em> (l'arrivée, la médaille…) peuvent compléter l'affiche
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
            Sillonphane-Running fonctionne sur <em>navigateur web</em> comme sur <em>smartphone</em> — pas de compte, vos fichiers restent sur votre appareil
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
                Vous avez déjà la trace <em>GPX ou KML</em> de votre course, ou <em>Sillonphane-Running l'enregistre pendant que vous courez</em>
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

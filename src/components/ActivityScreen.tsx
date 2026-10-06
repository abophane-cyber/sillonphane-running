interface Props {
  onSelect: () => void
  onBack: () => void
}

export default function ActivityScreen({ onSelect, onBack }: Props) {
  return (
    <div className="activity-screen">
      <h1 className="activity-screen__title">Quel type d'aventure ?</h1>

      <div className="activity-screen__cards">
        <button className="activity-card" onClick={onSelect}>
          <span className="activity-card__icon">🥾</span>
          <span className="activity-card__label">Randonnée</span>
          <span className="activity-card__desc">Trekking, trail, balade</span>
        </button>
      </div>

      <button className="btn-back-standalone" onClick={onBack}>← Retour</button>
    </div>
  )
}

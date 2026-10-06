import type { WeatherInfo } from '../lib/meteo'

interface Props {
  weather: WeatherInfo
  progress: number  // 0..1
}

export function WeatherProgress({ weather, progress }: Props) {
  const { departure, arrival } = weather

  const tempStart = departure?.temp ?? weather.tempMin
  const tempEnd   = arrival?.temp   ?? weather.tempMax
  const currentTemp = Math.round(tempStart + (tempEnd - tempStart) * progress)

  // Icône : transition à mi-parcours
  const iconStart = departure?.icon ?? '🌡️'
  const iconEnd   = arrival?.icon   ?? '🌡️'
  const icon = progress < 0.5 ? iconStart : iconEnd

  return (
    <div className="weather-badge">
      <span className="weather-badge__icon">{icon}</span>
      <span className="weather-badge__temp">{currentTemp}°</span>
    </div>
  )
}

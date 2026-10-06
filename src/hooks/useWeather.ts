import { useEffect, useState } from 'react'
import { fetchHistoricalWeather, type WeatherInfo } from '../lib/meteo'
import type { GpxTrack } from '../types'

/** Météo historique du tracé, refetchée dès que la date/les heures ou le tracé changent. */
export function useWeather(activeTrack: GpxTrack | null, manualDate: string, departureTime: string, arrivalTime: string) {
  const [weather, setWeather] = useState<WeatherInfo | null>(null)

  useEffect(() => {
    if (!manualDate || !activeTrack) { setWeather(null); return }
    const date = new Date(manualDate + 'T12:00:00')
    const dh = departureTime ? parseInt(departureTime.split(':')[0]) : undefined
    const ah = arrivalTime   ? parseInt(arrivalTime.split(':')[0])   : undefined
    const first = activeTrack.points[0]
    fetchHistoricalWeather(first.lat, first.lon, date, dh, ah).then(w => setWeather(w))
  }, [manualDate, departureTime, arrivalTime, activeTrack])

  return weather
}

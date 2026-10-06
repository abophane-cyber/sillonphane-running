import { useCallback, useRef, useState } from 'react'

export type RecordState = 'idle' | 'recording' | 'processing'

export function useRecorder(fps = 30) {
  const [recState, setRecState] = useState<RecordState>('idle')
  const mrRef     = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef    = useRef<number>(0)

  // Le caller met à jour cette ref à chaque render pour que le draw loop
  // ait toujours accès aux données courantes sans re-démarrer l'enregistrement.
  const onFrameRef = useRef<((ctx: CanvasRenderingContext2D, w: number, h: number) => void) | null>(null)

  const start = useCallback((
    mapCanvas: HTMLCanvasElement,
    frameRef: typeof onFrameRef,
  ) => {
    onFrameRef.current = frameRef.current

    const w = mapCanvas.width
    const h = mapCanvas.height
    const composite = document.createElement('canvas')
    composite.width  = w
    composite.height = h
    const ctx = composite.getContext('2d')!

    function drawLoop() {
      ctx.clearRect(0, 0, w, h)
      try { ctx.drawImage(mapCanvas, 0, 0, w, h) } catch { /* webgl peut être lost */ }
      frameRef.current?.(ctx, w, h)
      rafRef.current = requestAnimationFrame(drawLoop)
    }
    drawLoop()

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : 'video/webm'

    const stream = composite.captureStream(fps)
    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 20_000_000 })
    mrRef.current = mr
    chunksRef.current = []
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.start(200)
    setRecState('recording')
  }, [fps])

  const stop = useCallback((): Promise<Blob> => {
    return new Promise(resolve => {
      cancelAnimationFrame(rafRef.current)
      const mr = mrRef.current!
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' })
        setRecState('idle')
        resolve(blob)
      }
      setRecState('processing')
      mr.stop()
    })
  }, [])

  const cancel = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    try { mrRef.current?.stop() } catch { /* ignore */ }
    setRecState('idle')
  }, [])

  return { recState, start, stop, cancel, onFrameRef }
}

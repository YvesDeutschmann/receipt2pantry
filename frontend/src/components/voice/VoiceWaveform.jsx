import { useEffect, useState } from 'react'

const BARS = 28

const baseHeights = () =>
  Array.from({ length: BARS }, (_, i) => 6 + (i % 3) * 2)

/**
 * Live levels from AnalyserNode; gentle idle pulse when inactive.
 */
export default function VoiceWaveform({ analyser, isActive }) {
  const [heights, setHeights] = useState(baseHeights)

  useEffect(() => {
    if (!isActive || !analyser) {
      setHeights(baseHeights())
      return
    }

    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf

    const tick = () => {
      analyser.getByteFrequencyData(data)
      const step = Math.max(1, Math.floor(data.length / BARS))
      const next = []
      for (let i = 0; i < BARS; i++) {
        let sum = 0
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0
        const avg = sum / step
        const h = 4 + (avg / 255) * 44
        next.push(Math.min(48, h))
      }
      setHeights(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [analyser, isActive])

  return (
    <div className="flex items-end justify-center gap-0.5 h-14 px-2" aria-hidden>
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1 rounded-full origin-bottom transition-[height] duration-75"
          style={{
            height: `${h}px`,
            minHeight: 4,
            background: isActive ? 'var(--color-terra)' : 'var(--color-sage-light)',
            opacity: isActive ? 0.9 : 0.4,
          }}
        />
      ))}
    </div>
  )
}

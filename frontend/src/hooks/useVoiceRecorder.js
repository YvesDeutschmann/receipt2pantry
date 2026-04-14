import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Push-to-talk recorder with optional AnalyserNode for waveform UI.
 * Uses MediaRecorder in Capacitor WebView / modern browsers.
 */
export function useVoiceRecorder() {
  const [status, setStatus] = useState('idle') // idle | requesting | recording | stopped
  const [audioBlob, setAudioBlob] = useState(null)
  const [error, setError] = useState(null)
  const [durationSec, setDurationSec] = useState(0)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const audioContextRef = useRef(null)
  const analyserRef = useRef(null)
  const sourceRef = useRef(null)
  const startedAtRef = useRef(null)
  const tickRef = useRef(null)

  const cleanupStream = useCallback(() => {
    if (tickRef.current != null) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch {
        /* ignore */
      }
      sourceRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    analyserRef.current = null
  }, [])

  const pickMimeType = useCallback(() => {
    if (typeof MediaRecorder === 'undefined') return ''
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/mp4;codecs=mp4a.40.2',
    ]
    for (const t of candidates) {
      if (MediaRecorder.isTypeSupported?.(t)) return t
    }
    return ''
  }, [])

  const stopRecording = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (mr && mr.state === 'recording') {
      mr.stop()
    }
    setStatus('stopped')
    // Defer cleanupStream until mr.onstop — keeps tracks alive until blob is built
    mediaRecorderRef.current = null
  }, [])

  const resetRecording = useCallback(() => {
    cleanupStream()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop()
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null
    chunksRef.current = []
    setAudioBlob(null)
    setError(null)
    setDurationSec(0)
    setStatus('idle')
  }, [cleanupStream])

  const startRecording = useCallback(async () => {
    setError(null)
    setAudioBlob(null)
    chunksRef.current = []
    setDurationSec(0)
    setStatus('requesting')

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Microphone is not available in this browser.')
      setStatus('idle')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const options = mimeType ? { mimeType } : undefined
      let mr
      try {
        mr = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream)
      } catch {
        mr = new MediaRecorder(stream)
      }
      mediaRecorderRef.current = mr

      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data)
      }

      mr.onerror = () => {
        setError('Recording failed.')
      }

      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (Ctx) {
          const ctx = new Ctx()
          audioContextRef.current = ctx
          const source = ctx.createMediaStreamSource(stream)
          sourceRef.current = source
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.65
          source.connect(analyser)
          analyserRef.current = analyser
        }
      } catch {
        analyserRef.current = null
      }

      mr.onstop = () => {
        const type =
          chunksRef.current[0]?.type ||
          mr.mimeType ||
          mimeType ||
          'audio/webm'
        const blob = new Blob(chunksRef.current, { type: type.split(';')[0] || 'audio/webm' })
        setAudioBlob(blob)
        chunksRef.current = []
        cleanupStream()
      }

      const sliceMs = 250
      try {
        mr.start(sliceMs)
      } catch {
        mr.start()
      }

      startedAtRef.current = Date.now()
      tickRef.current = setInterval(() => {
        const s = startedAtRef.current
        if (s) setDurationSec(Math.floor((Date.now() - s) / 1000))
      }, 500)

      setStatus('recording')
    } catch (err) {
      const name = err?.name || ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Microphone permission denied. You can add items with search instead.')
      } else {
        setError(err?.message || 'Could not start recording.')
      }
      cleanupStream()
      setStatus('idle')
    }
  }, [cleanupStream, pickMimeType])

  useEffect(
    () => () => {
      cleanupStream()
      if (mediaRecorderRef.current?.state === 'recording') {
        try {
          mediaRecorderRef.current.stop()
        } catch {
          /* ignore */
        }
      }
    },
    [cleanupStream]
  )

  return {
    status,
    audioBlob,
    error,
    durationSec,
    startRecording,
    stopRecording,
    resetRecording,
    getAnalyser: () => analyserRef.current,
  }
}

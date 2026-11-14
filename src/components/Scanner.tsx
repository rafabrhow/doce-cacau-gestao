import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { X, Camera, RefreshCw } from 'lucide-react'

type ScannerProps = {
  onScan: (code: string) => void
  onClose: () => void
}

function explainCameraError(error: unknown) {
  const name = error instanceof DOMException ? error.name : ''
  if (!window.isSecureContext) return 'A câmera exige HTTPS confiável. Abra o endereço HTTPS do sistema.'
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'O Safari não liberou a câmera. Confira Ajustes do iPhone > Safari > Câmera e a permissão deste site.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Nenhuma câmera foi encontrada neste aparelho.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'A câmera está ocupada ou não conseguiu iniciar. Feche outros aplicativos que possam estar usando a câmera.'
  if (name === 'OverconstrainedError') return 'A câmera traseira solicitada não está disponível. Tente novamente.'
  return error instanceof Error ? `Não foi possível iniciar a câmera: ${error.message}` : 'Não foi possível iniciar a câmera. Tente novamente.'
}

export default function Scanner({ onScan, onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const controlsRef = useRef<IScannerControls | null>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const onScanRef = useRef(onScan)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [active, setActive] = useState(false)

  onScanRef.current = onScan

  const stopCamera = () => {
    controlsRef.current?.stop()
    controlsRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
    }
    setActive(false)
  }

  const startCamera = async () => {
    if (starting || active) return
    setError('')
    setStarting(true)

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador não disponibilizou getUserMedia.')
      }
      if (!window.isSecureContext) {
        throw new Error('A câmera exige HTTPS confiável.')
      }

      // Executado diretamente no toque do usuário: importante para o Safari iOS.
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
      } catch (rearError) {
        // Alguns aparelhos não identificam a câmera traseira pelo facingMode exact.
        if (rearError instanceof DOMException && (rearError.name === 'OverconstrainedError' || rearError.name === 'NotFoundError')) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } },
          })
        } else {
          throw rearError
        }
      }

      streamRef.current = stream
      const video = videoRef.current
      if (!video) throw new Error('Área de vídeo não encontrada.')

      video.muted = true
      video.autoplay = true
      video.playsInline = true
      video.setAttribute('playsinline', 'true')
      video.srcObject = stream
      await video.play()

      const reader = new BrowserMultiFormatReader()
      readerRef.current = reader
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) {
          const code = result.getText()
          stopCamera()
          onScanRef.current(code)
        }
      })
      controlsRef.current = controls
      setActive(true)
    } catch (err) {
      stopCamera()
      setError(explainCameraError(err))
    } finally {
      setStarting(false)
    }
  }

  useEffect(() => () => {
    controlsRef.current?.stop()
    streamRef.current?.getTracks().forEach(track => track.stop())
  }, [])

  return (
    <div className="modal-backdrop">
      <div className="modal scanner-modal">
        <div className="modal-head">
          <h2><Camera size={20} /> Ler código de barras</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar leitor"><X /></button>
        </div>
        <div className="scanner-camera-area">
          <video ref={videoRef} className="scanner-video" muted playsInline autoPlay />
          {!active && !starting && (
            <div className="scanner-status">
              <button className="btn-primary" onClick={startCamera}>
                <Camera size={17} /> Ativar câmera
              </button>
            </div>
          )}
          {starting && <div className="scanner-status">Solicitando acesso e iniciando câmera...</div>}
        </div>
        {error && (
          <div className="scanner-error">
            <p className="error">{error}</p>
            <button className="btn-secondary" onClick={startCamera} disabled={starting}>
              <RefreshCw size={16} /> Tentar novamente
            </button>
          </div>
        )}
        {active && <p className="muted">Câmera ativa. Aponte para o código de barras ou QR Code.</p>}
        {!active && !error && !starting && <p className="muted">Toque em Ativar câmera e permita o acesso quando o Safari solicitar.</p>}
      </div>
    </div>
  )
}

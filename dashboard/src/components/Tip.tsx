import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Tip — Tooltip estilizado compartido (igual al del Header).
 * Reemplaza los `title=` nativos del navegador para consistencia visual.
 *
 * Se renderiza en document.body vía portal para que NO quede recortado
 * por contenedores con overflow (scroll lists, modals).
 *
 * Props:
 *   children — elemento que activa el tooltip al hacer hover
 *   content  — contenido del tooltip (puede ser JSX)
 *   position — 'bottom' (por defecto) | 'top'
 *   align    — 'right' (por defecto) | 'left'
 */
export function Tip({
  children,
  content,
  position = 'bottom',
  align = 'right',
}: {
  children:  React.ReactNode
  content:   React.ReactNode
  position?: 'top' | 'bottom'
  align?:    'left' | 'right'   // 'right' = tooltip abre hacia izquierda (default), 'left' = abre hacia derecha
}) {
  const [hovered, setHovered] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [measured, setMeasured] = useState(false)

  useEffect(() => {
    if (!hovered) {
      setMeasured(false)
      return
    }
    const trigger = triggerRef.current
    const tip = tipRef.current
    if (!trigger || !tip) return
    const tr = trigger.getBoundingClientRect()
    const tp = tip.getBoundingClientRect()
    const margin = 8
    let top = position === 'top' ? tr.top - tp.height - margin : tr.bottom + margin
    let left = align === 'left' ? tr.left : tr.right - tp.width
    top = Math.max(4, Math.min(top, window.innerHeight - tp.height - 4))
    left = Math.max(4, Math.min(left, window.innerWidth - tp.width - 4))
    setCoords({ top, left })
    setMeasured(true)
  }, [hovered, position, align, content])

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'block', width: '100%', height: '100%' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && createPortal(
        <div
          ref={tipRef}
          style={{
            position: 'fixed',
            top: coords?.top ?? 0,
            left: coords?.left ?? 0,
            visibility: measured ? 'visible' : 'hidden',
            zIndex: 100000,
            background: '#161b22',
            border: '1px solid #30363d',
            borderRadius: 7,
            padding: '10px 13px',
            minWidth: 180,
            maxWidth: 280,
            boxShadow: '0 8px 24px #00000066',
            pointerEvents: 'none',
            animation: 'tipFadeIn 0.15s ease forwards',
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  )
}
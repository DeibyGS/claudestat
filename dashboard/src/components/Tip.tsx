import { useState } from 'react'

/**
 * Tip — Tooltip estilizado compartido (igual al del Header).
 * Reemplaza los `title=` nativos del navegador para consistencia visual.
 *
 * Props:
 *   children — elemento que activa el tooltip al hacer hover
 *   content  — contenido del tooltip (puede ser JSX)
 *   position — 'bottom' (por defecto) | 'top'
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
  const posStyle = position === 'top'
    ? { bottom: 'calc(100% + 8px)', top: 'auto' }
    : { top: 'calc(100% + 8px)' }
  const alignStyle = align === 'left' ? { left: 0 } : { right: 0 }

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <div style={{
          position: 'absolute',
          ...posStyle,
          ...alignStyle,
          zIndex: 200,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 7,
          padding: '10px 13px',
          minWidth: 180,
          maxWidth: 280,
          boxShadow: '0 8px 24px #00000066',
          pointerEvents: 'none',
          animation: 'tipFadeIn 0.15s ease forwards',
        }}>
          {content}
        </div>
      )}
    </span>
  )
}

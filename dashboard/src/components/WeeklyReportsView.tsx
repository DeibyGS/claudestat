import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { FileText, ChevronRight, Download, Zap } from 'lucide-react'

interface ReportMeta {
  id: number
  date: string
  preview: string
  created_at: string
}

interface ReportFull extends ReportMeta {
  report_markdown: string
}

// ── Extrae conteos de tareas del markdown ────────────────────────────────────
function extractTaskCounts(md: string): { done: number; pending: number } {
  const done    = (md.match(/- \[x\]/gi) ?? []).length
  const pending = (md.match(/- \[ \]/g)  ?? []).length
  return { done, pending }
}

// ── Renderizador de markdown básico (sin dependencias extra) ─────────────────
function MarkdownView({ content }: { content: string }) {
  const lines = content.split('\n')
  return (
    <div style={{ fontFamily: 'inherit', lineHeight: 1.7, color: '#c9d1d9' }}>
      {lines.map((line, i) => {
        if (line.startsWith('# '))
          return <h1 key={i} style={{ fontSize: 18, fontWeight: 700, color: '#e6edf3', margin: '20px 0 8px', borderBottom: '1px solid #21262d', paddingBottom: 6 }}>{line.slice(2)}</h1>
        if (line.startsWith('## '))
          return <h2 key={i} style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3', margin: '16px 0 6px' }}>{line.slice(3)}</h2>
        if (line.startsWith('### '))
          return <h3 key={i} style={{ fontSize: 13, fontWeight: 600, color: '#8b949e', margin: '12px 0 4px' }}>{line.slice(4)}</h3>
        if (line.startsWith('- [x] '))
          return <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', margin: '3px 0', color: '#3fb950', fontSize: 12 }}>✅ <span style={{ textDecoration: 'line-through', color: '#6e7681' }}>{line.slice(6)}</span></div>
        if (line.startsWith('- [ ] '))
          return <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', margin: '3px 0', fontSize: 12 }}>⬜ <span>{line.slice(6)}</span></div>
        if (line.startsWith('- '))
          return <div key={i} style={{ margin: '3px 0', paddingLeft: 16, fontSize: 12 }}>· {line.slice(2)}</div>
        if (line.startsWith('---'))
          return <hr key={i} style={{ border: 'none', borderTop: '1px solid #21262d', margin: '14px 0' }} />
        if (line.startsWith('> '))
          return <blockquote key={i} style={{ margin: '8px 0', paddingLeft: 12, borderLeft: '3px solid #30363d', color: '#8b949e', fontSize: 12 }}>{line.slice(2)}</blockquote>
        if (line.trim() === '')
          return <div key={i} style={{ height: 6 }} />
        return <p key={i} style={{ margin: '3px 0', fontSize: 12 }}>{line}</p>
      })}
    </div>
  )
}

// ── Componente principal ─────────────────────────────────────────────────────
export function WeeklyReportsView() {
  const [reports,    setReports]    = useState<ReportMeta[]>([])
  const [selected,   setSelected]   = useState<ReportFull | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [importing,  setImporting]  = useState(false)
  const [importMsg,  setImportMsg]  = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  function fetchReports() {
    fetch('/api/weekly-reports')
      .then(r => r.json())
      .then(setReports)
      .catch(() => {})
  }

  useEffect(() => { fetchReports() }, [])

  async function handleGenerateNow() {
    setGenerating(true)
    setImportMsg(null)
    try {
      const r = await fetch('/api/weekly-reports/generate-now', { method: 'POST' })
      const d = await r.json()
      if (d.skipped) {
        setImportMsg(`Ya existe un informe para hoy (${d.date})`)
      } else {
        setImportMsg(`Informe generado: ${d.date}`)
        fetchReports()
      }
    } catch {
      setImportMsg('Error al generar')
    }
    setGenerating(false)
  }

  async function handleImport() {
    setImporting(true)
    setImportMsg(null)
    try {
      const r = await fetch('/api/weekly-reports/import-local', { method: 'POST' })
      const d = await r.json()
      setImportMsg(`${d.imported} importado(s), ${d.skipped} ya existían`)
      if (d.imported > 0) fetchReports()
    } catch {
      setImportMsg('Error al importar')
    }
    setImporting(false)
  }

  async function selectReport(date: string) {
    setLoading(true)
    try {
      const r = await fetch(`/api/weekly-reports/${date}`)
      if (r.ok) setSelected(await r.json())
    } catch {}
    setLoading(false)
  }

  // Datos para el gráfico: semana → { done, pending }
  const chartData = [...reports].reverse().map(r => {
    const { done, pending } = extractTaskCounts(r.preview + '…') // preview es parcial
    return { week: r.date.slice(5), done, pending } // "MM-DD"
  })

  const S = {
    container: {
      display: 'flex', height: '100%', overflow: 'hidden', background: '#0d1117',
    } as React.CSSProperties,
    sidebar: {
      width: 240, flexShrink: 0, borderRight: '1px solid #21262d',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    } as React.CSSProperties,
    sidebarHeader: {
      padding: '12px 14px', borderBottom: '1px solid #21262d',
      fontSize: 12, fontWeight: 600, color: '#8b949e',
      display: 'flex', alignItems: 'center', gap: 6,
    } as React.CSSProperties,
    reportList: {
      flex: 1, overflowY: 'auto' as const,
    },
    reportItem: (active: boolean): React.CSSProperties => ({
      padding: '10px 14px', cursor: 'pointer',
      background: active ? '#161b22' : 'transparent',
      borderLeft: active ? '2px solid #1f6feb' : '2px solid transparent',
      borderBottom: '1px solid #21262d',
      transition: 'background 0.1s',
    }),
    reportDate: {
      fontSize: 12, fontWeight: 600, color: '#e6edf3', marginBottom: 3,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    } as React.CSSProperties,
    reportPreview: {
      fontSize: 11, color: '#6e7681', lineHeight: 1.4,
      overflow: 'hidden', display: '-webkit-box',
      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
    } as React.CSSProperties,
    main: {
      flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    } as React.CSSProperties,
    chartSection: {
      padding: '14px 20px', borderBottom: '1px solid #21262d', flexShrink: 0,
    } as React.CSSProperties,
    chartTitle: {
      fontSize: 11, fontWeight: 600, color: '#6e7681', marginBottom: 10,
    } as React.CSSProperties,
    content: {
      flex: 1, overflowY: 'auto' as const, padding: '20px 24px',
    },
    empty: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: '#484f58', fontSize: 13,
    } as React.CSSProperties,
  }

  return (
    <div style={S.container}>

      {/* ── Sidebar: lista de reportes ── */}
      <div style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <FileText size={12} />
          <span style={{ flex: 1 }}>Informes semanales</span>
          <button
            onClick={handleGenerateNow}
            disabled={generating}
            title="Generar informe ahora"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: '1px solid #30363d',
              borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
              color: generating ? '#484f58' : '#58a6ff', fontSize: 10,
              transition: 'color 0.15s',
            }}
          >
            <Zap size={10} />
            {generating ? '…' : 'Generar'}
          </button>
          <button
            onClick={handleImport}
            disabled={importing}
            title="Importar reportes de ~/.claude/reports/"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: '1px solid #30363d',
              borderRadius: 4, padding: '2px 6px', cursor: 'pointer',
              color: importing ? '#484f58' : '#8b949e', fontSize: 10,
              transition: 'color 0.15s',
            }}
          >
            <Download size={10} />
            {importing ? '…' : 'Importar'}
          </button>
        </div>
        {importMsg && (
          <div style={{ padding: '6px 14px', fontSize: 10, color: '#3fb950', background: '#3fb95010', borderBottom: '1px solid #21262d' }}>
            {importMsg}
          </div>
        )}
        <div style={S.reportList}>
          {reports.length === 0 && (
            <div style={{ padding: 14, fontSize: 11, color: '#484f58' }}>
              Sin reportes. El script weekly-review.sh los genera cada lunes.
            </div>
          )}
          {reports.map(r => (
            <div
              key={r.id}
              style={S.reportItem(selected?.date === r.date)}
              onClick={() => selectReport(r.date)}
            >
              <div style={S.reportDate}>
                {r.date}
                <ChevronRight size={11} color="#484f58" />
              </div>
              <div style={S.reportPreview}>{r.preview}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Panel principal ── */}
      <div style={S.main}>

        {/* Gráfica de tareas por semana */}
        {reports.length > 1 && (
          <div style={S.chartSection}>
            <div style={S.chartTitle}>TAREAS POR SEMANA</div>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={chartData} barSize={14} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: '#6e7681' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#6e7681' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6, fontSize: 11 }}
                  labelStyle={{ color: '#e6edf3', fontWeight: 600 }}
                  itemStyle={{ color: '#8b949e' }}
                  cursor={{ fill: '#21262d' }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10, color: '#8b949e' }} />
                <Bar dataKey="done"    name="Completadas" fill="#3fb950" radius={[2, 2, 0, 0]} />
                <Bar dataKey="pending" name="Pendientes"  fill="#30363d" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Contenido del reporte seleccionado */}
        <div style={S.content}>
          {loading && <div style={S.empty}>Cargando…</div>}
          {!loading && !selected && (
            <div style={S.empty}>
              {reports.length > 0 ? 'Seleccioná un informe para verlo' : 'Aún no hay informes generados'}
            </div>
          )}
          {!loading && selected && <MarkdownView content={selected.report_markdown} />}
        </div>

      </div>
    </div>
  )
}

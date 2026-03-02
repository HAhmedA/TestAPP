import { useEffect, useState } from 'react'
import { api } from '../api/client'

interface CandidateRow {
    k: number
    covType: string
    bic: number
    aic: number
    entropy: number
    compositeRank: number
}

interface ConceptDiagnostic {
    conceptId: string
    selectedK: number
    selectedCovType: string
    silhouetteScore: number | null
    daviesBouldinIndex: number | null
    allCandidates: CandidateRow[]
    clusterSizes: number[]
    nUsers: number | null
    nDimensions: number | null
    computedAt: string | null
}

interface ClusterMember {
    conceptId: string
    clusterIndex: number
    clusterLabel: string
    clusterP50: number | null
    userId: string
    name: string
    email: string
    score: number | null
    trend: string | null
    percentilePosition: number | null
    breakdown: Record<string, { score: number; categoryLabel?: string }> | null
}

const CONCEPT_LABELS: Record<string, string> = {
    lms: 'LMS Engagement',
    sleep: 'Sleep',
    screen_time: 'Screen Time',
    srl: 'Self-Regulated Learning'
}

const DIMENSION_COLS: Record<string, { key: string; label: string }[]> = {
    lms: [
        { key: 'volume', label: 'Vol' },
        { key: 'consistency', label: 'Cons' },
        { key: 'participation_variety', label: 'Variety' },
        { key: 'session_quality', label: 'Session' }
    ],
    sleep: [
        { key: 'duration', label: 'Duration' },
        { key: 'continuity', label: 'Cont' },
        { key: 'timing', label: 'Timing' }
    ],
    screen_time: [
        { key: 'volume', label: 'Vol' },
        { key: 'distribution', label: 'Dist' },
        { key: 'pre_sleep', label: 'Pre-sleep' }
    ],
    srl: []
}

function silhouetteAssessment(s: number | null): { label: string; icon: string; color: string } {
    if (s == null) return { label: 'No data', icon: '—', color: '#6b7280' }
    if (s >= 0.7) return { label: 'Strong separation (≥0.7)', icon: '✅', color: '#065F46' }
    if (s >= 0.5) return { label: 'Reasonable separation (0.5–0.7)', icon: '🔶', color: '#92400e' }
    return { label: 'Weak separation (<0.5)', icon: '⚠️', color: '#991b1b' }
}

function dbAssessment(db: number | null): { label: string; icon: string; color: string } {
    if (db == null) return { label: 'No data', icon: '—', color: '#6b7280' }
    if (db < 1.0) return { label: 'Well-separated (<1.0)', icon: '✅', color: '#065F46' }
    if (db < 1.5) return { label: 'Acceptable (1.0–1.5)', icon: '🔶', color: '#92400e' }
    return { label: 'Poor separation (≥1.5)', icon: '⚠️', color: '#991b1b' }
}

function formatDate(iso: string | null): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleString()
}

function scoreColor(v: number | null | undefined): string {
    if (v == null) return '#6b7280'
    if (v >= 70) return '#065F46'
    if (v >= 40) return '#92400e'
    return '#991b1b'
}

function ordinal(n: number | null | undefined): string {
    if (n == null) return '—'
    const v = Math.round(n)
    const s = ['th', 'st', 'nd', 'rd']
    const mod = v % 100
    return v + (s[(mod - 20) % 10] || s[mod] || s[0])
}

function trendIcon(t: string | null): string {
    if (t === 'improving') return '↑'
    if (t === 'declining') return '↓'
    return '→'
}

function tierDot(clusterIndex: number, totalClusters: number): string {
    if (clusterIndex === totalClusters - 1) return '🟢'
    if (clusterIndex === 0) return '🟡'
    return '🔵'
}

const AdminClusterDiagnosticsPanel = () => {
    const [diagnostics, setDiagnostics] = useState<ConceptDiagnostic[]>([])
    const [members, setMembers] = useState<ClusterMember[]>([])
    const [loading, setLoading] = useState(true)
    const [membersLoading, setMembersLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [collapsed, setCollapsed] = useState(true)

    useEffect(() => {
        api.get<{ diagnostics: ConceptDiagnostic[] }>('/admin/cluster-diagnostics')
            .then(data => {
                setDiagnostics(data.diagnostics || [])
                setLoading(false)
            })
            .catch(err => {
                setError(err.message)
                setLoading(false)
            })
    }, [])

    useEffect(() => {
        api.get<{ members: ClusterMember[] }>('/admin/cluster-members')
            .then(data => {
                setMembers(data.members || [])
                setMembersLoading(false)
            })
            .catch(() => {
                setMembersLoading(false)
            })
    }, [])

    // Group members: conceptId → clusterIndex → ClusterMember[]
    const grouped: Record<string, Record<number, ClusterMember[]>> = {}
    for (const m of members) {
        grouped[m.conceptId] ??= {}
        grouped[m.conceptId][m.clusterIndex] ??= []
        grouped[m.conceptId][m.clusterIndex].push(m)
    }

    return (
        <div style={{
            background: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            marginTop: '16px',
            overflow: 'hidden'
        }}>
            {/* Collapsible header */}
            <button
                onClick={() => setCollapsed(c => !c)}
                style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 20px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 700,
                    color: '#374151',
                    textAlign: 'left'
                }}
            >
                <span>📊 Cluster Diagnostics</span>
                <span style={{ fontSize: '12px', color: '#9ca3af' }}>{collapsed ? 'Show ▼' : 'Hide ▲'}</span>
            </button>

            {!collapsed && (
                <div style={{ padding: '0 20px 20px' }}>
                    {loading && <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading diagnostics…</p>}
                    {error && <p style={{ color: '#991b1b', fontSize: '13px' }}>Error: {error}</p>}
                    {!loading && !error && diagnostics.length === 0 && (
                        <p style={{ color: '#6b7280', fontSize: '13px' }}>
                            No diagnostics yet — run a scoring pipeline first.
                        </p>
                    )}
                    {diagnostics.map(d => {
                        const sil = silhouetteAssessment(d.silhouetteScore)
                        const db = dbAssessment(d.daviesBouldinIndex)
                        const minSize = d.clusterSizes.length > 0 ? Math.min(...d.clusterSizes) : null
                        const bestCandidateRank = d.allCandidates.length > 0
                            ? Math.min(...d.allCandidates.map(c => c.compositeRank))
                            : null

                        // Members for this concept
                        const conceptGrouped = grouped[d.conceptId] ?? {}
                        const clusterIndexes = Object.keys(conceptGrouped).map(Number).sort((a, b) => a - b)
                        const totalMembers = clusterIndexes.reduce((sum, idx) => sum + conceptGrouped[idx].length, 0)
                        const totalClusters = clusterIndexes.length

                        // Determine dimension columns (srl: dynamic from first member)
                        const dimCols: { key: string; label: string }[] = d.conceptId === 'srl'
                            ? Object.keys(members.find(m => m.conceptId === 'srl')?.breakdown ?? {}).map(k => ({ key: k, label: k }))
                            : (DIMENSION_COLS[d.conceptId] ?? [])

                        return (
                            <div key={d.conceptId} style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                marginBottom: '14px',
                                overflow: 'hidden'
                            }}>
                                {/* Concept header */}
                                <div style={{
                                    background: '#f9fafb',
                                    padding: '8px 14px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    borderBottom: '1px solid #e5e7eb'
                                }}>
                                    <span style={{ fontWeight: 700, fontSize: '13px', color: '#111827' }}>
                                        {CONCEPT_LABELS[d.conceptId] || d.conceptId}
                                    </span>
                                    <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                                        Last run: {formatDate(d.computedAt)}
                                    </span>
                                </div>

                                <div style={{ padding: '10px 14px', fontSize: '13px', color: '#374151' }}>
                                    {/* Summary row */}
                                    <div style={{ marginBottom: '8px' }}>
                                        <span style={{ fontWeight: 600 }}>Selected model: </span>
                                        K={d.selectedK}, {d.selectedCovType} covariance
                                        &nbsp;|&nbsp; N users: {d.nUsers ?? '—'}
                                        &nbsp;|&nbsp; N dimensions: {d.nDimensions ?? '—'}
                                    </div>

                                    {/* Metric assessments */}
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
                                        <div>
                                            <span style={{ fontWeight: 600 }}>Silhouette: </span>
                                            <span style={{ color: sil.color }}>
                                                {d.silhouetteScore != null ? d.silhouetteScore.toFixed(3) : '—'} {sil.icon} {sil.label}
                                            </span>
                                        </div>
                                        <div>
                                            <span style={{ fontWeight: 600 }}>Davies-Bouldin: </span>
                                            <span style={{ color: db.color }}>
                                                {d.daviesBouldinIndex != null ? d.daviesBouldinIndex.toFixed(3) : '—'} {db.icon} {db.label}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Cluster sizes + small-cluster warning */}
                                    {d.clusterSizes.length > 0 && (
                                        <div style={{ marginBottom: '10px' }}>
                                            <span style={{ fontWeight: 600 }}>Cluster sizes: </span>
                                            {d.clusterSizes.map((sz, i) => `Group ${i + 1}: ${sz}`).join(' · ')}
                                            {minSize != null && minSize < 3 && (
                                                <span style={{ color: '#991b1b', marginLeft: '8px' }}>
                                                    ⚠️ Min cluster size &lt;3 — possible degenerate cluster
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Candidates table */}
                                    {d.allCandidates.length > 0 && (
                                        <details>
                                            <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '6px', fontSize: '12px', color: '#6b7280' }}>
                                                Candidate comparison ({d.allCandidates.length} models)
                                            </summary>
                                            <div style={{ overflowX: 'auto' }}>
                                                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '12px' }}>
                                                    <thead>
                                                        <tr style={{ background: '#f3f4f6' }}>
                                                            {['K', 'Cov', 'BIC', 'AIC', 'Entropy', 'Rank'].map(h => (
                                                                <th key={h} style={{ padding: '4px 8px', textAlign: 'left', border: '1px solid #e5e7eb', fontWeight: 600 }}>{h}</th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...d.allCandidates]
                                                            .sort((a, b) => a.compositeRank - b.compositeRank)
                                                            .map((c, i) => {
                                                                const isBest = c.compositeRank === bestCandidateRank
                                                                return (
                                                                    <tr key={i} style={{ background: isBest ? '#f0fdf4' : undefined }}>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb' }}>{c.k}</td>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb' }}>{c.covType}</td>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb' }}>{c.bic.toFixed(1)}</td>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb' }}>{c.aic.toFixed(1)}</td>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb' }}>{c.entropy.toFixed(3)}</td>
                                                                        <td style={{ padding: '3px 8px', border: '1px solid #e5e7eb', fontWeight: isBest ? 700 : 400, color: isBest ? '#065F46' : undefined }}>
                                                                            {c.compositeRank.toFixed(2)}{isBest ? ' ← BEST' : ''}
                                                                        </td>
                                                                    </tr>
                                                                )
                                                            })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </details>
                                    )}

                                    {/* Students by cluster */}
                                    {!membersLoading && clusterIndexes.length > 0 && (
                                        <details style={{ marginTop: '8px' }}>
                                            <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: '6px', fontSize: '12px', color: '#6b7280' }}>
                                                👥 Students by cluster · {totalMembers} student{totalMembers !== 1 ? 's' : ''}
                                            </summary>

                                            {clusterIndexes.map(clusterIdx => {
                                                const group = conceptGrouped[clusterIdx] ?? []
                                                if (group.length === 0) return null
                                                const dot = tierDot(clusterIdx, totalClusters)
                                                const p50 = group[0].clusterP50

                                                return (
                                                    <div key={clusterIdx} style={{ marginBottom: '14px' }}>
                                                        {/* Cluster sub-header */}
                                                        <div style={{
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            color: '#374151',
                                                            marginBottom: '6px',
                                                            paddingTop: '6px'
                                                        }}>
                                                            {dot} {group[0].clusterLabel}
                                                            &nbsp;·&nbsp; {group.length} student{group.length !== 1 ? 's' : ''}
                                                            {p50 != null && <span style={{ fontWeight: 400, color: '#6b7280' }}>&nbsp;·&nbsp; P50: {p50.toFixed(1)}</span>}
                                                        </div>

                                                        {/* Student table */}
                                                        <div style={{ overflowX: 'auto' }}>
                                                            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '11px' }}>
                                                                <thead>
                                                                    <tr style={{ background: '#f3f4f6' }}>
                                                                        <th style={thStyle}>Name</th>
                                                                        <th style={thStyle}>Score</th>
                                                                        <th style={thStyle}>%ile</th>
                                                                        {dimCols.map(dim => (
                                                                            <th key={dim.key} style={thStyle}>{dim.label}</th>
                                                                        ))}
                                                                        <th style={thStyle}>Trend</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {group.map(m => (
                                                                        <tr key={m.userId}>
                                                                            <td style={tdStyle}>
                                                                                <span style={{ fontWeight: 500 }}>{m.name}</span>
                                                                                <br />
                                                                                <span style={{ color: '#9ca3af', fontSize: '10px' }}>{m.email.split('@')[0]}</span>
                                                                            </td>
                                                                            <td style={{ ...tdStyle, color: scoreColor(m.score), fontWeight: 600 }}>
                                                                                {m.score != null ? m.score.toFixed(1) : '—'}
                                                                            </td>
                                                                            <td style={tdStyle}>
                                                                                {ordinal(m.percentilePosition)}
                                                                            </td>
                                                                            {dimCols.map(dim => {
                                                                                const dimScore = m.breakdown?.[dim.key]?.score
                                                                                return (
                                                                                    <td key={dim.key} style={{ ...tdStyle, color: scoreColor(dimScore) }}>
                                                                                        {dimScore != null ? dimScore.toFixed(0) : '—'}
                                                                                    </td>
                                                                                )
                                                                            })}
                                                                            <td style={{ ...tdStyle, color: '#6b7280' }}>
                                                                                {trendIcon(m.trend)}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </details>
                                    )}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

const thStyle: React.CSSProperties = {
    padding: '4px 8px',
    textAlign: 'left',
    border: '1px solid #e5e7eb',
    fontWeight: 600,
    whiteSpace: 'nowrap'
}

const tdStyle: React.CSSProperties = {
    padding: '4px 8px',
    border: '1px solid #e5e7eb',
    verticalAlign: 'top'
}

export default AdminClusterDiagnosticsPanel

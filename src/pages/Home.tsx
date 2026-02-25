import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Surveys from '../components/Surveys'
import ScoreGauge from '../components/ScoreGauge'
import SleepSlider from '../components/SleepSlider'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { load } from '../redux/surveys'
import { loadAnnotations, Annotation } from '../redux/results'
import './Home.css'

// Concepts that are inverted (high score = bad)
const INVERTED_CONCEPTS = ['anxiety']

// API base URL
const API_BASE = '/api'

interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    avg7d: number | null
    yesterdayScore?: number | null
    clusterLabel?: string | null
    dialMin?: number
    dialCenter?: number
    dialMax?: number
    computedAt?: string | null
    coldStart?: boolean
    breakdown?: Record<string, {
        score: number
        weight: number
        label?: string
        category?: string
        categoryLabel?: string
        zScore?: number
    }>
}

// ... (rest of file until render)

interface StudentInfo { id: string; name: string; email: string }

const Home = () => {
    const user = useReduxSelector(state => state.auth.user)
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const surveysStatus = useReduxSelector(state => state.surveys.status)
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const isAdmin = user?.role === 'admin' || user?.email === 'admin@example.com'
    const title = isAdmin ? 'My Surveys' : 'Available Surveys'

    const [annotations7d, setAnnotations7d] = useState<Annotation[]>([])
    const [loading, setLoading] = useState(false)
    const [hasSufficientData7d, setHasSufficientData7d] = useState(false)

    // Concept scores state
    const [conceptScores, setConceptScores] = useState<ConceptScore[]>([])
    const [scoresLoading, setScoresLoading] = useState(false)
    const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null)

    // Admin student viewer state
    const [students, setStudents] = useState<StudentInfo[]>([])
    const [studentsLoading, setStudentsLoading] = useState(false)
    const [selectedStudentId, setSelectedStudentId] = useState<string>('')
    const selectedStudent = students.find(s => s.id === selectedStudentId) || null

    // Submission reminder state (only for non-admin students)
    const [missingSleepLog, setMissingSleepLog] = useState(false)
    const [missingScreenTime, setMissingScreenTime] = useState(false)
    const [reminderDismissed, setReminderDismissed] = useState(false)

    // Load surveys if not already loaded
    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [surveysStatus, dispatch, surveys.length])

    // Load student list for admin
    useEffect(() => {
        if (isAdmin) {
            setStudentsLoading(true)
            fetch(`${API_BASE}/admin/students`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.students) {
                        setStudents(data.students)
                    }
                    setStudentsLoading(false)
                })
                .catch(() => setStudentsLoading(false))
        }
    }, [isAdmin])

    // When admin selects a student, load their scores + annotations
    useEffect(() => {
        if (isAdmin && selectedStudentId) {
            // Load scores
            setScoresLoading(true)
            fetch(`${API_BASE}/admin/students/${selectedStudentId}/scores`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.scores) setConceptScores(data.scores)
                    setScoresLoading(false)
                })
                .catch(() => setScoresLoading(false))

            // Load annotations
            setLoading(true)
            fetch(`${API_BASE}/admin/students/${selectedStudentId}/annotations`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    const allAnnotations = data.annotations || []
                    const week = allAnnotations.filter((a: any) => a.timeWindow === '7d')
                    setAnnotations7d(week)
                    setHasSufficientData7d(week.some((a: any) => a.hasSufficientData))
                    setLoading(false)
                })
                .catch(() => setLoading(false))
        } else if (isAdmin && !selectedStudentId) {
            // Clear data when no student selected
            setConceptScores([])
            setAnnotations7d([])
        }
    }, [isAdmin, selectedStudentId])

    // Load annotations for students
    useEffect(() => {
        if (!isAdmin && user) {
            setLoading(true)

            dispatch(loadAnnotations())
                .then((result: any) => {
                    if (result.type === 'results/loadAnnotations/fulfilled') {
                        const allAnnotations = result.payload.annotations || []

                        // Split by time window
                        const week = allAnnotations.filter((a: Annotation) => a.timeWindow === '7d')

                        setAnnotations7d(week)

                        // Check if any annotation has sufficient data
                        setHasSufficientData7d(week.some((a: Annotation) => a.hasSufficientData))
                    }
                    setLoading(false)
                })
                .catch(() => {
                    setLoading(false)
                })
        }
    }, [isAdmin, user, dispatch])

    // Load concept scores for students
    useEffect(() => {
        if (!isAdmin && user) {
            setScoresLoading(true)
            fetch(`${API_BASE}/scores`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    if (data.scores) {
                        setConceptScores(data.scores)
                    }
                    setScoresLoading(false)
                })
                .catch(() => {
                    setScoresLoading(false)
                })
        }
    }, [isAdmin, user])

    // Check whether today's sleep log and screen time have been submitted (students only)
    useEffect(() => {
        if (isAdmin || !user) return
        Promise.all([
            fetch(`${API_BASE}/sleep/today`, { credentials: 'include' }).then(r => r.json()),
            fetch(`${API_BASE}/screen-time/today`, { credentials: 'include' }).then(r => r.json())
        ]).then(([sleepData, screenData]) => {
            setMissingSleepLog(!sleepData.entry)
            setMissingScreenTime(!screenData.entry)
        }).catch(() => { /* ignore network errors silently */ })
    }, [isAdmin, user])

    // Add class to parent main element for mood layout
    useEffect(() => {
        const mainElement = document.querySelector('.sjs-app__content')
        if (mainElement) {
            mainElement.classList.add('mood-content-override')
        }
        return () => {
            if (mainElement) {
                mainElement.classList.remove('mood-content-override')
            }
        }
    }, [isAdmin])

    // Helper to format aspect name
    const formatAspectName = (key: string) => {
        return key.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    // Category colors (all green shades)
    const CATEGORY_COLORS: Record<string, string> = {
        requires_improvement: '#86efac',
        good: '#22c55e',
        very_good: '#15803d'
    }

    // Domain descriptions: what each metric measures & whether more/less is better
    const DOMAIN_DESCRIPTIONS: Record<string, string> = {
        // LMS
        volume: 'Total active study minutes on the LMS. More is better.',
        consistency: 'Number of days you were active on the LMS. More is better.',
        action_mix: 'Ratio of active learning (quizzes, assignments) vs passive (reading, watching). Higher active % is better.',
        session_quality: 'Average duration of each study session. Longer focused sessions are better.',
        // Sleep
        duration: 'Average total sleep time per night. More sleep is better.',
        continuity: 'Number of times you woke up during the night. Fewer awakenings is better.',
        timing: 'How consistent your bedtime is each night. Lower variation is better.',
        // Screen Time
        distribution: 'Length of your longest continuous screen session. Shorter is better.',
        pre_sleep: 'Screen time before going to sleep. Less pre-sleep screen time is better.',
        // SRL
        goal_setting: 'How well you set clear learning goals before studying. Higher is better.',
        planning: 'How effectively you plan your study time and strategies. Higher is better.',
        task_strategies: 'Your use of specific strategies to complete tasks. Higher is better.',
        self_observation: 'How well you monitor your own learning progress. Higher is better.',
        self_judgement: 'How accurately you evaluate your own performance. Higher is better.',
        self_reaction: 'How constructively you respond to your own performance. Higher is better.',
        self_efficacy: 'Your confidence in your ability to learn and succeed. Higher is better.',
        intrinsic_motivation: 'Your internal drive and curiosity for learning. Higher is better.',
        extrinsic_motivation: 'Your motivation from grades and rewards. Higher is better.',
        elaboration: 'How deeply you process and connect new information. Higher is better.',
        critical_thinking: 'Your ability to question and analyze what you learn. Higher is better.',
        metacognitive_regulation: 'How well you adjust your learning strategies as needed. Higher is better.',
        anxiety: 'Your level of test and study anxiety. Lower anxiety is better.',
        effort_regulation: 'Your ability to persist through difficult or boring tasks. Higher is better.'
    }

    /**
     * Format computedAt timestamp as a human-readable "last updated" string.
     * Returns the string and whether it is considered stale (> 24h).
     */
    const formatLastUpdated = (computedAt?: string | null): { text: string; stale: boolean } => {
        if (!computedAt) return { text: '', stale: false }
        const diff = Date.now() - new Date(computedAt).getTime()
        const hours = Math.floor(diff / (1000 * 60 * 60))
        const days = Math.floor(hours / 24)
        if (hours < 1) return { text: 'Updated just now', stale: false }
        if (hours < 24) return { text: `Updated ${hours}h ago`, stale: false }
        if (days === 1) return { text: 'Updated yesterday', stale: true }
        return { text: `Updated ${days} days ago`, stale: true }
    }

    /**
     * Get self-comparison badge: compare today's concept score to yesterday's
     */
    const getSelfComparisonBadge = (todayScore: number, yesterdayScore?: number | null): { label: string, color: string } => {
        if (yesterdayScore == null) return { label: 'New', color: '#6b7280' }
        const diff = todayScore - yesterdayScore
        if (diff > 2) return { label: 'Improving', color: '#15803d' }
        if (diff < -2) return { label: 'Declining', color: '#dc2626' }
        return { label: 'Unchanged', color: '#6b7280' }
    }

    /**
     * Get a textual description of where the Today arrow sits on the dial
     */
    const getDialPositionLabel = (todayScore: number, dialMin: number, dialCenter: number, dialMax: number): string => {
        const range = dialMax - dialMin
        if (range <= 0) return 'Score calculated'
        const position = (todayScore - dialMin) / range // 0 to 1
        if (position >= 0.85) return 'Near the top of your peer group'
        if (position >= 0.6) return 'Above the median of your peer group'
        if (position >= 0.4) return 'Around the median of your peer group'
        if (position >= 0.15) return 'Below the median of your peer group'
        return 'In the lower range of your peer group'
    }

    // Toggle expansion
    const handleGaugeClick = (conceptId: string) => {
        setExpandedConceptId(prev => prev === conceptId ? null : conceptId)
    }

    // Get first survey for "Fill Survey" button
    const firstSurvey = surveys.length > 0 ? surveys[0] : null

    const handleCardClick = (period: '7days') => {
        if (firstSurvey) {
            navigate(`/mood-history/${firstSurvey.id}?period=${period}`)
        }
    }

    // Helper function to convert hex to RGB
    const hexToRgb = (hex: string): [number, number, number] => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
        return result
            ? [
                parseInt(result[1], 16),
                parseInt(result[2], 16),
                parseInt(result[3], 16)
            ]
            : [0, 0, 0]
    }

    // Helper function to convert RGB to hex
    const rgbToHex = (r: number, g: number, b: number): string => {
        return '#' + [r, g, b].map(x => {
            const hex = Math.round(x).toString(16)
            return hex.length === 1 ? '0' + hex : hex
        }).join('')
    }

    // Interpolate between two colors
    const interpolateColor = (color1: string, color2: string, factor: number): string => {
        const rgb1 = hexToRgb(color1)
        const rgb2 = hexToRgb(color2)
        const r = rgb1[0] + (rgb2[0] - rgb1[0]) * factor
        const g = rgb1[1] + (rgb2[1] - rgb1[1]) * factor
        const b = rgb1[2] + (rgb2[2] - rgb1[2]) * factor
        return rgbToHex(r, g, b)
    }

    const getConstructColor = (average: number | null, isInverted: boolean = false): string => {
        if (average === null || average === 0) {
            return '#F9FAFB' // Default background when no data
        }

        const lowColor = '#fdaeae'   // Red
        const midColor = '#FFFF99'   // Yellow
        const highColor = '#99FF99'  // Green
        const midpoint = 3

        // Assume rating scale is 1-5 (adjust if needed)
        const minValue = 1
        const maxValue = 5

        // Clamp average to valid range
        const clampedAverage = Math.max(minValue, Math.min(maxValue, average))

        // For inverted concepts (like anxiety), flip the color scale
        if (isInverted) {
            // High score = red (bad), Low score = green (good)
            if (clampedAverage <= midpoint) {
                const factor = (clampedAverage - minValue) / (midpoint - minValue)
                return interpolateColor(highColor, midColor, factor)  // green to yellow
            } else {
                const factor = (clampedAverage - midpoint) / (maxValue - midpoint)
                return interpolateColor(midColor, lowColor, factor)   // yellow to red
            }
        }

        // Normal: Low score = red, High score = green
        if (clampedAverage <= midpoint) {
            const factor = (clampedAverage - minValue) / (midpoint - minValue)
            return interpolateColor(lowColor, midColor, factor)
        } else {
            const factor = (clampedAverage - midpoint) / (maxValue - midpoint)
            return interpolateColor(midColor, highColor, factor)
        }
    }

    // Format construct name: remove underscores, capitalize first letter
    const formatConstructName = (name: string) => {
        return name
            .replace(/_/g, ' ')
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ')
    }

    const renderAnnotations = (annotations: Annotation[]) => {
        if (annotations.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }

        // Filter out annotations with no data
        const annotationsWithData = annotations.filter(a =>
            a.avgScore > 0 || a.minScore > 0 || a.maxScore > 0
        )

        if (annotationsWithData.length === 0) {
            return <div className='mood-no-data'>No survey responses yet</div>
        }

        return (
            <div className='mood-constructs-grid'>
                {annotations.map((annotation) => {
                    const isInverted = annotation.isInverted || INVERTED_CONCEPTS.includes(annotation.conceptKey)
                    const backgroundColor = getConstructColor(annotation.avgScore, isInverted)
                    const formattedName = formatConstructName(annotation.conceptKey)
                    return (
                        <div
                            key={annotation.conceptKey}
                            className='mood-construct-item'
                            style={{ backgroundColor }}
                        >
                            <div className='mood-construct-name'>{formattedName}</div>
                            <div className='mood-construct-stats'>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Avg:</span>
                                    <span className='mood-stat-value'>{annotation.avgScore > 0 ? annotation.avgScore.toFixed(1) : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Min:</span>
                                    <span className='mood-stat-value'>{annotation.minScore > 0 ? annotation.minScore : 'N/A'}</span>
                                </div>
                                <div className='mood-stat'>
                                    <span className='mood-stat-label'>Max:</span>
                                    <span className='mood-stat-value'>{annotation.maxScore > 0 ? annotation.maxScore : 'N/A'}</span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        )
    }

    // For admin users, show student selector + student dashboard
    if (isAdmin) {
        return (
            <div className='mood-home-wrapper'>
                <div className='mood-home-container'>
                    {/* Student Selector Card */}
                    <div className='admin-student-selector'>
                        <div className='admin-selector-header'>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                            <h2>View Student Dashboard</h2>
                        </div>
                        <p className='admin-selector-description'>Select a student to view their performance dashboard</p>
                        <select
                            className='admin-student-select'
                            value={selectedStudentId}
                            onChange={e => { setSelectedStudentId(e.target.value); setExpandedConceptId(null) }}
                        >
                            <option value=''>— Select a student —</option>
                            {studentsLoading ? (
                                <option disabled>Loading...</option>
                            ) : (
                                students.map(s => (
                                    <option key={s.id} value={s.id}>{s.name} ({s.email})</option>
                                ))
                            )}
                        </select>
                    </div>

                    {/* Student dashboard – shown when a student is selected */}
                    {selectedStudent && (
                        <>
                            <div className='admin-viewing-banner'>
                                Viewing dashboard for <strong>{selectedStudent.name}</strong>
                            </div>

                            {/* Score Gauges Section */}
                            <div className='mood-card'>
                                <div className='mood-card-header-row'>
                                    <div>
                                        <h2 className='mood-card-title'>Performance Scores</h2>
                                        <p className='mood-card-description'>
                                            Click on a gauge to see a detailed breakdown
                                        </p>
                                    </div>
                                    <div className="gauge-info-wrapper">
                                        <span className="gauge-info-icon">ℹ</span>
                                        <div className="gauge-info-tooltip">
                                            Scores are calculated by comparing the student with peers who have similar behavioral patterns. The dial range (P5–P95) shows where most students in their group fall.
                                        </div>
                                    </div>
                                </div>
                                <div className='mood-card-content'>
                                    {scoresLoading ? (
                                        <div className='mood-loading'>Loading scores...</div>
                                    ) : conceptScores.length === 0 ? (
                                        <div className='mood-no-data'>No scores available for this student.</div>
                                    ) : (
                                        <div className='score-gauges-grid'>
                                            {conceptScores.map(score => (
                                                <div
                                                    className={`score-gauge-wrapper ${expandedConceptId === score.conceptId ? 'expanded' : ''}`}
                                                    onClick={() => !score.coldStart && handleGaugeClick(score.conceptId)}
                                                    key={score.conceptId}
                                                >
                                                    {score.coldStart ? (
                                                        <div className='cold-start-placeholder'>
                                                            <div className='cold-start-icon'>⏳</div>
                                                            <div className='cold-start-label'>{score.conceptName}</div>
                                                            <div className='cold-start-message'>Building your profile — check back once more students have joined.</div>
                                                        </div>
                                                    ) : (
                                                    <>
                                                    <ScoreGauge
                                                        score={score.score!}
                                                        label={score.conceptName}
                                                        trend={score.trend ?? undefined}
                                                        size="medium"
                                                        yesterdayScore={score.yesterdayScore}
                                                        clusterLabel={score.clusterLabel}
                                                        dialMin={score.dialMin}
                                                        dialCenter={score.dialCenter}
                                                        dialMax={score.dialMax}
                                                    />
                                                    {(() => { const lu = formatLastUpdated(score.computedAt); return lu.text ? <div className={`gauge-last-updated${lu.stale ? ' stale' : ''}`}>{lu.text}</div> : null })()}
                                                    </>
                                                    )}
                                                    {expandedConceptId === score.conceptId && score.breakdown && (() => {
                                                        const badge = getSelfComparisonBadge(score.score!, score.yesterdayScore)
                                                        const dialLabel = getDialPositionLabel(
                                                            score.score!,
                                                            score.dialMin ?? 0,
                                                            score.dialCenter ?? 50,
                                                            score.dialMax ?? 100
                                                        )
                                                        return (
                                                            <div className='score-details-list'>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                                                                    <div className='score-details-title' style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>Detailed Breakdown</div>
                                                                    <div style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic', textAlign: 'right' }}>vs. yesterday</div>
                                                                </div>
                                                                <ul>
                                                                    {Object.entries(score.breakdown).map(([key, data]) => (
                                                                        <li key={key} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                                                <span className='detail-label' style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                                    {formatAspectName(key)}
                                                                                    {DOMAIN_DESCRIPTIONS[key] && (
                                                                                        <span className='domain-info-wrapper'>
                                                                                            <span className='domain-info-icon'>ℹ</span>
                                                                                            <span className='domain-info-tooltip'>{DOMAIN_DESCRIPTIONS[key]}</span>
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                                <span
                                                                                    className='detail-score-tag'
                                                                                    style={{
                                                                                        backgroundColor: `${badge.color}20`,
                                                                                        color: badge.color
                                                                                    }}
                                                                                >
                                                                                    {badge.label}
                                                                                </span>
                                                                            </div>
                                                                            <div className='detail-text' style={{
                                                                                fontSize: '12px',
                                                                                color: '#6b7280',
                                                                                marginTop: '4px',
                                                                                fontStyle: 'italic',
                                                                                width: '100%'
                                                                            }}>
                                                                                {dialLabel}
                                                                            </div>
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Mood Cards – 7-day annotations */}
                            <div className='mood-cards-container'>
                                <div className='mood-card'>
                                    <h2 className='mood-card-title'>Mood over the last 7 days</h2>
                                    <p className='mood-card-description'>
                                        Mood statistics for {selectedStudent.name}
                                    </p>
                                    <div className='mood-card-content'>
                                        {loading ? (
                                            <div className='mood-loading'>Loading...</div>
                                        ) : (
                                            renderAnnotations(annotations7d)
                                        )}
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Surveys list (always visible for admin) */}
                    <div className='mood-card' style={{ marginTop: '24px' }}>
                        <h2 className='mood-card-title'>{title}</h2>
                        <div className='mood-card-content'>
                            <Surveys />
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // Calculate total responses for display
    const totalResponses7d = annotations7d.length > 0 ? annotations7d[0].responseCount : 0
    // Get distinct day count for 7-day period
    const distinctDayCount7d = annotations7d.length > 0 ? annotations7d[0].distinctDayCount : 0

    // Build description for 7-day card
    const get7dDescription = () => {
        if (totalResponses7d === 0) {
            return 'Your mood statistics over the past week'
        }
        let desc = `Your mood statistics over the past week, based on ${totalResponses7d} ${totalResponses7d === 1 ? 'response' : 'responses'}`
        if (distinctDayCount7d && distinctDayCount7d > 0) {
            desc += `, from ${distinctDayCount7d} ${distinctDayCount7d === 1 ? 'day' : 'days'}`
        }
        return desc
    }

    return (
        <div className='mood-home-wrapper'>
            <div className='mood-home-container'>
                {/* Submission reminder banner — top of page */}
                {!reminderDismissed && (missingSleepLog || missingScreenTime) && (
                    <div className='reminder-banner'>
                        <div className='reminder-content'>
                            <span className='reminder-icon'>⚠</span>
                            <span className='reminder-text'>You haven't logged today yet:</span>
                            {missingSleepLog && (
                                <button
                                    className='reminder-link'
                                    onClick={() => document.getElementById('sleep-log-section')?.scrollIntoView({ behavior: 'smooth' })}
                                >Sleep log →</button>
                            )}
                            {missingScreenTime && (
                                <Link to="/screen-time" className='reminder-link'>Screen time →</Link>
                            )}
                        </div>
                        <button
                            className='reminder-dismiss'
                            onClick={() => setReminderDismissed(true)}
                            aria-label='Dismiss reminder'
                        >✕</button>
                    </div>
                )}

                {/* Score Gauges Section */}
                <div className='mood-card'>
                    <div className='mood-card-header-row'>
                        <div>
                            <h2 className='mood-card-title'>Your Performance Scores</h2>
                            <p className='mood-card-description'>
                                Click on a gauge to see a detailed breakdown of your habits
                            </p>
                        </div>
                        <div className="gauge-info-wrapper">
                            <span className="gauge-info-icon">ℹ</span>
                            <div className="gauge-info-tooltip">
                                Your score is calculated by comparing you with students who have similar behavioral patterns. The dial range (P5–P95) shows where most students in your group fall. The two needles show your progress from yesterday to today.
                            </div>
                        </div>
                    </div>
                    <div className='mood-card-content'>
                        {scoresLoading ? (
                            <div className='mood-loading'>Loading scores...</div>
                        ) : conceptScores.length === 0 ? (
                            <div className='mood-no-data'>No scores available yet. Complete your profile and surveys to see your performance.</div>
                        ) : (
                            <div className='score-gauges-grid'>
                                {conceptScores.map(score => (
                                    <div
                                        className={`score-gauge-wrapper ${expandedConceptId === score.conceptId ? 'expanded' : ''}`}
                                        onClick={() => !score.coldStart && handleGaugeClick(score.conceptId)}
                                        key={score.conceptId}
                                    >
                                        {score.coldStart ? (
                                            <div className='cold-start-placeholder'>
                                                <div className='cold-start-icon'>⏳</div>
                                                <div className='cold-start-label'>{score.conceptName}</div>
                                                <div className='cold-start-message'>Building your profile — check back once more students have joined.</div>
                                            </div>
                                        ) : (
                                        <>
                                        <ScoreGauge
                                            score={score.score!}
                                            label={score.conceptName}
                                            trend={score.trend ?? undefined}
                                            size="medium"
                                            yesterdayScore={score.yesterdayScore}
                                            clusterLabel={score.clusterLabel}
                                            dialMin={score.dialMin}
                                            dialCenter={score.dialCenter}
                                            dialMax={score.dialMax}
                                        />
                                        {(() => { const lu = formatLastUpdated(score.computedAt); return lu.text ? <div className={`gauge-last-updated${lu.stale ? ' stale' : ''}`}>{lu.text}</div> : null })()}
                                        </>
                                        )}
                                        {expandedConceptId === score.conceptId && score.breakdown && (() => {
                                            const badge = getSelfComparisonBadge(score.score!, score.yesterdayScore)
                                            const dialLabel = getDialPositionLabel(
                                                score.score!,
                                                score.dialMin ?? 0,
                                                score.dialCenter ?? 50,
                                                score.dialMax ?? 100
                                            )
                                            return (
                                                <div className='score-details-list'>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid #e5e7eb', paddingBottom: '4px', marginBottom: '8px' }}>
                                                        <div className='score-details-title' style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>Detailed Breakdown</div>
                                                        <div style={{ fontSize: '11px', color: '#9ca3af', fontStyle: 'italic', textAlign: 'right' }}>vs. yesterday</div>
                                                    </div>
                                                    <ul>
                                                        {Object.entries(score.breakdown).map(([key, data]) => (
                                                            <li key={key} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                                    <span className='detail-label' style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                                        {formatAspectName(key)}
                                                                        {DOMAIN_DESCRIPTIONS[key] && (
                                                                            <span className='domain-info-wrapper'>
                                                                                <span className='domain-info-icon'>ℹ</span>
                                                                                <span className='domain-info-tooltip'>{DOMAIN_DESCRIPTIONS[key]}</span>
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <span
                                                                        className='detail-score-tag'
                                                                        style={{
                                                                            backgroundColor: `${badge.color}20`,
                                                                            color: badge.color
                                                                        }}
                                                                    >
                                                                        {badge.label}
                                                                    </span>
                                                                </div>
                                                                <div className='detail-text' style={{
                                                                    fontSize: '12px',
                                                                    color: '#6b7280',
                                                                    marginTop: '4px',
                                                                    fontStyle: 'italic',
                                                                    width: '100%'
                                                                }}>
                                                                    {dialLabel}
                                                                </div>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )
                                        })()}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Quick Action Cards */}
                <div className='quick-actions-row'>
                    {firstSurvey && (
                        <Link to={`/run/${firstSurvey.id}`} className='quick-action-card'>
                            <span className='quick-action-icon'>📝</span>
                            <div className='quick-action-text'>
                                <div className='quick-action-title'>Self-Regulated Learning Survey</div>
                                <div className='quick-action-desc'>Reflect on your study strategies</div>
                            </div>
                            <span className='quick-action-arrow'>→</span>
                        </Link>
                    )}
                    <Link to="/screen-time" className='quick-action-card'>
                        <span className='quick-action-icon'>📱</span>
                        <div className='quick-action-text'>
                            <div className='quick-action-title'>Daily Screen Time</div>
                            <div className='quick-action-desc'>Log your screen usage from yesterday</div>
                        </div>
                        <span className='quick-action-arrow'>→</span>
                    </Link>
                </div>

                {/* Sleep Log */}
                <div id='sleep-log-section'>
                    <SleepSlider onSaved={() => setMissingSleepLog(false)} />
                </div>

                <div className='mood-cards-container'>
                    <div
                        className='mood-card mood-card-clickable'
                        onClick={() => handleCardClick('7days')}
                    >
                        <h2 className='mood-card-title'>Mood over the last 7 days</h2>
                        <p className='mood-card-description'>
                            {get7dDescription()}
                        </p>
                        <div className='mood-card-content'>
                            {loading ? (
                                <div className='mood-loading'>Loading...</div>
                            ) : (
                                renderAnnotations(annotations7d)
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Home;
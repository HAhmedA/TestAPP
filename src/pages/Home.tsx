import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Surveys from '../components/Surveys'
import ScoreGauge from '../components/ScoreGauge'
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
    score: number
    trend: string
    avg7d: number | null
    breakdown?: Record<string, { score: number, weight: number, label?: string }>
}

// ... (rest of file until render)


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

    // Load surveys if not already loaded
    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [surveysStatus, dispatch, surveys.length])

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

    // Add class to parent main element for student mood layout
    useEffect(() => {
        if (!isAdmin) {
            const mainElement = document.querySelector('.sjs-app__content')
            if (mainElement) {
                mainElement.classList.add('mood-content-override')
            }
            return () => {
                if (mainElement) {
                    mainElement.classList.remove('mood-content-override')
                }
            }
        }
    }, [isAdmin])

    // Helper to format aspect name
    const formatAspectName = (key: string) => {
        return key.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ')
    }

    // Helper to get score logic (excellent/poor) - duplicated from component for now
    const getScoreLabel = (score: number) => {
        if (score >= 80) return 'Excellent'
        if (score >= 60) return 'Good'
        if (score >= 40) return 'Fair'
        if (score >= 20) return 'Poor'
        return 'Very Poor'
    }

    // Helper to get color based on score
    const getScoreColor = (score: number): string => {
        if (score >= 80) return '#22c55e' // Green
        if (score >= 60) return '#84cc16' // Light green
        if (score >= 40) return '#fbbf24' // Yellow
        if (score >= 20) return '#f97316' // Orange
        return '#ef4444' // Red
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

    // For admin users, show the surveys list
    if (isAdmin) {
        return (
            <div className='sjs-client-app__content--surveys-list'>
                <h1>{title}</h1>
                <Surveys />
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
                {/* Welcome Card */}
                <div className='welcome-card'>
                    <div className='welcome-card-content'>
                        <h2 className='welcome-card-title'>Welcome, {user?.name || 'Student'}!</h2>
                        <p className='welcome-card-description'>Update your status and answer a new surveys</p>
                        {firstSurvey && (
                            <Link to={`/run/${firstSurvey.id}`} className='fill-survey-button'>
                                Fill Survey
                            </Link>
                        )}
                    </div>
                    <img
                        src="/assets/student-illustration.png"
                        alt="Student with checklist"
                        className='welcome-card-illustration'
                    />
                </div>

                {/* Score Gauges Section */}
                <div className='mood-card'>
                    <h2 className='mood-card-title'>Your Performance Scores</h2>
                    <p className='mood-card-description'>
                        Click on a gauge to see a detailed breakdown of your habits
                    </p>
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
                                        onClick={() => handleGaugeClick(score.conceptId)}
                                        key={score.conceptId}
                                    >
                                        <ScoreGauge
                                            score={score.score}
                                            label={score.conceptName}
                                            trend={score.trend}
                                            size="medium"
                                        />
                                        {expandedConceptId === score.conceptId && score.breakdown && (
                                            <div className='score-details-list'>
                                                <div className='score-details-title'>Detailed Breakdown</div>
                                                <ul>
                                                    {Object.entries(score.breakdown).map(([key, data]) => {
                                                        const label = getScoreLabel(data.score)
                                                        const color = getScoreColor(data.score)
                                                        return (
                                                            <li key={key} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                                                    <span className='detail-label'>{formatAspectName(key)}</span>
                                                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                                                        <span className='detail-value'>{data.score.toFixed(0)}/100</span>
                                                                        <span
                                                                            className='detail-score-tag'
                                                                            style={{
                                                                                backgroundColor: `${color}20`,
                                                                                color: color
                                                                            }}
                                                                        >
                                                                            {label}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                {data.label && (
                                                                    <div className='detail-text' style={{
                                                                        fontSize: '12px',
                                                                        color: '#6b7280',
                                                                        marginTop: '4px',
                                                                        fontStyle: 'italic',
                                                                        width: '100%'
                                                                    }}>
                                                                        {data.label}
                                                                    </div>
                                                                )}
                                                            </li>
                                                        )
                                                    })}
                                                </ul>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
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
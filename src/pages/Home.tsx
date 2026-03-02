import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Surveys from '../components/Surveys'
import SleepSlider from '../components/SleepSlider'
import AdminStudentViewer from '../components/AdminStudentViewer'
import AdminClusterDiagnosticsPanel from '../components/AdminClusterDiagnosticsPanel'
import ScoreBoard from '../components/ScoreBoard'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { load } from '../redux/surveys'
import { api } from '../api/client'
import { getScores } from '../api/scores'
import { getTodaySleep } from '../api/sleep'
import { getTodayScreenTime } from '../api/screenTime'
import { getTodaySRL } from '../api/results'
import './Home.css'

interface ConceptScore {
    conceptId: string
    conceptName: string
    score: number | null
    trend: string | null
    yesterdayScore?: number | null
    clusterLabel?: string | null
    clusterIndex?: number | null
    totalClusters?: number | null
    percentilePosition?: number | null
    clusterUserCount?: number | null
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

interface StudentInfo { id: string; name: string; email: string }

const Home = () => {
    const user = useReduxSelector(state => state.auth.user)
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const surveysStatus = useReduxSelector(state => state.surveys.status)
    const dispatch = useReduxDispatch()
    const isAdmin = user?.role === 'admin'
    const title = isAdmin ? 'My Surveys' : 'Available Surveys'

    // Concept scores state
    const [conceptScores, setConceptScores] = useState<ConceptScore[]>([])
    const [scoresLoading, setScoresLoading] = useState(false)

    // Admin student viewer state
    const [selectedStudentId, setSelectedStudentId] = useState<string>('')
    const [selectedStudentName, setSelectedStudentName] = useState<string>('')

    // Submission reminder state (only for non-admin students)
    const [missingSleepLog, setMissingSleepLog] = useState(false)
    const [missingScreenTime, setMissingScreenTime] = useState(false)
    const [missingSRLSurvey, setMissingSRLSurvey] = useState(false)
    const [reminderDismissed, setReminderDismissed] = useState(false)

    // Load surveys if not already loaded
    useEffect(() => {
        if (surveysStatus === 'idle' && surveys.length === 0) {
            dispatch(load())
        }
    }, [surveysStatus, dispatch, surveys.length])

    // When admin selects a student, load their scores
    useEffect(() => {
        if (isAdmin && selectedStudentId) {
            setScoresLoading(true)
            api.get<{ scores: ConceptScore[] }>(`/admin/students/${selectedStudentId}/scores`)
                .then(data => {
                    if (data.scores) setConceptScores(data.scores)
                    setScoresLoading(false)
                })
                .catch(() => setScoresLoading(false))
        } else if (isAdmin && !selectedStudentId) {
            setConceptScores([])
        }
    }, [isAdmin, selectedStudentId])

    // Load concept scores for students
    useEffect(() => {
        if (!isAdmin && user) {
            setScoresLoading(true)
            getScores()
                .then(scores => {
                    setConceptScores(scores)
                    setScoresLoading(false)

                    // If no scores yet (e.g. server still warming up), retry once after 5s
                    if (!scores || scores.length === 0) {
                        setTimeout(() => getScores().then(d => setConceptScores(d)), 5000)
                    }
                })
                .catch(() => {
                    setScoresLoading(false)
                })
        }
    }, [isAdmin, user])

    // Check whether today's sleep log, screen time, and SRL survey have been submitted (students only).
    // Uses allSettled so one failing call doesn't silently block the others.
    useEffect(() => {
        if (isAdmin || !user) return
        Promise.allSettled([
            getTodaySleep(),
            getTodayScreenTime(),
            getTodaySRL()
        ]).then(([sleepResult, screenResult, srlResult]) => {
            if (sleepResult.status === 'fulfilled') setMissingSleepLog(!sleepResult.value)
            if (screenResult.status === 'fulfilled') setMissingScreenTime(!screenResult.value)
            if (srlResult.status === 'fulfilled') setMissingSRLSurvey(!srlResult.value)
        })
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

    // For admin users, show student selector + student dashboard
    if (isAdmin) {
        return (
            <div className='mood-home-wrapper'>
                <div className='mood-home-container'>
                    {/* Student Selector Card */}
                    <AdminStudentViewer
                        selectedStudentId={selectedStudentId}
                        onStudentSelect={(id, name) => {
                            setSelectedStudentId(id)
                            setSelectedStudentName(name)
                        }}
                    />

                    {/* Cluster diagnostics panel — always visible to admin */}
                    <AdminClusterDiagnosticsPanel />

                    {/* Student dashboard – shown when a student is selected */}
                    {selectedStudentId && selectedStudentName && (
                        <>
                            <div className='admin-viewing-banner'>
                                Viewing dashboard for <strong>{selectedStudentName}</strong>
                            </div>

                            {/* Score Gauges Section */}
                            <ScoreBoard
                                scores={conceptScores}
                                loading={scoresLoading}
                                title='Performance Scores'
                                description='Click on a gauge to see a detailed breakdown'
                                emptyMessage='No scores available for this student.'
                                infoTooltip='Scores are calculated by comparing the student with peers who have similar behavioral patterns. The dial range (P5–P95) shows where most students in their group fall.'
                            />
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

    // Get first survey for "Fill Survey" button
    const firstSurvey = surveys.length > 0 ? surveys[0] : null

    return (
        <div className='mood-home-wrapper'>
            <div className='mood-home-container'>
                {/* Submission reminder banner — top of page */}
                {!reminderDismissed && (missingSleepLog || missingScreenTime || missingSRLSurvey) && (
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
                            {missingSRLSurvey && firstSurvey && (
                                <Link to={`/run/${firstSurvey.id}`} className='reminder-link'>SRL survey →</Link>
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
                <ScoreBoard
                    scores={conceptScores}
                    loading={scoresLoading}
                />

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
            </div>
        </div>
    )
}

export default Home

import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import './ScreenTimeForm.css'
import { getTodayScreenTime, saveScreenTime } from '../api/screenTime'

// ── Option definitions ───────────────────────────────────────
const VOLUME_OPTIONS = [
    { label: '0h', value: 0 },
    { label: '1h', value: 60 },
    { label: '2h', value: 120 },
    { label: '3h', value: 180 },
    { label: '4h', value: 240 },
    { label: '5h', value: 300 },
    { label: '6h', value: 360 },
    { label: '7h', value: 420 },
    { label: '8h', value: 480 },
    { label: '9h', value: 540 },
    { label: '10h+', value: 600 },
]

const LONGEST_SESSION_OPTIONS = [
    { label: 'None', value: 0 },
    { label: '< 15 min', value: 10 },
    { label: '15–30 min', value: 22 },
    { label: '30–60 min', value: 45 },
    { label: '1–2 hours', value: 90 },
    { label: '2–3 hours', value: 150 },
    { label: '3+ hours', value: 210 },
]

const PRE_SLEEP_OPTIONS = [
    { label: 'None', value: 0 },
    { label: '< 15 min', value: 10 },
    { label: '15–30 min', value: 22 },
    { label: '30–60 min', value: 45 },
    { label: '1+ hour', value: 75 },
]

interface SavedEntry {
    total_screen_minutes: number
    longest_continuous_session: number
    late_night_screen_minutes: number
}

// ── Component ────────────────────────────────────────────────
const ScreenTimeForm = () => {
    const navigate = useNavigate()

    const [totalMinutes, setTotalMinutes] = useState<number | null>(null)
    const [longestSession, setLongestSession] = useState<number | null>(null)
    const [preSleepMinutes, setPreSleepMinutes] = useState<number | null>(null)

    const [savedEntry, setSavedEntry] = useState<SavedEntry | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [submitMsg, setSubmitMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

    const isReadonly = savedEntry !== null && !editMode
    const isComplete = totalMinutes !== null && longestSession !== null && preSleepMinutes !== null
    // A longest session longer than the total time is a logical contradiction
    const sessionExceedsTotal = longestSession !== null && totalMinutes !== null && longestSession > totalMinutes
    const isLogicallyValid = !sessionExceedsTotal

    // Fetch today's entry on mount
    useEffect(() => {
        getTodayScreenTime()
            .then(entry => {
                if (entry) setSavedEntry(entry)
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    const handleEditClick = () => {
        if (savedEntry) {
            setTotalMinutes(savedEntry.total_screen_minutes)
            setLongestSession(savedEntry.longest_continuous_session)
            setPreSleepMinutes(savedEntry.late_night_screen_minutes)
        }
        setEditMode(true)
    }

    const handleSubmit = async () => {
        if (!isComplete) return
        setSubmitting(true)
        setSubmitMsg(null)

        try {
            const entry = await saveScreenTime({ totalMinutes: totalMinutes!, longestSession: longestSession!, preSleepMinutes: preSleepMinutes! })
            setSavedEntry(entry)
            setEditMode(false)
            setSubmitMsg({ text: 'Screen time logged!', type: 'success' })
            window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'screen time' } }))
        } catch {
            setSubmitMsg({ text: 'Network error', type: 'error' })
        } finally {
            setSubmitting(false)
        }
    }

    // ── Helpers for read-only display ──
    const formatMinutes = (mins: number): string => {
        if (mins === 0) return 'None'
        const h = Math.floor(mins / 60)
        const m = mins % 60
        if (h === 0) return `${m} min`
        if (m === 0) return `${h}h`
        return `${h}h ${m}m`
    }

    if (loading) {
        return (
            <div className='screen-time-page'>
                <div className='screen-time-container'>
                    <div className='screen-time-card'>
                        <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '40px' }}>Loading...</div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className='screen-time-page'>
            <div className='screen-time-container'>
                {/* Back button */}
                <Link to="/" className='screen-time-back-btn'>
                    ← Back to Home
                </Link>

                <div className='screen-time-card'>
                    <h1 className='screen-time-title'>
                        📱 Daily Screen Time
                    </h1>
                    <p className='screen-time-subtitle'>
                        {isReadonly
                            ? "Here's what you reported for yesterday."
                            : "Answer these 3 quick questions about your screen usage yesterday (excluding studying)."
                        }
                    </p>

                    {/* Read-only summary */}
                    {savedEntry && !editMode && (
                        <>
                            <div className='st-readonly-header'>
                                <span className='st-readonly-badge'>✓ Logged today</span>
                                <button className='st-edit-btn' onClick={handleEditClick}>Edit</button>
                            </div>
                            <div className='st-readonly-grid'>
                                <div className='st-readonly-stat'>
                                    <span className='stat-label'>Total Screen Time</span>
                                    <span className='stat-value'>{formatMinutes(savedEntry.total_screen_minutes)}</span>
                                </div>
                                <div className='st-readonly-stat'>
                                    <span className='stat-label'>Longest Session</span>
                                    <span className='stat-value'>{formatMinutes(savedEntry.longest_continuous_session)}</span>
                                </div>
                                <div className='st-readonly-stat'>
                                    <span className='stat-label'>Before Sleep</span>
                                    <span className='stat-value'>{formatMinutes(savedEntry.late_night_screen_minutes)}</span>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Editable form (also shown when editMode=true) */}
                    {(!savedEntry || editMode) && (
                        <>
                            {/* Q1: Total screen time */}
                            <div className='st-question'>
                                <label className='st-question-label'>
                                    <span className='st-question-number'>1</span>
                                    Roughly how many hours did you spend on your phone/laptop yesterday (excluding studying)?
                                </label>
                                <div className='st-options'>
                                    {VOLUME_OPTIONS.map(opt => (
                                        <label className='st-option' key={opt.value}>
                                            <input
                                                type='radio'
                                                name='totalMinutes'
                                                value={opt.value}
                                                checked={totalMinutes === opt.value}
                                                onChange={() => {
                                                    setTotalMinutes(opt.value)
                                                    if (opt.value > 0 && longestSession === 0) setLongestSession(null)
                                                    if (opt.value === 0) setLongestSession(0)
                                                }}
                                            />
                                            <span className='st-option-label'>{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div className='st-divider' />

                            {/* Q2: Longest session */}
                            <div className='st-question'>
                                <label className='st-question-label'>
                                    <span className='st-question-number'>2</span>
                                    What was your longest uninterrupted screen session yesterday?
                                </label>
                                <div className='st-options'>
                                    {LONGEST_SESSION_OPTIONS
                                        .filter(opt => !totalMinutes || opt.value !== 0)
                                        .map(opt => (
                                        <label className='st-option' key={opt.value}>
                                            <input
                                                type='radio'
                                                name='longestSession'
                                                value={opt.value}
                                                checked={longestSession === opt.value}
                                                onChange={() => setLongestSession(opt.value)}
                                            />
                                            <span className='st-option-label'>{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {sessionExceedsTotal && (
                                <p className='st-validation-warning'>
                                    Your longest session can't be longer than your total screen time. Please adjust one of your answers.
                                </p>
                            )}

                            <div className='st-divider' />

                            {/* Q3: Pre-sleep screen time */}
                            <div className='st-question'>
                                <label className='st-question-label'>
                                    <span className='st-question-number'>3</span>
                                    How much time did you spend on a screen before going to sleep last night?
                                </label>
                                <div className='st-options'>
                                    {PRE_SLEEP_OPTIONS.map(opt => (
                                        <label className='st-option' key={opt.value}>
                                            <input
                                                type='radio'
                                                name='preSleepMinutes'
                                                value={opt.value}
                                                checked={preSleepMinutes === opt.value}
                                                onChange={() => setPreSleepMinutes(opt.value)}
                                            />
                                            <span className='st-option-label'>{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Submit */}
                            <div className='st-submit-row'>
                                {submitMsg && (
                                    <span className={`st-submit-msg ${submitMsg.type === 'success' ? 'st-msg-success' : 'st-msg-error'}`}>
                                        {submitMsg.text}
                                    </span>
                                )}
                                <button
                                    className='st-submit-btn'
                                    onClick={handleSubmit}
                                    disabled={submitting || !isComplete || !isLogicallyValid}
                                >
                                    {submitting ? 'Saving…' : '💾 Save'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    )
}

export default ScreenTimeForm

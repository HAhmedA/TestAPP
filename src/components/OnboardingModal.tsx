import { useEffect, useState } from 'react'
import './OnboardingModal.css'

const API_BASE = '/api'

const STEPS = [
    {
        icon: '🎓',
        title: 'Welcome to your Learning Dashboard',
        paragraphs: [
            'This app helps you understand and improve your self-regulated learning by connecting three areas of your daily life:',
        ],
        list: [
            '📚 Learning Strategies — how you plan, monitor, and reflect on your study',
            '😴 Sleep — your rest patterns and nightly quality',
            '📱 Screen Time — your daily digital habits',
        ],
        footer: 'Your personal AI assistant uses this data to give you tailored, private insights — focusing on your own trends rather than comparing you to others.',
    },
    {
        icon: '📋',
        title: 'What to log and how often',
        checklist: [
            {
                freq: 'Once at the start',
                icon: '✦',
                label: 'Learning Strategies Questionnaire',
                detail: 'Helps us understand how you approach studying. Takes about 5–10 minutes.',
            },
            {
                freq: 'Daily · ~30 seconds',
                icon: '😴',
                label: 'Sleep Log',
                detail: 'Log when you went to bed, when you woke up, and how many times you woke during the night.',
            },
            {
                freq: 'Daily · ~30 seconds',
                icon: '📱',
                label: 'Screen Time Log',
                detail: 'Log your total screen time, longest unbroken session, and whether you used screens in the hour before sleep.',
            },
        ],
        footer: 'The more consistently you log, the more personalised your insights become.',
    },
    {
        icon: '🚀',
        title: "You're all set!",
        paragraphs: [
            'Your dashboard will come to life as you start logging. Everything is private — your data is only shared with your assigned facilitator.',
            'First step: complete the Learning Strategies Questionnaire. It unlocks your full dashboard and only takes a few minutes.',
            'You can always ask your AI assistant questions about your data, or get help understanding your scores.',
        ],
    },
]

const OnboardingModal = () => {
    const [visible, setVisible] = useState(false)
    const [step, setStep] = useState(0)
    const [completing, setCompleting] = useState(false)

    useEffect(() => {
        fetch(`${API_BASE}/profile`, { credentials: 'include' })
            .then(r => {
                if (r.status === 404) {
                    // No profile row yet — brand new user, show onboarding
                    setVisible(true)
                    return null
                }
                return r.json()
            })
            .then(data => {
                if (data && data.onboarding_completed === false) {
                    setVisible(true)
                }
            })
            .catch(() => { /* network error — skip modal rather than blocking */ })
    }, [])

    const markComplete = async () => {
        setCompleting(true)
        try {
            await fetch(`${API_BASE}/profile/onboarding-complete`, {
                method: 'POST',
                credentials: 'include',
            })
        } catch (_) {
            // silently ignore — don't block the user
        }
        setVisible(false)
        setCompleting(false)
    }

    if (!visible) return null

    const current = STEPS[step]
    const isLast = step === STEPS.length - 1

    return (
        <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Welcome onboarding">
            <div className="onboarding-modal">
                {/* Progress dots */}
                <div className="onboarding-dots">
                    {STEPS.map((_, i) => (
                        <span key={i} className={`onboarding-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
                    ))}
                </div>

                {/* Icon */}
                <div className="onboarding-icon">{current.icon}</div>

                {/* Title */}
                <h2 className="onboarding-title">{current.title}</h2>

                {/* Body */}
                <div className="onboarding-body">
                    {current.paragraphs?.map((p, i) => (
                        <p key={i}>{p}</p>
                    ))}

                    {current.list && (
                        <ul className="onboarding-list">
                            {current.list.map((item, i) => (
                                <li key={i}>{item}</li>
                            ))}
                        </ul>
                    )}

                    {current.checklist && (
                        <div className="onboarding-checklist">
                            {current.checklist.map((item, i) => (
                                <div key={i} className="onboarding-checklist-item">
                                    <span className="onboarding-checklist-icon">{item.icon}</span>
                                    <div className="onboarding-checklist-text">
                                        <div className="onboarding-checklist-label">
                                            {item.label}
                                            <span className="onboarding-checklist-freq">{item.freq}</span>
                                        </div>
                                        <div className="onboarding-checklist-detail">{item.detail}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {current.footer && (
                        <p className="onboarding-footer-text">{current.footer}</p>
                    )}
                </div>

                {/* Navigation */}
                <div className="onboarding-actions">
                    {step > 0 && (
                        <button
                            className="onboarding-btn-secondary"
                            onClick={() => setStep(s => s - 1)}
                        >
                            Back
                        </button>
                    )}
                    {!isLast ? (
                        <button
                            className="onboarding-btn-primary"
                            onClick={() => setStep(s => s + 1)}
                        >
                            Next
                        </button>
                    ) : (
                        <button
                            className="onboarding-btn-primary"
                            onClick={markComplete}
                            disabled={completing}
                        >
                            {completing ? 'Saving…' : 'Get Started'}
                        </button>
                    )}
                </div>

                {/* Skip link */}
                <button className="onboarding-skip" onClick={markComplete}>
                    Skip for now
                </button>
            </div>
        </div>
    )
}

export default OnboardingModal

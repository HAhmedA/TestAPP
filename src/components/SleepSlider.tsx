import { useEffect, useRef, useState, useCallback } from 'react'
import './SleepSlider.css'
import { getTodaySleep, saveSleep } from '../api/sleep'

// ── Constants ────────────────────────────────────────────────
// The track spans 24 hours: 12 PM (noon) → 12 PM next day
// Internally we store minutes from track-start (0 = 12:00 PM, 720 = 12:00 AM, 1440 = 12:00 PM next day)
const TRACK_MINUTES = 1440
const MIDNIGHT_OFFSET = 720 // minutes from track start to midnight
const SNAP_MINUTES = 5      // snap to 5-minute increments

// ── Helpers ──────────────────────────────────────────────────
interface Interval {
    id: number
    start: number // minutes from track start
    end: number   // minutes from track start
}

interface SavedSleepEntry {
    session_date: string
    bedtime: string
    wake_time: string
    total_sleep_minutes: number
    time_in_bed_minutes: number
    awakenings_count: number
    awake_minutes: number
}

/** Snap to nearest SNAP_MINUTES */
const snap = (mins: number) => Math.round(mins / SNAP_MINUTES) * SNAP_MINUTES

/** Clamp a value between min and max */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/** Convert track-minutes to HH:MM AM/PM string */
const minsToLabel = (trackMins: number): string => {
    // track 0 = 12:00 PM
    let realHour = 12 + Math.floor(trackMins / 60)
    const m = trackMins % 60
    if (realHour >= 24) realHour -= 24
    const suffix = realHour >= 12 ? 'PM' : 'AM'
    const h12 = realHour === 0 ? 12 : realHour > 12 ? realHour - 12 : realHour
    return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`
}

/** Convert track-minutes to HH:mm (24-h) for the API */
const minsToHHmm = (trackMins: number): string => {
    let realHour = 12 + Math.floor(trackMins / 60)
    const m = trackMins % 60
    if (realHour >= 24) realHour -= 24
    return `${realHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}

/** Convert ISO timestamp to 12h display string in UTC (avoids local timezone offset) */
const isoToDisplayTime = (iso: string): string => {
    const d = new Date(iso)
    const h = d.getUTCHours()
    const m = d.getUTCMinutes()
    const suffix = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `${h12}:${m.toString().padStart(2, '0')} ${suffix}`
}

/** Convert ISO timestamp to track-minutes (track starts at 12 PM noon) */
const hhmmToTrackMins = (iso: string): number => {
    const d = new Date(iso)
    const h = d.getUTCHours()
    const m = d.getUTCMinutes()
    return ((h - 12 + 24) % 24) * 60 + m
}

/** Duration label from total minutes */
const durationLabel = (totalMins: number): string => {
    const h = Math.floor(totalMins / 60)
    const m = totalMins % 60
    if (h === 0) return `${m}m`
    if (m === 0) return `${h}h`
    return `${h}h ${m}m`
}

/** Merge overlapping / adjacent intervals (mutates nothing, returns new sorted array) */
const mergeIntervals = (intervals: Interval[]): Interval[] => {
    if (intervals.length <= 1) return intervals.map(i => ({ ...i }))
    const sorted = [...intervals].sort((a, b) => a.start - b.start)
    const merged: Interval[] = [{ ...sorted[0] }]
    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1]
        if (sorted[i].start <= last.end) {
            last.end = Math.max(last.end, sorted[i].end)
        } else {
            merged.push({ ...sorted[i] })
        }
    }
    return merged
}

let nextId = 1

// ── Component ────────────────────────────────────────────────
interface SleepSliderProps {
    onSaved?: () => void
}

const SleepSlider = ({ onSaved }: SleepSliderProps) => {
    const [intervals, setIntervals] = useState<Interval[]>([
        { id: nextId++, start: snap(MIDNIGHT_OFFSET - 90), end: snap(MIDNIGHT_OFFSET + 420) }
        // default: 10:30 PM → 7:00 AM
    ])
    const [savedEntry, setSavedEntry] = useState<SavedSleepEntry | null>(null)
    const [editMode, setEditMode] = useState(false)
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [submitMsg, setSubmitMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

    const trackRef = useRef<HTMLDivElement>(null)
    const [dragState, setDragState] = useState<{
        intervalId: number
        type: 'start' | 'end' | 'move'
        offsetMin?: number // for move: pointer offset from interval start
    } | null>(null)
    const [hoverMin, setHoverMin] = useState<number | null>(null)
    const [drawStart, setDrawStart] = useState<number | null>(null)

    const isReadonly = savedEntry !== null && !editMode

    // ── Fetch today's entry on mount ──
    useEffect(() => {
        getTodaySleep()
            .then(entry => {
                if (entry) {
                    setSavedEntry(entry)
                    // Bug fix: populate slider position from saved data (prevents reset-to-default on refresh)
                    setIntervals([{
                        id: nextId++,
                        start: hhmmToTrackMins(entry.bedtime),
                        end: hhmmToTrackMins(entry.wake_time)
                    }])
                }
                setLoading(false)
            })
            .catch(() => setLoading(false))
    }, [])

    // ── Pixel ↔ minute conversion ──
    const pxToMin = useCallback((clientX: number): number => {
        if (!trackRef.current) return 0
        const rect = trackRef.current.getBoundingClientRect()
        const pct = (clientX - rect.left) / rect.width
        return snap(clamp(Math.round(pct * TRACK_MINUTES), 0, TRACK_MINUTES))
    }, [])

    const minToPct = (mins: number) => (mins / TRACK_MINUTES) * 100

    // ── Drag / draw handlers ──
    useEffect(() => {
        if (isReadonly) return

        const handleMove = (e: MouseEvent | TouchEvent) => {
            const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
            const min = pxToMin(clientX)

            if (drawStart !== null) {
                // Drawing a new interval
                setIntervals(prev => {
                    const drawing = prev.find(i => i.id === -1)
                    const newStart = Math.min(drawStart, min)
                    const newEnd = Math.max(drawStart, min)
                    if (drawing) {
                        return prev.map(i => i.id === -1 ? { ...i, start: newStart, end: newEnd } : i)
                    }
                    return [...prev, { id: -1, start: newStart, end: newEnd }]
                })
                return
            }

            if (!dragState) return

            setIntervals(prev => prev.map(intv => {
                if (intv.id !== dragState.intervalId) return intv
                const copy = { ...intv }
                if (dragState.type === 'start') {
                    copy.start = clamp(min, 0, copy.end - SNAP_MINUTES)
                } else if (dragState.type === 'end') {
                    copy.end = clamp(min, copy.start + SNAP_MINUTES, TRACK_MINUTES)
                } else {
                    // Move entire interval
                    const dur = copy.end - copy.start
                    const newStart = clamp(min - (dragState.offsetMin || 0), 0, TRACK_MINUTES - dur)
                    copy.start = snap(newStart)
                    copy.end = snap(newStart + dur)
                }
                return copy
            }))
        }

        const handleUp = () => {
            if (drawStart !== null) {
                // Finalize drawn interval
                setIntervals(prev => {
                    const updated = prev.map(i =>
                        i.id === -1 ? { ...i, id: nextId++ } : i
                    ).filter(i => i.end - i.start >= SNAP_MINUTES)
                    return mergeIntervals(updated)
                })
                setDrawStart(null)
                return
            }

            if (dragState) {
                setIntervals(prev => mergeIntervals(prev))
                setDragState(null)
            }
        }

        window.addEventListener('mousemove', handleMove)
        window.addEventListener('mouseup', handleUp)
        window.addEventListener('touchmove', handleMove, { passive: false })
        window.addEventListener('touchend', handleUp)

        return () => {
            window.removeEventListener('mousemove', handleMove)
            window.removeEventListener('mouseup', handleUp)
            window.removeEventListener('touchmove', handleMove)
            window.removeEventListener('touchend', handleUp)
        }
    }, [dragState, drawStart, pxToMin, isReadonly])

    // ── Handlers ──
    const onTrackMouseDown = (e: React.MouseEvent) => {
        if (isReadonly) return
        // Only start a new draw if clicking on the bare track (not on an interval)
        if ((e.target as HTMLElement).closest('.sleep-interval')) return
        const min = pxToMin(e.clientX)
        setDrawStart(min)
    }

    const onHandleDown = (e: React.MouseEvent | React.TouchEvent, intervalId: number, type: 'start' | 'end') => {
        e.stopPropagation()
        e.preventDefault()
        setDragState({ intervalId, type })
    }

    const onIntervalDown = (e: React.MouseEvent | React.TouchEvent, intv: Interval) => {
        if (isReadonly) return
        // Prevent if clicking remove button
        if ((e.target as HTMLElement).closest('.sleep-interval-remove')) return
        e.stopPropagation()
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
        const min = pxToMin(clientX)
        setDragState({ intervalId: intv.id, type: 'move', offsetMin: min - intv.start })
    }

    const removeInterval = (id: number) => {
        setIntervals(prev => prev.filter(i => i.id !== id))
    }

    const addInterval = () => {
        // Find a gap to place the new interval, default: 2 AM → 3 AM
        const newStart = snap(MIDNIGHT_OFFSET + 120) // 2 AM
        const newEnd = snap(MIDNIGHT_OFFSET + 180)   // 3 AM
        setIntervals(prev => mergeIntervals([...prev, { id: nextId++, start: newStart, end: newEnd }]))
    }

    const onTrackHover = (e: React.MouseEvent) => {
        if (isReadonly) return
        setHoverMin(pxToMin(e.clientX))
    }

    const onTrackLeave = () => setHoverMin(null)

    // ── Submit ──
    const handleSubmit = async () => {
        if (intervals.length === 0) return
        setSubmitting(true)
        setSubmitMsg(null)

        const apiIntervals = intervals.map(i => ({
            start: minsToHHmm(i.start),
            end: minsToHHmm(i.end)
        }))

        try {
            const entry = await saveSleep(apiIntervals)
            setSavedEntry(entry)
            setEditMode(false)
            setSubmitMsg({ text: 'Sleep log saved!', type: 'success' })
            window.dispatchEvent(new CustomEvent('chatbot:dataUpdated', { detail: { dataType: 'sleep' } }))
            onSaved?.()
        } catch {
            setSubmitMsg({ text: 'Network error', type: 'error' })
        } finally {
            setSubmitting(false)
        }
    }

    // ── Computed summary values ──
    const totalSleep = intervals.reduce((sum, i) => sum + (i.end - i.start), 0)
    const earliestStart = intervals.length > 0 ? Math.min(...intervals.map(i => i.start)) : 0
    const latestEnd = intervals.length > 0 ? Math.max(...intervals.map(i => i.end)) : 0

    // ── Tick marks positions (hourly; major every 3 hours) ──
    const ticks = Array.from({ length: 25 }, (_, i) => {
        const h = (12 + i) % 24
        const pct = (i / 24) * 100
        const isMajor = i % 3 === 0
        const isMidnight = h === 0
        const label = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h > 12 ? `${h - 12} PM` : `${h} AM`
        return { h, pct, isMajor, isMidnight, label }
    })

    // Night zone: from 9 PM (track min 540) to 6 AM (track min 1080)
    const nightStart = minToPct(540)
    const nightEnd = minToPct(1080)

    if (loading) {
        return (
            <div className='sleep-slider-card'>
                <div className='sleep-slider-header'>
                    <h3><span className='sleep-icon'>🌙</span> Sleep Log</h3>
                </div>
                <div style={{ textAlign: 'center', color: '#9CA3AF', padding: '20px' }}>Loading...</div>
            </div>
        )
    }

    return (
        <div className='sleep-slider-card'>
            {/* Header */}
            <div className='sleep-slider-header'>
                <div>
                    <h3><span className='sleep-icon'>🌙</span> Sleep Log</h3>
                    <p className='sleep-slider-subtitle'>
                        {isReadonly
                            ? "Your sleep log for last night"
                            : "Drag on the timeline to mark when you slept last night"
                        }
                    </p>
                </div>
                {savedEntry && !editMode && (
                    <div className='sleep-logged-actions'>
                        <span className='sleep-already-logged'>✓ Logged today</span>
                        <button className='sleep-edit-btn' onClick={() => setEditMode(true)}>Edit</button>
                    </div>
                )}
                {editMode && (
                    <button className='sleep-edit-cancel-btn' onClick={() => setEditMode(false)}>Cancel</button>
                )}
            </div>

            {/* Multi-interval hint (Sprint 5) */}
            <p className='sleep-multi-hint'>You can log multiple sleep periods (e.g., nap + overnight).</p>

            {/* Track */}
            <div className='sleep-track-container'>
                {/* Tick marks — major every 3h with label, minor every 1h */}
                <div className='sleep-tick-row'>
                    {ticks.map((t, i) => (
                        <div
                            key={i}
                            className={`sleep-tick ${t.isMajor ? 'sleep-tick-major' : 'sleep-tick-minor'} ${t.isMidnight ? 'sleep-tick-midnight' : ''}`}
                            style={{ left: `${t.pct}%` }}
                        >
                            {t.isMajor && <span className='sleep-tick-label'>{t.label}</span>}
                        </div>
                    ))}
                </div>

                {/* The track itself */}
                <div
                    ref={trackRef}
                    className={`sleep-track ${isReadonly ? 'sleep-track--readonly' : ''}`}
                    onMouseDown={!isReadonly ? onTrackMouseDown : undefined}
                    onMouseMove={!isReadonly ? onTrackHover : undefined}
                    onMouseLeave={onTrackLeave}
                >
                    {/* Night zone background */}
                    <div
                        className='sleep-night-zone'
                        style={{ left: `${nightStart}%`, width: `${nightEnd - nightStart}%` }}
                    />

                    {/* Hover tooltip */}
                    {hoverMin !== null && !dragState && !drawStart && !isReadonly && (
                        <div className='sleep-track-tooltip' style={{ left: `${minToPct(hoverMin)}%` }}>
                            {minsToLabel(hoverMin)}
                        </div>
                    )}

                    {/* Interval bars */}
                    {intervals.map(intv => {
                        const leftPct = minToPct(intv.start)
                        const widthPct = minToPct(intv.end - intv.start)
                        const isDragging = dragState?.intervalId === intv.id
                        return (
                            <div
                                key={intv.id}
                                className={`sleep-interval ${isDragging ? 'sleep-interval--dragging' : ''}`}
                                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                                onMouseDown={!isReadonly ? (e) => onIntervalDown(e, intv) : undefined}
                                onTouchStart={!isReadonly ? (e) => onIntervalDown(e, intv) : undefined}
                            >
                                {/* Time label inside */}
                                <span className='sleep-interval-time'>
                                    {minsToLabel(intv.start)} – {minsToLabel(intv.end)}
                                </span>

                                {!isReadonly && (
                                    <>
                                        {/* Drag handles */}
                                        <div
                                            className={`sleep-handle sleep-handle--start ${dragState?.intervalId === intv.id && dragState.type === 'start' ? 'sleep-handle--dragging' : ''}`}
                                            onMouseDown={(e) => onHandleDown(e, intv.id, 'start')}
                                            onTouchStart={(e) => onHandleDown(e, intv.id, 'start')}
                                        />
                                        <div
                                            className={`sleep-handle sleep-handle--end ${dragState?.intervalId === intv.id && dragState.type === 'end' ? 'sleep-handle--dragging' : ''}`}
                                            onMouseDown={(e) => onHandleDown(e, intv.id, 'end')}
                                            onTouchStart={(e) => onHandleDown(e, intv.id, 'end')}
                                        />
                                        {/* Remove button */}
                                        <div
                                            className='sleep-interval-remove'
                                            onClick={(e) => { e.stopPropagation(); removeInterval(intv.id) }}
                                        >
                                            ✕
                                        </div>
                                    </>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Read-only summary */}
            {isReadonly && savedEntry && (
                <div className='sleep-readonly-summary'>
                    <div className='sleep-readonly-stat'>
                        <span className='stat-label'>Bedtime</span>
                        <span className='stat-value'>
                            {isoToDisplayTime(savedEntry.bedtime)}
                        </span>
                    </div>
                    <div className='sleep-readonly-stat'>
                        <span className='stat-label'>Wake Time</span>
                        <span className='stat-value'>
                            {isoToDisplayTime(savedEntry.wake_time)}
                        </span>
                    </div>
                    <div className='sleep-readonly-stat'>
                        <span className='stat-label'>Total Sleep</span>
                        <span className='stat-value'>{durationLabel(savedEntry.total_sleep_minutes)}</span>
                    </div>
                    <div className='sleep-readonly-stat'>
                        <span className='stat-label'>Awakenings</span>
                        <span className='stat-value'>{savedEntry.awakenings_count}</span>
                    </div>
                </div>
            )}

            {/* Controls — only in edit mode */}
            {!isReadonly && (
                <>
                    <div className='sleep-controls'>
                        <button className='sleep-add-btn' onClick={addInterval}>
                            + Add Another Sleep Period
                        </button>
                        {intervals.length > 0 && (
                            <div className='sleep-summary'>
                                <div className='sleep-summary-item'>
                                    <span className='sleep-summary-label'>Total:</span>
                                    <span className='sleep-summary-value'>{durationLabel(totalSleep)}</span>
                                </div>
                                <div className='sleep-summary-item'>
                                    <span className='sleep-summary-label'>From:</span>
                                    <span className='sleep-summary-value'>{minsToLabel(earliestStart)}</span>
                                </div>
                                <div className='sleep-summary-item'>
                                    <span className='sleep-summary-label'>To:</span>
                                    <span className='sleep-summary-value'>{minsToLabel(latestEnd)}</span>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className='sleep-submit-row'>
                        {submitMsg && (
                            <span className={`sleep-submit-msg ${submitMsg.type === 'success' ? 'sleep-msg-success' : 'sleep-msg-error'}`}>
                                {submitMsg.text}
                            </span>
                        )}
                        <button
                            className='sleep-submit-btn'
                            onClick={handleSubmit}
                            disabled={submitting || intervals.length === 0}
                        >
                            {submitting ? 'Saving…' : '💾 Save Sleep Log'}
                        </button>
                    </div>
                </>
            )}
        </div>
    )
}

export default SleepSlider

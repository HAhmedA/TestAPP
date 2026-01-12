import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReduxDispatch } from '../redux'
import { loadStudentMoodHistory, MoodHistoryData, loadAnnotations, Annotation } from '../redux/results'
import './MoodHistory.css'

// Map time window from URL period to annotation timeWindow
const periodToTimeWindow = (period: string): '24h' | '7d' | undefined => {
    if (period === 'today') return '24h'
    if (period === '7days') return '7d'
    return undefined
}

// Get trend color class
const getTrendColorClass = (trend: string, isInverted: boolean): string => {
    // For inverted concepts (like anxiety), flip the meaning
    if (isInverted) {
        switch (trend) {
            case 'improving': return 'trend-good'      // Anxiety decreasing = good
            case 'declining': return 'trend-bad'      // Anxiety increasing = bad
            case 'stable_high': return 'trend-bad'    // High anxiety = bad
            case 'stable_low': return 'trend-good'    // Low anxiety = good
            default: return 'trend-neutral'
        }
    }

    switch (trend) {
        case 'improving': return 'trend-good'
        case 'declining': return 'trend-bad'
        case 'stable_high': return 'trend-good'
        case 'stable_low': return 'trend-bad'
        default: return 'trend-neutral'
    }
}

// Get trend icon
const getTrendIcon = (trend: string): string => {
    switch (trend) {
        case 'improving': return '↗'
        case 'declining': return '↘'
        default: return '→'
    }
}

const MoodHistory = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const period = searchParams.get('period') || 'all'
    const dispatch = useReduxDispatch()

    const [historyData, setHistoryData] = useState<MoodHistoryData | null>(null)
    const [annotations, setAnnotations] = useState<Annotation[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (id) {
            setLoading(true)

            // Load both history data and annotations
            const loadData = async () => {
                try {
                    const historyResult = await dispatch(loadStudentMoodHistory({
                        surveyId: id,
                        period: period === 'all' ? undefined : period
                    }))
                    setHistoryData(historyResult.payload as MoodHistoryData)

                    // Load annotations for the matching time window
                    const timeWindow = periodToTimeWindow(period)
                    const annotationsResult = await dispatch(loadAnnotations(timeWindow))
                    const annotationsPayload = annotationsResult.payload as { annotations: Annotation[] }
                    setAnnotations(annotationsPayload?.annotations || [])
                } catch (error) {
                    console.error('Error loading mood history:', error)
                } finally {
                    setLoading(false)
                }
            }

            loadData()
        }
    }, [id, period, dispatch])

    // Get annotation for a specific concept and time window
    const getAnnotation = (conceptKey: string): Annotation | undefined => {
        const timeWindow = periodToTimeWindow(period)
        if (!timeWindow) {
            // For "all time", prefer 7d annotation
            return annotations.find(a => a.conceptKey === conceptKey && a.timeWindow === '7d')
        }
        return annotations.find(a => a.conceptKey === conceptKey && a.timeWindow === timeWindow)
    }

    if (loading) {
        return (
            <div className='mood-history-wrapper'>
                <div className='mood-history-container'>
                    <div className='mood-history-loading'>Loading...</div>
                </div>
            </div>
        )
    }

    if (!historyData || !historyData.data || historyData.data.length === 0) {
        return (
            <div className='mood-history-wrapper'>
                <div className='mood-history-container'>
                    <button className='mood-history-back' onClick={() => navigate('/')}>
                        ← Back
                    </button>
                    <h1 className='mood-history-title'>Mood History</h1>
                    <div className='mood-history-no-data'>No survey responses yet</div>
                </div>
            </div>
        )
    }

    // Format data for display
    const formattedData = historyData.data.map(item => {
        if (historyData.period === 'today' && item.time) {
            // For today, use time as the x-axis label
            return {
                ...item,
                xLabel: item.time
            }
        } else if (item.date) {
            // For other periods, use date as the x-axis label
            return {
                ...item,
                xLabel: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            }
        }
        return item
    })

    // Generate colors for each construct
    const colors = [
        '#850b0b', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
        '#06B6D4', '#EC4899', '#84CC16', '#F97316', '#6366F1',
        '#14B8A6', '#A855F7', '#F43F5E', '#0EA5E9'
    ]

    return (
        <div className='mood-history-wrapper'>
            <div className='mood-history-container'>
                <button className='mood-history-back' onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1 className='mood-history-title'>
                    Mood History {historyData.period === 'today' ? '(Today)' : historyData.period === '7days' ? '(Last 7 Days)' : 'Over Time'}
                </h1>

                {/* Threshold message - show if any annotation lacks sufficient data */}
                {annotations.length > 0 && !annotations.some(a => a.hasSufficientData) && (
                    <div className='mood-history-threshold-message'>
                        <span className='threshold-icon'>📊</span>
                        <span>
                            {period === '7days' || historyData.period === '7days'
                                ? 'Fill surveys on at least 3 different days to see trends'
                                : 'Fill at least 3 surveys to see trends'}
                        </span>
                    </div>
                )}

                <div className='mood-history-charts'>
                    {historyData.constructs.map((construct, index) => {
                        const constructData = formattedData
                            .map(item => ({
                                xLabel: item.xLabel || item.date || item.time,
                                value: (item as any)[construct.name] !== null && (item as any)[construct.name] !== undefined
                                    ? Number((item as any)[construct.name])
                                    : null
                            }))
                            .filter(item => item.value !== null)

                        if (constructData.length === 0) {
                            return null
                        }

                        // Format construct title: remove underscores, capitalize first letter
                        const formatConstructTitle = (title: string) => {
                            return title
                                .replace(/_/g, ' ')
                                .split(' ')
                                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                                .join(' ')
                        }

                        // Get short construct name (first word or key word)
                        const getShortConstructName = (name: string) => {
                            // Map common construct names to short versions
                            const shortNames: Record<string, string> = {
                                'efficiency': 'Efficiency',
                                'importance': 'Importance',
                                'tracking': 'Tracking',
                                'clarity': 'Clarity',
                                'effort': 'Effort',
                                'focus': 'Focus',
                                'help_seeking': 'Help Seeking',
                                'community': 'Community',
                                'timeliness': 'Timeliness',
                                'motivation': 'Motivation',
                                'anxiety': 'Anxiety',
                                'enjoyment': 'Enjoyment',
                                'learning_from_feedback': 'Learning From Feedback',
                                'self_assessment': 'Self Assessment'
                            }

                            if (shortNames[name]) {
                                return shortNames[name]
                            }

                            // Fallback: capitalize first letter of first word
                            const formatted = formatConstructTitle(name)
                            return formatted.split(' ')[0] || formatted
                        }

                        const formattedTitle = formatConstructTitle(construct.title || construct.name)
                        const shortName = getShortConstructName(construct.name)
                        const xAxisLabel = historyData.period === 'today' ? 'Time' : 'Day'
                        const legendName = shortName

                        // Get annotation for this construct
                        const annotation = getAnnotation(construct.name)

                        return (
                            <div key={construct.name} className='mood-history-chart-container'>
                                <h3 className='mood-history-chart-title'>{index + 1}. {formattedTitle}</h3>

                                {/* Annotation text above the chart - only show if sufficient data */}
                                {annotation && annotation.hasSufficientData && (
                                    <div className={`mood-history-annotation ${getTrendColorClass(annotation.trend, annotation.isInverted)}`}>
                                        <span className='annotation-icon'>{getTrendIcon(annotation.trend)}</span>
                                        <span className='annotation-text'>{annotation.text}</span>
                                    </div>
                                )}

                                <ResponsiveContainer width="100%" height={300}>
                                    <LineChart data={constructData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis
                                            dataKey="xLabel"
                                            tick={{ fontSize: 12 }}
                                            angle={historyData.period === 'today' ? 0 : -45}
                                            textAnchor={historyData.period === 'today' ? 'middle' : 'end'}
                                            height={historyData.period === 'today' ? 40 : 60}
                                            label={{ value: xAxisLabel, position: 'insideBottom', offset: -5 }}
                                        />
                                        <YAxis
                                            domain={[1, 5]}
                                            tick={{ fontSize: 12 }}
                                            label={{ value: 'Rating', angle: -90, position: 'insideLeft' }}
                                        />
                                        <Tooltip />
                                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                                        <Line
                                            type="monotone"
                                            dataKey="value"
                                            stroke={colors[index % colors.length]}
                                            strokeWidth={2}
                                            dot={{ r: 4 }}
                                            activeDot={{ r: 6 }}
                                            name={legendName}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

export default MoodHistory



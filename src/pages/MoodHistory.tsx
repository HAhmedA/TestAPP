import { useEffect, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useReduxDispatch } from '../redux'
import { loadStudentMoodHistory, MoodHistoryData, loadAnnotations, AnnotationsData } from '../redux/results'
import './MoodHistory.css'

const MoodHistory = () => {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const period = searchParams.get('period') || 'all'
    const dispatch = useReduxDispatch()
    
    const [historyData, setHistoryData] = useState<MoodHistoryData | null>(null)
    const [loading, setLoading] = useState(true)
    const [annotations, setAnnotations] = useState<AnnotationsData | null>(null)
    
    useEffect(() => {
        if (id) {
            setLoading(true)
            dispatch(loadStudentMoodHistory({ surveyId: id, period: period === 'all' ? undefined : period }))
                .then((result: any) => {
                    setHistoryData(result.payload)
                    setLoading(false)
                })
                .catch(() => {
                    setLoading(false)
                })
            
            // Load annotations if period is 'today' or '7days'
            if (period === 'today' || period === '7days') {
                dispatch(loadAnnotations({ surveyId: id, period: period as 'today' | '7days' }))
                    .then((result: any) => {
                        if (result.type === 'results/loadAnnotations/fulfilled') {
                            setAnnotations(result.payload)
                        } else {
                            setAnnotations(null)
                        }
                    })
                    .catch(() => {
                        setAnnotations(null)
                    })
            } else {
                setAnnotations(null)
            }
        }
    }, [id, period, dispatch])
    
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
                        
                        return (
                            <div key={construct.name} className='mood-history-chart-container'>
                                <h3 className='mood-history-chart-title'>{index + 1}. {formattedTitle}</h3>
                                
                                {/* Add annotation for this specific construct */}
                                {annotations && annotations.annotations && annotations.annotations.length > 0 && (() => {
                                    const constructAnnotation = annotations.annotations.find(
                                        ann => ann.constructName === construct.name
                                    )
                                    return constructAnnotation ? (
                                        <div className='mood-history-chart-annotation'>
                                            {constructAnnotation.annotationText}
                                        </div>
                                    ) : null
                                })()}
                                
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


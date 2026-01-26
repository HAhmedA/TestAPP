import React from 'react'
import './ScoreGauge.css'

interface ScoreGaugeProps {
    score: number          // 0-100
    label: string          // Concept name
    trend?: string         // 'improving', 'declining', 'stable'
    size?: 'small' | 'medium' | 'large'
}

/**
 * ScoreGauge - A semicircular gauge component that displays a score
 * Features continuous colored arc segments and curved labels outside the arc
 */
const ScoreGauge: React.FC<ScoreGaugeProps> = ({
    score,
    label,
    trend = 'stable',
    size = 'medium'
}) => {
    // Clamp score to 0-100
    const clampedScore = Math.max(0, Math.min(100, score))

    // Calculate needle rotation: -90° (left) to 90° (right)
    const needleRotation = (clampedScore / 100) * 180 - 90

    // Determine score level for label
    const getScoreLevel = (score: number): string => {
        if (score >= 80) return 'Excellent'
        if (score >= 60) return 'Good'
        if (score >= 40) return 'Fair'
        if (score >= 20) return 'Poor'
        return 'Very Poor'
    }

    // Get color based on score
    const getScoreColor = (score: number): string => {
        if (score >= 80) return '#22c55e' // Green
        if (score >= 60) return '#84cc16' // Light green
        if (score >= 40) return '#fbbf24' // Yellow
        if (score >= 20) return '#f97316' // Orange
        return '#ef4444' // Red
    }

    const getTrendIcon = () => {
        switch (trend) {
            case 'improving':
                return <span className="gauge-trend gauge-trend-up">↑</span>
            case 'declining':
                return <span className="gauge-trend gauge-trend-down">↓</span>
            default:
                return <span className="gauge-trend gauge-trend-stable">→</span>
        }
    }

    // SVG Geometry Constants
    const CX = 100
    const CY = 105 // Lowered center to make room for top labels
    const R = 70   // Reduced radius to fit in viewBox
    const STROKE = 14

    // Helper to calculate arc points
    const pol2cart = (cx: number, cy: number, r: number, angleDeg: number) => {
        const rad = (angleDeg * Math.PI) / 180
        return {
            x: cx + r * Math.cos(rad),
            y: cy - r * Math.sin(rad)
        }
    }

    // Segments: 180-144, 144-108, 108-72, 72-36, 36-0
    const createSegment = (startAngle: number, endAngle: number, color: string) => {
        const start = pol2cart(CX, CY, R, startAngle)
        const end = pol2cart(CX, CY, R, endAngle)
        // Large arc flag is 0 for <180
        const d = `M ${start.x} ${start.y} A ${R} ${R} 0 0 1 ${end.x} ${end.y}`
        return <path d={d} fill="none" stroke={color} strokeWidth={STROKE} key={color} />
    }

    // Labels: Radius slightly larger than arc to place text outside
    const LabelRadius = R + 18
    const createLabel = (angle: number, text: string) => {
        const pos = pol2cart(CX, CY, LabelRadius, angle)
        return (
            <text
                x={pos.x}
                y={pos.y}
                className="gauge-segment-label"
                fontSize="8"
                fill="#6b7280"
                textAnchor="middle"
                dominantBaseline="middle"
                key={text}
            >
                {text}
            </text>
        )
    }

    return (
        <div className={`score-gauge score-gauge-${size}`}>
            <div className="gauge-label">{label}</div>

            <div className="gauge-container">
                {/* SVG Gauge */}
                <svg viewBox="0 0 200 120" className="gauge-svg">
                    {/* Segments - Continuous, no gaps */}
                    {createSegment(180, 144, '#ef4444')}
                    {createSegment(144, 108, '#f97316')}
                    {createSegment(108, 72, '#fbbf24')}
                    {createSegment(72, 36, '#84cc16')}
                    {createSegment(36, 0, '#22c55e')}

                    {/* Center point */}
                    <circle cx={CX} cy={CY} r="6" fill="#374151" />

                    {/* Needle */}
                    <g transform={`rotate(${needleRotation} ${CX} ${CY})`}>
                        <polygon
                            points={`${CX},${CY - R + 5} ${CX - 4},${CY} ${CX + 4},${CY}`}
                            fill="#1f2937"
                        />
                    </g>

                    {/* Labels - Outside the arc */}
                    {createLabel(162, 'Very Poor')}
                    {createLabel(126, 'Poor')}
                    {createLabel(90, 'Fair')}
                    {createLabel(54, 'Good')}
                    {createLabel(18, 'Excellent')}
                </svg>
            </div>

            {/* Score display */}
            <div className="gauge-score-display">
                <span
                    className="gauge-score-value"
                    style={{ color: getScoreColor(clampedScore) }}
                >
                    {Math.round(clampedScore)}
                </span>
                <span className="gauge-score-max">/100</span>
                {getTrendIcon()}
            </div>

            <div
                className="gauge-score-level"
                style={{ color: getScoreColor(clampedScore) }}
            >
                {getScoreLevel(clampedScore)}
            </div>
        </div>
    )
}

export default ScoreGauge

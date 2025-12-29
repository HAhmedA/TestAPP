/**
 * Annotations Module
 * 
 * This module is responsible for:
 * - Computing statistics (min, max, average) for SRL concepts
 * - Detecting trends (decreasing, fluctuating, increasing, stable)
 * - Generating textual annotations
 * - Storing annotations in the database
 * 
 * The trend detection logic is modular and can be easily changed.
 */

/**
 * Helper function to get short construct names
 */
function getShortConstructName(name) {
  const shortNames = {
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
  
  // Fallback: capitalize first letter
  return name
    .replace(/_/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .split(' ')[0] || name
}

/**
 * Trend Detection Module
 * This can be replaced with different trend detection algorithms
 */
class TrendDetector {
  /**
   * Detects the trend pattern in a series of values
   * @param {number[]} values - Array of numeric values in chronological order
   * @param {number} average - The average value for context
   * @returns {Object} - { type: string, description: string }
   */
  detectTrend(values, average) {
    if (!values || values.length < 2) {
      return { type: 'insufficient_data', description: 'insufficient data' }
    }

    // Calculate linear regression to determine overall direction
    const n = values.length
    const sumX = (n * (n - 1)) / 2
    const sumY = values.reduce((a, b) => a + b, 0)
    const sumXY = values.reduce((sum, y, i) => sum + i * y, 0)
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)

    // Calculate variance to detect fluctuation
    const variance = this.calculateVariance(values, average)
    const stdDev = Math.sqrt(variance)

    // Determine if values are stable (low variance)
    const isStable = stdDev < 0.5 // Threshold for stability

    // Determine level (low, average, high) based on average
    let level = 'average'
    if (average < 2.5) {
      level = 'low'
    } else if (average > 3.5) {
      level = 'high'
    }

    // Determine trend type
    if (isStable) {
      return {
        type: 'stable',
        level: level,
        description: `stable (${level})`
      }
    } else if (slope > 0.1) {
      return {
        type: 'increasing',
        description: 'increasing'
      }
    } else if (slope < -0.1) {
      return {
        type: 'decreasing',
        description: 'decreasing'
      }
    } else {
      // Fluctuating (high variance but no clear direction)
      return {
        type: 'fluctuating',
        description: 'fluctuating'
      }
    }
  }

  /**
   * Calculates variance of values
   */
  calculateVariance(values, mean) {
    const squaredDiffs = values.map(value => Math.pow(value - mean, 2))
    return squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  }
}

/**
 * Annotation Generator
 * Generates textual annotations based on statistics and trends
 */
class AnnotationGenerator {
  constructor(trendDetector) {
    this.trendDetector = trendDetector || new TrendDetector()
  }

  /**
   * Generates an annotation text for a construct
   * @param {Object} params - { constructTitle, average, min, max, trend, period, constructName }
   * @returns {string} - The annotation text
   */
  generateAnnotation({ constructTitle, average, min, max, trend, period, constructName }) {
    if (average === null || average === undefined) {
      return null // No annotation if no data
    }

    // Skip if insufficient data
    if (trend.type === 'insufficient_data') {
      return null
    }

    const periodText = period === 'today' ? 'today' : 'during the past 7 days'
    
    // Use short construct name instead of full title
    const shortName = getShortConstructName(constructName)
    
    // Format the level description
    let levelText = ''
    if (trend.type === 'stable') {
      levelText = trend.level === 'low' ? 'low' : 
                  trend.level === 'high' ? 'high' : 
                  'average'
    }

    // Build the annotation
    let annotation = `The average of the concept "${shortName}" was `
    
    if (trend.type === 'stable') {
      annotation += `${levelText} ${periodText}`
    } else {
      annotation += `${trend.description} ${periodText}`
    }

    // Add additional context if available
    if (min !== null && max !== null && min !== max) {
      annotation += ` (ranging from ${min} to ${max})`
    }

    return annotation
  }
}

/**
 * Statistics Calculator
 * Computes min, max, average from raw data
 */
class StatisticsCalculator {
  /**
   * Calculates statistics for a construct from results
   * @param {Array} results - Array of result objects with data property
   * @param {string} constructName - Name of the construct to analyze
   * @returns {Object} - { average, min, max, count, values }
   */
  calculateStatistics(results, constructName) {
    const values = results
      .map(result => {
        const value = result.data[constructName]
        return value !== undefined && value !== null ? Number(value) : null
      })
      .filter(v => v !== null && !isNaN(v))

    if (values.length === 0) {
      return {
        average: null,
        min: null,
        max: null,
        count: 0,
        values: []
      }
    }

    const sum = values.reduce((a, b) => a + b, 0)
    const average = sum / values.length
    const min = Math.min(...values)
    const max = Math.max(...values)

    return {
      average: Math.round(average * 10) / 10,
      min,
      max,
      count: values.length,
      values: values
    }
  }
}

/**
 * Main Annotations Service
 * Orchestrates the annotation generation and storage
 */
class AnnotationsService {
  constructor(pool, trendDetector = null, annotationGenerator = null) {
    this.pool = pool
    this.trendDetector = trendDetector || new TrendDetector()
    this.annotationGenerator = annotationGenerator || new AnnotationGenerator(this.trendDetector)
    this.statisticsCalculator = new StatisticsCalculator()
  }

  /**
   * Generates and stores annotations for a user's survey results
   * @param {string} userId - User ID
   * @param {string} surveyId - Survey ID
   * @param {string} period - 'today' or '7days'
   * @param {Array} results - Array of result objects with data and created_at
   * @param {Array} constructs - Array of { name, title } objects
   * @returns {Promise<Array>} - Array of annotation objects
   */
  async generateAndStoreAnnotations(userId, surveyId, period, results, constructs) {
    if (!results || results.length === 0) {
      return [] // No annotations if no data
    }

    const annotations = []

    for (const construct of constructs) {
      // Calculate statistics
      const stats = this.statisticsCalculator.calculateStatistics(results, construct.name)

      if (stats.count === 0) {
        continue // Skip constructs with no data
      }

      // Detect trend
      const trend = this.trendDetector.detectTrend(stats.values, stats.average)

      // Generate annotation text
      const annotationText = this.annotationGenerator.generateAnnotation({
        constructTitle: construct.title,
        constructName: construct.name,
        average: stats.average,
        min: stats.min,
        max: stats.max,
        trend: trend,
        period: period
      })

      if (!annotationText) {
        continue // Skip if no annotation generated
      }

      // Prepare statistics object for storage
      const statisticsData = {
        average: stats.average,
        min: stats.min,
        max: stats.max,
        count: stats.count,
        trend: {
          type: trend.type,
          description: trend.description,
          level: trend.level || null
        }
      }

      // Store or update annotation in database
      const annotation = await this.upsertAnnotation({
        userId,
        surveyId,
        period,
        constructName: construct.name,
        constructTitle: construct.title,
        annotationText,
        statistics: statisticsData
      })

      annotations.push(annotation)
    }

    return annotations
  }

  /**
   * Upserts an annotation (insert or update if exists)
   */
  async upsertAnnotation({ userId, surveyId, period, constructName, constructTitle, annotationText, statistics }) {
    const query = `
      INSERT INTO public.annotations 
        (user_id, survey_id, period, construct_name, construct_title, annotation_text, statistics, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
      ON CONFLICT (user_id, survey_id, period, construct_name)
      DO UPDATE SET
        annotation_text = EXCLUDED.annotation_text,
        statistics = EXCLUDED.statistics,
        updated_at = now()
      RETURNING *
    `

    const result = await this.pool.query(query, [
      userId,
      surveyId,
      period,
      constructName,
      constructTitle,
      annotationText,
      JSON.stringify(statistics)
    ])

    return {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      surveyId: result.rows[0].survey_id,
      period: result.rows[0].period,
      constructName: result.rows[0].construct_name,
      constructTitle: result.rows[0].construct_title,
      annotationText: result.rows[0].annotation_text,
      statistics: result.rows[0].statistics,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at
    }
  }

  /**
   * Retrieves annotations for a user, survey, and period
   */
  async getAnnotations(userId, surveyId, period) {
    const query = `
      SELECT * FROM public.annotations
      WHERE user_id = $1 AND survey_id = $2 AND period = $3
      ORDER BY construct_name
    `

    const result = await this.pool.query(query, [userId, surveyId, period])
    return result.rows
      .map(row => ({
        id: row.id,
        userId: row.user_id,
        surveyId: row.survey_id,
        period: row.period,
        constructName: row.construct_name,
        constructTitle: row.construct_title,
        annotationText: row.annotation_text,
        statistics: row.statistics,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
      .filter(annotation => {
        // Filter out annotations with insufficient data
        // Check both the annotation text and the statistics trend type
        if (annotation.annotationText && annotation.annotationText.toLowerCase().includes('insufficient data')) {
          return false
        }
        if (annotation.statistics && annotation.statistics.trend && annotation.statistics.trend.type === 'insufficient_data') {
          return false
        }
        return true
      })
  }
}

export {
  AnnotationsService,
  TrendDetector,
  AnnotationGenerator,
  StatisticsCalculator
}


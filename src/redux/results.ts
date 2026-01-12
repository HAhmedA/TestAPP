import { createAsyncThunk } from '@reduxjs/toolkit'
// axios with credentials configured in src/index.tsx
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'

export const load = createAsyncThunk('results/load', async (id: string) => {
  // Fetch results rows for a given survey/post id
  const response = await axios.get(apiBaseAddress + '/results?postId=' + id)
  return response.data
})

export const post = createAsyncThunk('results/post', async (data: { postId: string, surveyResult: any, surveyResultText: string }) => {
  // Persist a survey result; backend stores the JSON payload in public.questionnaire_results
  const response = await axios.post(apiBaseAddress + '/post', data);
  return response.data
})

export interface ConstructStat {
  name: string
  title: string
  average: number | null
  min: number | null
  max: number | null
  count: number
}

export interface MoodData {
  period: string
  constructs: ConstructStat[]
  hasData: boolean
  totalResponses: number
}

export const loadStudentMood = createAsyncThunk(
  'results/loadStudentMood',
  async ({ surveyId, period }: { surveyId: string; period: 'today' | '7days' }) => {
    const response = await axios.get(apiBaseAddress + `/student/mood?surveyId=${surveyId}&period=${period}`)
    return response.data as MoodData
  }
)

export interface MoodHistoryData {
  constructs: Array<{ name: string; title: string }>
  data: Array<{
    date?: string
    time?: string
    timestamp?: string
    xLabel?: string
    [constructName: string]: string | number | null | undefined
  }>
  period?: string
}

export const loadStudentMoodHistory = createAsyncThunk(
  'results/loadStudentMoodHistory',
  async ({ surveyId, period }: { surveyId: string; period?: string }) => {
    const url = period
      ? `${apiBaseAddress}/student/mood/history?surveyId=${surveyId}&period=${period}`
      : `${apiBaseAddress}/student/mood/history?surveyId=${surveyId}`
    const response = await axios.get(url)
    return response.data as MoodHistoryData
  }
)

// Annotation types for SRL analysis
export interface Annotation {
  conceptKey: string
  timeWindow: '24h' | '7d'
  avgScore: number
  minScore: number
  maxScore: number
  responseCount: number
  trend: 'improving' | 'declining' | 'stable_high' | 'stable_avg' | 'stable_low'
  isInverted: boolean
  hasSufficientData: boolean
  distinctDayCount: number | null
  text: string
  computedAt: string
}

export interface AnnotationsResponse {
  annotations: Annotation[]
}

export const loadAnnotations = createAsyncThunk(
  'results/loadAnnotations',
  async (timeWindow?: '24h' | '7d') => {
    const url = timeWindow
      ? `${apiBaseAddress}/annotations?timeWindow=${timeWindow}`
      : `${apiBaseAddress}/annotations`
    const response = await axios.get(url)
    return response.data as AnnotationsResponse
  }
)

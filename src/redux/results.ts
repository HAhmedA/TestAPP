import { createAsyncThunk } from '@reduxjs/toolkit'
// axios with credentials configured in src/index.tsx
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'

export const load = createAsyncThunk('results/load', async (id: string) => {
    // Fetch results rows for a given survey/post id
    const response = await axios.get(apiBaseAddress + '/results?postId=' + id)
    return response.data
})

export const post = createAsyncThunk('results/post', async (data: {postId: string, surveyResult: any, surveyResultText: string}) => {
  // Persist a survey result; backend stores the JSON payload in public.results
  const response = await axios.post(apiBaseAddress + '/post', data);
  return response.data
})

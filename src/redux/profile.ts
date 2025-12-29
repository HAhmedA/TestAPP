import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import axios from 'axios'
import { apiBaseAddress } from '../models/survey'

export interface UserProfile {
  userId: string
  eduLevel: string | null
  fieldOfStudy: string | null
  major: string | null
  learningFormats: string[]
  disabilities: Record<string, string[]> | string[]
  createdAt: string
  updatedAt: string
}

interface ProfileState {
  profile: UserProfile | null
  status: 'idle' | 'loading' | 'succeeded' | 'failed'
  error: string | null
}

const initialState: ProfileState = {
  profile: null,
  status: 'idle',
  error: null
}

export const loadProfile = createAsyncThunk(
  'profile/load',
  async (_, { rejectWithValue }) => {
    try {
      const response = await axios.get(`${apiBaseAddress}/profile`)
      return response.data as UserProfile | null
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Failed to load profile')
    }
  }
)

export const saveProfile = createAsyncThunk(
  'profile/save',
  async (profileData: {
    eduLevel?: string
    fieldOfStudy?: string
    major?: string
    learningFormats?: string[]
    disabilities?: string[] | Record<string, string[]>
  }, { rejectWithValue }) => {
    try {
      const response = await axios.post(`${apiBaseAddress}/profile`, profileData)
      return response.data as UserProfile
    } catch (err: any) {
      return rejectWithValue(err.response?.data?.error || 'Failed to save profile')
    }
  }
)

const profileSlice = createSlice({
  name: 'profile',
  initialState,
  reducers: {
    clearProfile(state) {
      state.profile = null
      state.status = 'idle'
      state.error = null
    }
  },
  extraReducers(builder) {
    builder
      .addCase(loadProfile.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(loadProfile.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.profile = action.payload
        state.error = null
      })
      .addCase(loadProfile.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload as string || 'Failed to load profile'
      })
      .addCase(saveProfile.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(saveProfile.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.profile = action.payload
        state.error = null
      })
      .addCase(saveProfile.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload as string || 'Failed to save profile'
      })
  }
})

export const { clearProfile } = profileSlice.actions
export default profileSlice.reducer



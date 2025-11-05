import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
// axios is configured to send credentials in src/index.tsx
import axios from 'axios'
// Base API URL comes from REACT_APP_API_BASE or defaults to /api
import { apiBaseAddress } from '../models/survey'

export type UserRole = 'admin' | 'student'

export interface AuthUser {
    id: string
    role: UserRole
}

interface AuthState {
    user: AuthUser | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error?: string | null
}

const initialState: AuthState = {
    user: null,
    status: 'idle',
    error: null
}

export const login = createAsyncThunk('auth/login', async (role: UserRole) => {
    const response = await axios.post(apiBaseAddress + '/login', { role })
    return response.data as AuthUser
})

export const me = createAsyncThunk('auth/me', async () => {
    const response = await axios.get(apiBaseAddress + '/me')
    return response.data as AuthUser | null
})

export const logout = createAsyncThunk('auth/logout', async () => {
    await axios.post(apiBaseAddress + '/logout')
    return null
})

const authSlice = createSlice({
    name: 'auth',
    initialState,
    reducers: {
        setUser(state, action: PayloadAction<AuthUser | null>) {
            state.user = action.payload
        }
    },
    extraReducers(builder) {
        builder
            .addCase(login.pending, (state) => { state.status = 'loading' })
            .addCase(login.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload })
            .addCase(login.rejected, (state, action) => { state.status = 'failed'; state.error = action.error.message || null })
            .addCase(me.fulfilled, (state, action) => { state.user = action.payload })
            .addCase(logout.fulfilled, (state) => { state.user = null; state.status = 'idle' })
    }
})

export const { setUser } = authSlice.actions
export default authSlice.reducer



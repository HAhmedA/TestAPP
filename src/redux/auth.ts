import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
// axios is configured to send credentials in src/index.tsx
import axios from 'axios'
// Base API URL comes from REACT_APP_API_BASE or defaults to /api
import { API_BASE as apiBaseAddress } from '../api/client'

export type UserRole = 'admin' | 'student'

export interface AuthUser {
    id: string
    email: string
    name: string
    role?: UserRole // Optional for backwards compatibility
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

// Legacy role-based login (for backwards compatibility)
export const login = createAsyncThunk('auth/login', async (role: UserRole) => {
    const response = await axios.post(apiBaseAddress + '/auth/legacy-login', { role })
    return response.data as AuthUser
})

// Email/password login
export const loginEmailPassword = createAsyncThunk(
    'auth/loginEmailPassword',
    async ({ email, password }: { email: string; password: string }, { rejectWithValue }) => {
        try {
            const response = await axios.post(apiBaseAddress + '/auth/login', { email, password })
            return response.data as AuthUser
        } catch (err: any) {
            return rejectWithValue(err.response?.data?.error || 'Login failed')
        }
    }
)

// Registration
export const register = createAsyncThunk(
    'auth/register',
    async ({ name, email, password }: { name: string; email: string; password: string }, { rejectWithValue }) => {
        try {
            const response = await axios.post(apiBaseAddress + '/auth/register', { name, email, password })
            return response.data as AuthUser
        } catch (err: any) {
            return rejectWithValue(err.response?.data?.error || 'Registration failed')
        }
    }
)

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
            .addCase(login.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(login.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(login.rejected, (state, action) => { state.status = 'failed'; state.error = action.error.message || null })
            .addCase(loginEmailPassword.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(loginEmailPassword.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(loginEmailPassword.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload as string || 'Login failed' })
            .addCase(register.pending, (state) => { state.status = 'loading'; state.error = null })
            .addCase(register.fulfilled, (state, action) => { state.status = 'succeeded'; state.user = action.payload; state.error = null })
            .addCase(register.rejected, (state, action) => { state.status = 'failed'; state.error = action.payload as string || 'Registration failed' })
            .addCase(me.fulfilled, (state, action) => { state.user = action.payload })
            .addCase(logout.fulfilled, (state) => { state.user = null; state.status = 'idle'; state.error = null })
    }
})

export const { setUser } = authSlice.actions
export default authSlice.reducer



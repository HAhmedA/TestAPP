import { createAsyncThunk, createSlice } from '@reduxjs/toolkit'
import axios from 'axios'
import { API_BASE as apiBaseAddress } from '../api/client'
import { fetchLlmConfig as apiFetchLlmConfig, saveLlmConfig as apiSaveLlmConfig, testLlmConfig as apiTestLlmConfig } from '../api/llmConfig'
import type { LlmConfig, LlmTestResult } from '../api/llmConfig'

interface PromptData {
    prompt: string
    prompt_type: string
    updated_at: string | null
}

interface AdminState {
    systemPrompt: string
    alignmentPrompt: string
    systemLastUpdated: string | null
    alignmentLastUpdated: string | null
    status: 'idle' | 'loading' | 'succeeded' | 'failed'
    error: string | null
    llmConfig: LlmConfig | null
    llmConfigStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
    llmTestResult: LlmTestResult | null
    llmTestStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
}

const initialState: AdminState = {
    systemPrompt: 'Be Ethical',
    alignmentPrompt: 'Evaluate if the response is appropriate and follows instructions.',
    systemLastUpdated: null,
    alignmentLastUpdated: null,
    status: 'idle',
    error: null,
    llmConfig: null,
    llmConfigStatus: 'idle',
    llmTestResult: null,
    llmTestStatus: 'idle'
}

// Fetch all prompts (both types)
export const fetchPrompts = createAsyncThunk('admin/fetchPrompts', async () => {
    const response = await axios.get(apiBaseAddress + '/admin/prompts')
    return response.data
})

// Legacy fetch for backwards compatibility
export const fetchSystemPrompt = createAsyncThunk('admin/fetchSystemPrompt', async () => {
    const response = await axios.get(apiBaseAddress + '/admin/prompt?type=system')
    return response.data
})

// Update prompt by type
export const updatePrompt = createAsyncThunk(
    'admin/updatePrompt',
    async ({ prompt, type }: { prompt: string; type: 'system' | 'alignment' }) => {
        const response = await axios.put(apiBaseAddress + '/admin/prompt', { prompt, type })
        return response.data
    }
)

// Legacy update for backwards compatibility
export const updateSystemPrompt = createAsyncThunk('admin/updateSystemPrompt', async (prompt: string) => {
    const response = await axios.put(apiBaseAddress + '/admin/prompt', { prompt, type: 'system' })
    return response.data
})

export const fetchLlmConfig = createAsyncThunk('admin/fetchLlmConfig', async () => {
    const data = await apiFetchLlmConfig()
    return data
})

export const updateLlmConfig = createAsyncThunk(
    'admin/updateLlmConfig',
    async (cfg: Partial<LlmConfig>) => {
        const data = await apiSaveLlmConfig(cfg)
        return data
    }
)

export const testLlmConfigThunk = createAsyncThunk(
    'admin/testLlmConfig',
    async (cfg: Partial<LlmConfig>) => {
        const data = await apiTestLlmConfig(cfg)
        return data
    }
)

const adminSlice = createSlice({
    name: 'admin',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            // Fetch all prompts
            .addCase(fetchPrompts.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(fetchPrompts.fulfilled, (state, action) => {
                state.status = 'succeeded'
                if (action.payload.system) {
                    state.systemPrompt = action.payload.system.prompt || 'Be Ethical'
                    state.systemLastUpdated = action.payload.system.updated_at
                }
                if (action.payload.alignment) {
                    state.alignmentPrompt = action.payload.alignment.prompt || 'Evaluate if the response is appropriate.'
                    state.alignmentLastUpdated = action.payload.alignment.updated_at
                }
            })
            .addCase(fetchPrompts.rejected, (state) => {
                state.status = 'succeeded' // Don't show error, just use defaults
                state.error = null
            })
            // Fetch system prompt (legacy)
            .addCase(fetchSystemPrompt.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(fetchSystemPrompt.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.systemPrompt = action.payload.prompt || 'Be Ethical'
                state.systemLastUpdated = action.payload.updated_at
            })
            .addCase(fetchSystemPrompt.rejected, (state) => {
                state.status = 'succeeded'
                state.error = null
            })
            // Update prompt
            .addCase(updatePrompt.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(updatePrompt.fulfilled, (state, action) => {
                state.status = 'succeeded'
                const { prompt, prompt_type, updated_at } = action.payload
                if (prompt_type === 'system') {
                    state.systemPrompt = prompt
                    state.systemLastUpdated = updated_at
                } else if (prompt_type === 'alignment') {
                    state.alignmentPrompt = prompt
                    state.alignmentLastUpdated = updated_at
                }
            })
            .addCase(updatePrompt.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.error.message || 'Failed to update prompt'
            })
            // Update system prompt (legacy)
            .addCase(updateSystemPrompt.pending, (state) => {
                state.status = 'loading'
            })
            .addCase(updateSystemPrompt.fulfilled, (state, action) => {
                state.status = 'succeeded'
                state.systemPrompt = action.payload.prompt
                state.systemLastUpdated = action.payload.updated_at
            })
            .addCase(updateSystemPrompt.rejected, (state, action) => {
                state.status = 'failed'
                state.error = action.error.message || 'Failed to update system prompt'
            })
            // Fetch LLM config
            .addCase(fetchLlmConfig.pending, (state) => { state.llmConfigStatus = 'loading' })
            .addCase(fetchLlmConfig.fulfilled, (state, action) => {
                state.llmConfigStatus = 'succeeded'
                state.llmConfig = action.payload
            })
            .addCase(fetchLlmConfig.rejected, (state) => { state.llmConfigStatus = 'failed' })

            // Update LLM config
            .addCase(updateLlmConfig.pending, (state) => { state.llmConfigStatus = 'loading' })
            .addCase(updateLlmConfig.fulfilled, (state, action) => {
                state.llmConfigStatus = 'succeeded'
                state.llmConfig = action.payload
            })
            .addCase(updateLlmConfig.rejected, (state) => { state.llmConfigStatus = 'failed' })

            // Test LLM config
            .addCase(testLlmConfigThunk.pending, (state) => {
                state.llmTestStatus = 'loading'
                state.llmTestResult = null
            })
            .addCase(testLlmConfigThunk.fulfilled, (state, action) => {
                state.llmTestStatus = 'succeeded'
                state.llmTestResult = action.payload
            })
            .addCase(testLlmConfigThunk.rejected, (state) => { state.llmTestStatus = 'failed' })
    }
})

export default adminSlice.reducer


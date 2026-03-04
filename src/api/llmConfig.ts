// LLM Config API client — admin-only endpoints for reading and updating LLM provider configuration.
import { api } from './client'

export interface LlmConfig {
    provider: string
    baseUrl: string
    mainModel: string
    judgeModel: string
    maxTokens: number
    temperature: number
    timeoutMs: number
    apiKey: string          // "●●●●●●" if set, "" if not
    updatedAt: string | null
}

export interface LlmTestResult {
    success: boolean
    models: string[]
    latencyMs: number
    error?: string
}

export const fetchLlmConfig = () =>
    api.get<LlmConfig>('/admin/llm-config')

export const saveLlmConfig = (cfg: Partial<LlmConfig>) =>
    api.put<LlmConfig>('/admin/llm-config', cfg)

export const testLlmConfig = (cfg: Partial<LlmConfig>) =>
    api.post<LlmTestResult>('/admin/llm-config/test', cfg)

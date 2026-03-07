import { api } from './client'

export interface ChatMessage {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    created_at: string
}

export interface InitialChatResponse {
    greeting: string | null
    messages: ChatMessage[] | null
    sessionId: string
    hasExistingSession: boolean
    suggestedPrompts?: string[]
    success: boolean
}

export interface SendMessageResponse {
    response: string
    sessionId: string
    suggestedPrompts: string[]
    success: boolean
}

export interface HistoryResponse {
    messages: ChatMessage[]
    hasMore: boolean
}

export interface ResetChatResponse {
    sessionId: string
    greeting: string
    success: boolean
}

export const getInitialChat = () =>
    api.get<InitialChatResponse>('/chat/initial')

export const getHistory = (sessionId: string, limit = 20, before?: string) =>
    api.get<HistoryResponse>(
        `/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    )

export const sendMessage = (text: string) =>
    api.post<SendMessageResponse>('/chat/message', { message: text })

export const resetChat = () =>
    api.post<ResetChatResponse>('/chat/reset', {})

export const getChatStatus = () =>
    api.get<{ available: boolean; models: string[] }>('/chat/status')

export interface ChatbotPreferences {
    response_length: 'short' | 'medium' | 'long'
    tone: 'friendly' | 'formal' | 'motivational' | 'neutral'
    answer_style: 'bullets' | 'prose' | 'mixed'
}

export const getChatPreferences = () =>
    api.get<ChatbotPreferences>('/chat/preferences')

export const updateChatPreferences = (prefs: Partial<ChatbotPreferences>) =>
    api.put<ChatbotPreferences>('/chat/preferences', prefs)

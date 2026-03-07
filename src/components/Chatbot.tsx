import { useState, useEffect, useRef, useCallback } from 'react'
import './Chatbot.css'
import { getInitialChat, getHistory, sendMessage as sendMessageApi, resetChat, getChatStatus, getChatPreferences, updateChatPreferences, ChatbotPreferences } from '../api/chat'

interface Message {
    id: string
    role: 'user' | 'assistant' | 'system'
    content: string
    created_at: string
    isError?: boolean
    failedMessage?: string
}

interface ChatbotProps {
    isLoggedIn: boolean
}

// Default suggested prompts (fallback when dynamic prompts unavailable)
const DEFAULT_PROMPTS = [
    "What are the best studying strategies based on my profile?",
    "Analyze my SRL data",
    "What are my learning trends?",
    "How can I improve based on my history?"
]

const Chatbot = ({ isLoggedIn }: ChatbotProps) => {
    const [isOpen, setIsOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [inputValue, setInputValue] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [hasMore, setHasMore] = useState(false)
    const [isLoadingMore, setIsLoadingMore] = useState(false)
    const [cooldown, setCooldown] = useState(false)

    // Enhancement states
    const [hasUnread, setHasUnread] = useState(false)
    const [cachedGreeting, setCachedGreeting] = useState<{ greeting: string | null, sessionId: string, messages: Message[] | null } | null>(null)
    const [isPrefetching, setIsPrefetching] = useState(false)

    // New UX improvement states
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const [isAwaitingResponse, setIsAwaitingResponse] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>(DEFAULT_PROMPTS)

    // LLM availability status (null = unknown/loading)
    const [llmAvailable, setLlmAvailable] = useState<boolean | null>(null)

    // "Need help?" pill — shown briefly on login
    const [showHiPill, setShowHiPill] = useState(false)

    // Settings panel + persona preferences
    const [activeView, setActiveView] = useState<'messages' | 'settings'>('messages')
    const [preferences, setPreferences] = useState<ChatbotPreferences | null>(null)
    const [isSavingPrefs, setIsSavingPrefs] = useState(false)

    // Proactive data-update banner
    const [dataUpdateBanner, setDataUpdateBanner] = useState<{ dataType: string } | null>(null)

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Ref to prevent race conditions on greeting fetch
    const isFetchingRef = useRef(false)

    // Scroll to bottom of messages
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    // Show "Need help?" pill on login, auto-hide after 10s
    useEffect(() => {
        if (!isLoggedIn) return
        setShowHiPill(true)
        const t = setTimeout(() => setShowHiPill(false), 10000)
        return () => clearTimeout(t)
    }, [isLoggedIn])

    // Poll LLM availability every 30 seconds while logged in
    useEffect(() => {
        if (!isLoggedIn) return
        const check = () => {
            getChatStatus()
                .then(r => setLlmAvailable(r.available))
                .catch(() => setLlmAvailable(false))
        }
        check()
        const interval = setInterval(check, 30000)
        return () => clearInterval(interval)
    }, [isLoggedIn])

    // Pre-fetch greeting on login (before chat is opened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (isLoggedIn && !cachedGreeting && !isPrefetching && !isFetchingRef.current) {
            prefetchGreeting()
        }
    }, [isLoggedIn]) // Only trigger on login state change

    // When chat opens, use cached greeting if available
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (isOpen && isLoggedIn && messages.length === 0) {
            if (cachedGreeting) {
                setSessionId(cachedGreeting.sessionId)

                if (cachedGreeting.messages && cachedGreeting.messages.length > 0) {
                    // Existing session - restore cached messages
                    setMessages(cachedGreeting.messages)
                } else if (cachedGreeting.greeting) {
                    // New session - use greeting
                    setMessages([{
                        id: 'initial',
                        role: 'assistant',
                        content: cachedGreeting.greeting,
                        created_at: new Date().toISOString()
                    }])
                }
                setHasUnread(false) // Clear badge when chat is opened
            } else if (!isFetchingRef.current) {
                // Fetch if not already fetching
                loadInitialGreeting()
            }
        }
    }, [isOpen, isLoggedIn, cachedGreeting]) // Only trigger when chat opens or greeting is cached

    // Clear unread badge when chat is opened
    useEffect(() => {
        if (isOpen) {
            setHasUnread(false)
        }
    }, [isOpen])

    // Load preferences once when chat opens for the first time
    useEffect(() => {
        if (isOpen && isLoggedIn && !preferences) {
            getChatPreferences().then(setPreferences).catch(console.error)
        }
    }, [isOpen, isLoggedIn, preferences])

    // Listen for data-submission events from other pages/components
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { dataType: string }
            setDataUpdateBanner({ dataType: detail.dataType })
            if (!isOpen) setHasUnread(true)
        }
        window.addEventListener('chatbot:dataUpdated', handler)
        return () => window.removeEventListener('chatbot:dataUpdated', handler)
    }, [isOpen])

    // Scroll to bottom when messages change or when chat opens
    useEffect(() => {
        if (isOpen && messages.length > 0) {
            scrollToBottom()
        }
    }, [messages, isOpen, scrollToBottom])

    // Focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus()
        }
    }, [isOpen])

    // Pre-fetch greeting in background (on login) with race condition protection
    const prefetchGreeting = async () => {
        if (isFetchingRef.current) return
        isFetchingRef.current = true
        setIsPrefetching(true)
        try {
            const data = await getInitialChat()

            if (data.hasExistingSession && data.messages) {
                // Existing session with messages - cache them, no badge (user already saw them)
                setCachedGreeting({
                    greeting: null,
                    sessionId: data.sessionId,
                    messages: data.messages
                })
                // Don't show badge for existing session (user already saw these messages)
            } else if (data.greeting) {
                // New session with fresh greeting - show badge
                setCachedGreeting({
                    greeting: data.greeting,
                    sessionId: data.sessionId,
                    messages: null
                })
                // Update suggested prompts if provided
                if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                    setSuggestedPrompts(data.suggestedPrompts)
                }
                // Show unread badge since we have a NEW message ready
                setHasUnread(true)
            }
        } catch (error) {
            console.error('Failed to prefetch greeting:', error)
            // Will fall back to loading on open
        } finally {
            setIsPrefetching(false)
            isFetchingRef.current = false
        }
    }

    const loadInitialGreeting = async () => {
        if (isFetchingRef.current) return
        isFetchingRef.current = true
        setIsLoading(true)
        try {
            const data = await getInitialChat()

            setSessionId(data.sessionId)

            if (data.hasExistingSession && data.messages) {
                // Existing session - restore messages
                setMessages(data.messages.map((msg: { id: string; role: string; content: string; created_at: string }) => ({
                    id: msg.id,
                    role: msg.role as 'user' | 'assistant' | 'system',
                    content: msg.content,
                    created_at: msg.created_at
                })))
            } else if (data.greeting) {
                // New session with greeting
                setMessages([{
                    id: 'initial',
                    role: 'assistant',
                    content: data.greeting,
                    created_at: new Date().toISOString()
                }])
                // Update suggested prompts if provided
                if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                    setSuggestedPrompts(data.suggestedPrompts)
                }
            }
        } catch (error) {
            console.error('Failed to load initial greeting:', error)
            setMessages([{
                id: 'error',
                role: 'assistant',
                content: "Hello! I'm here to help you with your learning journey. How can I assist you today?",
                created_at: new Date().toISOString()
            }])
        } finally {
            setIsLoading(false)
            isFetchingRef.current = false
        }
    }

    const loadMoreHistory = async () => {
        if (!sessionId || isLoadingMore || !hasMore) return

        setIsLoadingMore(true)
        const oldestMessage = messages[0]

        try {
            const data = await getHistory(sessionId, 20, oldestMessage?.id)

            if (data.messages && data.messages.length > 0) {
                setMessages(prev => [...data.messages, ...prev])
                setHasMore(data.hasMore)
            } else {
                setHasMore(false)
            }
        } catch (error) {
            console.error('Failed to load history:', error)
        } finally {
            setIsLoadingMore(false)
        }
    }

    const handleScroll = () => {
        const container = messagesContainerRef.current
        if (container && container.scrollTop === 0 && hasMore && !isLoadingMore) {
            loadMoreHistory()
        }
    }

    const sendMessage = async () => {
        if (!inputValue.trim() || isLoading || cooldown) return

        const userMessage = inputValue.trim()
        setInputValue('')

        // Add user message immediately
        const userMsgId = `user-${Date.now()}`
        setMessages(prev => [...prev, {
            id: userMsgId,
            role: 'user',
            content: userMessage,
            created_at: new Date().toISOString()
        }])

        // Start cooldown (short guard to prevent accidental double-send)
        setCooldown(true)
        setTimeout(() => setCooldown(false), 500)

        setIsLoading(true)
        setIsAwaitingResponse(true) // Always trigger await, regardless of chat state

        try {
            const data = await sendMessageApi(userMessage)

            if (data.sessionId) {
                setSessionId(data.sessionId)
            }

            setMessages(prev => [...prev, {
                id: `assistant-${Date.now()}`,
                role: 'assistant',
                content: data.response || "I couldn't process that. Please try again.",
                created_at: new Date().toISOString()
            }])

            // Update suggested prompts with dynamic ones from API (or keep defaults)
            if (data.suggestedPrompts && Array.isArray(data.suggestedPrompts) && data.suggestedPrompts.length > 0) {
                setSuggestedPrompts(data.suggestedPrompts)
            }

            // If chat is closed, show unread badge
            if (!isOpen) {
                setHasUnread(true)
            }
        } catch (error) {
            console.error('Failed to send message:', error)
            setMessages(prev => [...prev, {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: "Something went wrong. Please try again.",
                created_at: new Date().toISOString(),
                isError: true,
                failedMessage: userMessage
            }])
        } finally {
            setIsLoading(false)
            setIsAwaitingResponse(false)
        }
    }

    // Retry failed message
    const handleRetry = (msg: Message) => {
        if (!msg.failedMessage) return
        // Remove the error message
        setMessages(prev => prev.filter(m => m.id !== msg.id))
        // Set input and send
        setInputValue(msg.failedMessage)
        setTimeout(() => {
            const input = inputRef.current
            if (input) {
                // Manually trigger send since state update is async
                sendMessage()
            }
        }, 50)
    }

    // Handle suggested prompt click
    const handleSuggestedPrompt = (prompt: string) => {
        // Optimistically remove the used prompt
        setSuggestedPrompts(prev => prev.filter(p => p !== prompt))
        setInputValue(prompt)
        setTimeout(sendMessage, 50)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    // Reset button click - show confirmation if messages exist
    const handleResetClick = () => {
        if (messages.length > 1) {
            setShowResetConfirm(true)
        } else {
            handleReset()
        }
    }

    const handleReset = async () => {
        if (isLoading || isResetting) return
        setShowResetConfirm(false)
        setIsResetting(true)
        setIsLoading(true)

        try {
            const data = await resetChat()

            if (data.success) {
                setSessionId(data.sessionId)
                setMessages([{
                    id: 'reset-greeting',
                    role: 'assistant',
                    content: data.greeting,
                    created_at: new Date().toISOString()
                }])
                setHasMore(false)
                // Clear cached greeting so we get fresh one next time
                setCachedGreeting(null)
                // Reset suggested prompts to defaults
                setSuggestedPrompts(DEFAULT_PROMPTS)
            }
        } catch (error) {
            console.error('Failed to reset session:', error)
        } finally {
            setIsLoading(false)
            setIsResetting(false)
        }
    }

    const handleRefreshSummary = () => {
        const dataType = dataUpdateBanner?.dataType ?? 'latest'
        setDataUpdateBanner(null)
        setActiveView('messages')
        setInputValue(`Please give me an updated summary based on my latest ${dataType} data`)
        setTimeout(sendMessage, 50)
    }

    const handlePreferenceChange = async (key: keyof ChatbotPreferences, value: string) => {
        setPreferences(prev => prev ? { ...prev, [key]: value } : null)
        setIsSavingPrefs(true)
        try {
            const updated = await updateChatPreferences({ [key]: value })
            setPreferences(updated)
        } catch (err) {
            console.error('Failed to save preference:', err)
        } finally {
            setIsSavingPrefs(false)
        }
    }

    const toggleChat = () => {
        setIsOpen(!isOpen)
    }

    // Don't render if not logged in
    if (!isLoggedIn) return null

    return (
        <div className={`chatbot-container ${isOpen ? 'open' : ''}`}>
            {/* "Need help?" pill */}
            {showHiPill && !isOpen && (
                <div className="chatbot-hi-pill" onClick={toggleChat}>Need help? 💬</div>
            )}

            {/* Floating bubble button */}
            <button
                className="chatbot-bubble"
                onClick={() => { toggleChat(); setShowHiPill(false) }}
                aria-label={isOpen ? 'Close chat' : 'Open chat'}
            >
                {hasUnread && !isOpen && (
                    <span className="chatbot-badge" aria-label="New message" />
                )}
                {isAwaitingResponse && !isOpen && (
                    <span className="chatbot-processing-indicator" aria-label="Processing" />
                )}
                {isOpen ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                ) : (
                    /* Robot face icon */
                    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
                        {/* Antenna */}
                        <line x1="13" y1="2" x2="13" y2="6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="13" cy="2" r="1.5" fill="white"/>
                        {/* Head */}
                        <rect x="4" y="7" width="18" height="14" rx="3" fill="white" fillOpacity="0.9"/>
                        {/* Eyes */}
                        <circle cx="9.5" cy="13" r="2" fill="#0891B2"/>
                        <circle cx="16.5" cy="13" r="2" fill="#0891B2"/>
                        {/* Mouth */}
                        <rect x="9" y="17" width="8" height="2" rx="1" fill="#0891B2"/>
                        {/* Ear nubs */}
                        <rect x="1" y="11" width="3" height="4" rx="1.5" fill="white" fillOpacity="0.7"/>
                        <rect x="22" y="11" width="3" height="4" rx="1.5" fill="white" fillOpacity="0.7"/>
                    </svg>
                )}
            </button>

            {/* Chat window */}
            {isOpen && (
                <div className="chatbot-window">
                    <div className="chatbot-header">
                        <div className="chatbot-header-info">
                            <div className="chatbot-avatar">🎓</div>
                            <div className="chatbot-header-text">
                                <h3>Learning Assistant</h3>
                                <span className={`chatbot-status ${llmAvailable === false ? 'chatbot-status--offline' : ''}`}>
                                    {llmAvailable === null ? 'Checking…' : llmAvailable ? 'Online' : 'Offline'}
                                </span>
                            </div>
                        </div>
                        <button
                            className="chatbot-reset-btn"
                            onClick={handleResetClick}
                            disabled={isLoading || isResetting}
                            title="Start a new conversation"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 4V1L8 5L12 9V6C15.31 6 18 8.69 18 12C18 13.01 17.75 13.97 17.3 14.8L18.76 16.26C19.54 15.03 20 13.57 20 12C20 7.58 16.42 4 12 4ZM12 18C8.69 18 6 15.31 6 12C6 10.99 6.25 10.03 6.7 9.2L5.24 7.74C4.46 8.97 4 10.43 4 12C4 16.42 7.58 20 12 20V23L16 19L12 15V18Z" fill="currentColor" />
                            </svg>
                            <span>New Chat</span>
                        </button>
                        <button
                            className={`chatbot-gear-btn${activeView === 'settings' ? ' active' : ''}`}
                            onClick={() => setActiveView(v => v === 'settings' ? 'messages' : 'settings')}
                            title="Chatbot settings"
                            aria-label="Chatbot settings"
                        >
                            ⚙
                        </button>
                    </div>

                    {activeView === 'settings' ? (
                        <div className="chatbot-settings-panel">
                            <button
                                className="chatbot-settings-back"
                                onClick={() => setActiveView('messages')}
                            >
                                ← Back to chat
                            </button>
                            <h4 className="chatbot-settings-title">Assistant Settings</h4>
                            {isSavingPrefs && <p className="chatbot-settings-saving">Saving…</p>}

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Response Length</label>
                                <div className="chatbot-settings-options">
                                    {(['short', 'medium', 'long'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.response_length === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('response_length', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Tone</label>
                                <div className="chatbot-settings-options">
                                    {(['friendly', 'formal', 'motivational', 'neutral'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.tone === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('tone', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="chatbot-settings-group">
                                <label className="chatbot-settings-label">Answer Style</label>
                                <div className="chatbot-settings-options">
                                    {(['bullets', 'prose', 'mixed'] as const).map(opt => (
                                        <button
                                            key={opt}
                                            className={`chatbot-settings-option${preferences?.answer_style === opt ? ' selected' : ''}`}
                                            onClick={() => handlePreferenceChange('answer_style', opt)}
                                        >
                                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                    <div
                        className="chatbot-messages"
                        ref={messagesContainerRef}
                        onScroll={handleScroll}
                    >
                        {/* Data update banner */}
                        {dataUpdateBanner && (
                            <div className="chatbot-data-banner">
                                <span>Your {dataUpdateBanner.dataType} data was just updated.</span>
                                <button className="chatbot-data-banner-refresh" onClick={handleRefreshSummary}>
                                    Refresh my summary
                                </button>
                                <button
                                    className="chatbot-data-banner-dismiss"
                                    onClick={() => setDataUpdateBanner(null)}
                                    aria-label="Dismiss"
                                >
                                    ✕
                                </button>
                            </div>
                        )}

                        {/* Initial loading spinner */}
                        {messages.length === 0 && (isPrefetching || isLoading) && !isResetting && (
                            <div className="chatbot-initial-loading">
                                <div className="chatbot-spinner" />
                                <p>Loading your assistant...</p>
                            </div>
                        )}

                        {/* Reset loading spinner */}
                        {isResetting && (
                            <div className="chatbot-reset-loading">
                                <div className="chatbot-spinner" />
                                <p>Starting fresh conversation...</p>
                            </div>
                        )}

                        {/* Pagination affordance */}
                        {hasMore && !isLoadingMore && (
                            <button className="chatbot-load-more" onClick={loadMoreHistory}>
                                ↑ Load earlier messages
                            </button>
                        )}

                        {isLoadingMore && (
                            <div className="chatbot-loading-more">Loading older messages...</div>
                        )}

                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`chatbot-message ${msg.role}${msg.isError ? ' error' : ''}`}
                            >
                                <div className="chatbot-message-content">
                                    {msg.content}
                                </div>
                                {/* Retry button for error messages */}
                                {msg.isError && msg.failedMessage && (
                                    <button
                                        className="chatbot-retry-btn"
                                        onClick={() => handleRetry(msg)}
                                    >
                                        ↻ Retry
                                    </button>
                                )}
                            </div>
                        ))}

                        {/* Suggested prompts - shows when input is empty and not loading */}
                        {!isLoading && !inputValue.trim() && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && (
                            <div className="chatbot-suggestions">
                                <p className="suggestions-label">Try asking:</p>
                                <div className="suggestions-list">
                                    {suggestedPrompts.map((prompt, idx) => (
                                        <button
                                            key={idx}
                                            className="suggestion-chip"
                                            onClick={() => handleSuggestedPrompt(prompt)}
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {isLoading && !isResetting && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                            <div className="chatbot-message assistant">
                                <div className="chatbot-message-content typing">
                                    <span className="typing-dot"></span>
                                    <span className="typing-dot"></span>
                                    <span className="typing-dot"></span>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>
                    )}

                    <div className="chatbot-input-container">
                        <input
                            ref={inputRef}
                            type="text"
                            className="chatbot-input"
                            placeholder="Type a message..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading || isResetting}
                            maxLength={5000}
                        />
                        <button
                            className="chatbot-send-btn"
                            onClick={sendMessage}
                            disabled={isLoading || isResetting || !inputValue.trim() || cooldown}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                    </div>

                    {/* Reset confirmation dialog */}
                    {showResetConfirm && (
                        <div className="chatbot-confirm-overlay">
                            <div className="chatbot-confirm-dialog">
                                <p>Start a new conversation?</p>
                                <span className="confirm-subtitle">Your current chat will be cleared.</span>
                                <div className="chatbot-confirm-buttons">
                                    <button onClick={() => setShowResetConfirm(false)}>Cancel</button>
                                    <button onClick={handleReset} className="confirm-btn">Reset</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

export default Chatbot

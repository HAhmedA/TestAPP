import { useState, useEffect, useRef, useCallback } from 'react'
import './Chatbot.css'
import { getInitialChat, getHistory, sendMessage as sendMessageApi, resetChat } from '../api/chat'

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

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const messagesContainerRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Ref to prevent race conditions on greeting fetch
    const isFetchingRef = useRef(false)

    // Scroll to bottom of messages
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

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

        // Start cooldown
        setCooldown(true)
        setTimeout(() => setCooldown(false), 1500)

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

    const toggleChat = () => {
        setIsOpen(!isOpen)
    }

    // Don't render if not logged in
    if (!isLoggedIn) return null

    return (
        <div className={`chatbot-container ${isOpen ? 'open' : ''}`}>
            {/* Floating bubble button */}
            <button
                className="chatbot-bubble"
                onClick={toggleChat}
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
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7118 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1801 20.0034 9.87812 19.6951 8.7 19.1L3 21L4.9 15.3C4.30493 14.1219 3.99656 12.8199 4 11.5C4.00061 9.92179 4.44061 8.37488 5.27072 7.03258C6.10083 5.69028 7.28825 4.6056 8.7 3.90003C9.87812 3.30496 11.1801 2.99659 12.5 3.00003H13C15.0843 3.11502 17.053 3.99479 18.5291 5.47089C20.0052 6.94699 20.885 8.91568 21 11V11.5Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                                <span className="chatbot-status">Online</span>
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
                    </div>

                    <div
                        className="chatbot-messages"
                        ref={messagesContainerRef}
                        onScroll={handleScroll}
                    >
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

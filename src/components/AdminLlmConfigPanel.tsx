// Admin panel for configuring the LLM API provider on the fly.
// Collapsible, same visual pattern as AdminClusterDiagnosticsPanel.
import React, { useState, useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import type { AppDispatch, RootState } from '../redux/index'
import { fetchLlmConfig, updateLlmConfig, testLlmConfig } from '../redux/admin'
import type { LlmConfig } from '../api/llmConfig'

const PROVIDERS = ['lmstudio', 'openai', 'groq', 'other']

const AdminLlmConfigPanel: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>()
    const { llmConfig, llmConfigStatus, llmConfigError, llmTestResult, llmTestStatus, llmTestError } = useSelector(
        (state: RootState) => state.admin
    )

    const [open, setOpen] = useState(false)
    const [form, setForm] = useState<Partial<LlmConfig>>({})
    const [showKey, setShowKey] = useState(false)
    const [saveMsg, setSaveMsg] = useState<string | null>(null)
    const [saveFailed, setSaveFailed] = useState(false)

    useEffect(() => { dispatch(fetchLlmConfig()) }, [dispatch])

    useEffect(() => {
        if (llmConfig) setForm(llmConfig)
    }, [llmConfig])

    const set = (field: keyof LlmConfig, value: unknown) =>
        setForm(prev => ({ ...prev, [field]: value }))

    const handleTest = () => {
        setSaveMsg(null)
        dispatch(testLlmConfig(form))
    }

    const handleSave = async () => {
        setSaveMsg(null)
        setSaveFailed(false)
        const result = await dispatch(updateLlmConfig(form))
        if (updateLlmConfig.fulfilled.match(result)) {
            setSaveMsg('Configuration saved.')
            setSaveFailed(false)
        } else {
            // Extract error from the result directly to avoid stale closure on llmConfigError
            const errMsg = (result.payload as string) ?? (result.error?.message) ?? 'Save failed.'
            setSaveMsg(errMsg)
            setSaveFailed(true)
        }
    }

    const panelStyle: React.CSSProperties = {
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 8,
        marginBottom: 16, overflow: 'hidden'
    }
    const headerStyle: React.CSSProperties = {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
        background: '#16213e', color: '#e0e0e0'
    }
    const bodyStyle: React.CSSProperties = {
        padding: '16px', display: 'grid', gap: 12, color: '#ccc'
    }
    const inputStyle: React.CSSProperties = {
        background: '#0f0f23', border: '1px solid #444', borderRadius: 4,
        color: '#e0e0e0', padding: '6px 10px', width: '100%', boxSizing: 'border-box'
    }
    const labelStyle: React.CSSProperties = { fontSize: 12, color: '#888', marginBottom: 4, display: 'block' }
    const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }
    const btnStyle = (color: string): React.CSSProperties => ({
        background: color, color: '#fff', border: 'none', borderRadius: 4,
        padding: '8px 16px', cursor: 'pointer', fontWeight: 600
    })

    return (
        <div style={panelStyle}>
            <div style={headerStyle} onClick={() => setOpen(o => !o)}
                tabIndex={0} role="button"
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setOpen(o => !o)}>
                <span>{open ? '▼' : '▶'} LLM API Configuration</span>
                {llmConfig?.updatedAt && (
                    <span style={{ fontSize: 11, color: '#888' }}>
                        last updated: {new Date(llmConfig.updatedAt).toLocaleString()}
                    </span>
                )}
            </div>

            {open && (
                <div style={bodyStyle}>
                    <div>
                        <label style={labelStyle}>Provider</label>
                        <select value={form.provider || ''} onChange={e => set('provider', e.target.value)}
                            style={{ ...inputStyle }}>
                            <option value="" disabled>-- select provider --</option>
                            {PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>

                    <div>
                        <label style={labelStyle}>Base URL</label>
                        <input style={inputStyle} value={form.baseUrl || ''}
                            onChange={e => set('baseUrl', e.target.value)} />
                    </div>

                    <div style={rowStyle}>
                        <div>
                            <label style={labelStyle}>Main Model</label>
                            <input style={inputStyle} value={form.mainModel || ''}
                                onChange={e => set('mainModel', e.target.value)} />
                        </div>
                        <div>
                            <label style={labelStyle}>Judge Model</label>
                            <input style={inputStyle} value={form.judgeModel || ''}
                                onChange={e => set('judgeModel', e.target.value)} />
                        </div>
                    </div>

                    <div>
                        <label style={labelStyle}>API Key</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input style={{ ...inputStyle, flex: 1 }}
                                type={showKey ? 'text' : 'password'}
                                value={form.apiKey || ''}
                                onChange={e => set('apiKey', e.target.value)} />
                            <button style={{ ...btnStyle('#333'), padding: '6px 12px' }}
                                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                                onClick={() => setShowKey(s => !s)}>
                                {showKey ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>

                    <div style={rowStyle}>
                        <div>
                            <label style={labelStyle}>Max Tokens</label>
                            <input style={inputStyle} type="number"
                                value={form.maxTokens ?? ''}
                                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) set('maxTokens', v) }} />
                        </div>
                        <div>
                            <label style={labelStyle}>Temperature</label>
                            <input style={inputStyle} type="number" step="0.1" min="0" max="2"
                                value={form.temperature ?? ''}
                                onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) set('temperature', v) }} />
                        </div>
                        <div>
                            <label style={labelStyle}>Timeout (ms)</label>
                            <input style={inputStyle} type="number"
                                value={form.timeoutMs ?? ''}
                                onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) set('timeoutMs', v) }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button style={btnStyle('#2d5a8e')} onClick={handleTest}
                            disabled={llmTestStatus === 'loading'}>
                            {llmTestStatus === 'loading' ? 'Testing…' : 'Test Connection'}
                        </button>
                        <button style={btnStyle('#2e7d32')} onClick={handleSave}
                            disabled={llmConfigStatus === 'loading'}>
                            {llmConfigStatus === 'loading' ? 'Saving…' : 'Save Configuration'}
                        </button>

                        {llmTestResult && (
                            <span style={{ color: llmTestResult.success ? '#66bb6a' : '#ef5350', fontSize: 13 }}>
                                {llmTestResult.success
                                    ? `✓ Connected — ${llmTestResult.models.length} models (${llmTestResult.latencyMs}ms)`
                                    : `✗ Failed — ${llmTestResult.error ?? llmTestError ?? 'Unknown error'}`}
                            </span>
                        )}
                        {saveMsg && (
                            <span style={{ color: saveFailed ? '#ef5350' : '#66bb6a', fontSize: 13 }}>
                                {saveMsg}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default AdminLlmConfigPanel

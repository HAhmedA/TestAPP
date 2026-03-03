// AdminCsvLogPanel — Moodle CSV activity log upload and participant mapping UI.
// Three phases: Upload → Mapping → Import Result.

import { useState, useEffect } from 'react'
import {
    uploadCsvLog, getCsvMappings, createCsvMapping, deleteCsvMapping,
    deleteCsvMappingWithData, importCsvLog,
    type CsvUploadResult, type CsvMapping, type CsvImportResult
} from '../api/csvLog'

// -- Types --

interface AppStudent {
    id: string
    email: string
    name: string
}

type Phase = 'upload' | 'mapping' | 'result'

// -- Component --

const AdminCsvLogPanel = () => {
    const [phase, setPhase]           = useState<Phase>('upload')
    const [uploading, setUploading]   = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)
    const [uploadResult, setUploadResult] = useState<CsvUploadResult | null>(null)

    // Mapping state
    const [appStudents, setAppStudents]   = useState<AppStudent[]>([])
    const [mappings, setMappings]         = useState<CsvMapping[]>([])
    const [selectedEmail, setSelectedEmail] = useState<string | null>(null)
    const [selectedCsvName, setSelectedCsvName] = useState<string | null>(null)
    const [searchA, setSearchA]           = useState('')
    const [searchB, setSearchB]           = useState('')
    const [pairLoading, setPairLoading]   = useState(false)

    // Import state
    const [importing, setImporting]         = useState(false)
    const [importResult, setImportResult]   = useState<CsvImportResult | null>(null)
    const [importError, setImportError]     = useState<string | null>(null)

    // Load app students and existing mappings on mount
    useEffect(() => {
        fetch('/api/admin/students', { credentials: 'include' })
            .then(r => r.json())
            .then(d => setAppStudents(d.students || []))
            .catch(() => {})

        getCsvMappings()
            .then(d => setMappings(d.mappings))
            .catch(() => {})
    }, [])

    // -- Derived sets --
    const pairedEmails   = new Set(mappings.map(m => m.user_id))
    const pairedCsvNames = new Set(mappings.map(m => m.csv_name))

    // CSV names from current upload (merge with mappings for full list B)
    const csvNames: string[] = uploadResult
        ? uploadResult.csvNames
        : Array.from(new Set(mappings.map(m => m.csv_name)))

    const filteredStudents = appStudents
        .filter(s => !pairedEmails.has(s.id) && s.email.toLowerCase().includes(searchA.toLowerCase()))
        .sort((a, b) => (a.email === selectedEmail ? -1 : b.email === selectedEmail ? 1 : 0))
    const filteredCsvNames = csvNames
        .filter(n => !pairedCsvNames.has(n) && n.toLowerCase().includes(searchB.toLowerCase()))
        .sort((a, b) => (a === selectedCsvName ? -1 : b === selectedCsvName ? 1 : 0))

    // Auto-select the first item in each list when no selection exists.
    // Deps use list length, not the full array, to avoid triggering on every
    // render. This fires on initial load, on phase change, and after a pair is
    // made (when the list shrinks by one and selections are cleared).
    // NOT adding selectedEmail/selectedCsvName to deps intentionally — we only
    // want to auto-select on structural list changes, not when the user explicitly
    // deselects an item by clicking it again.
    useEffect(() => {
        if (phase !== 'mapping') return
        if (!selectedEmail && filteredStudents.length > 0)
            setSelectedEmail(filteredStudents[0].email)
    }, [phase, filteredStudents.length])  // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (phase !== 'mapping') return
        if (!selectedCsvName && filteredCsvNames.length > 0)
            setSelectedCsvName(filteredCsvNames[0])
    }, [phase, filteredCsvNames.length])  // eslint-disable-line react-hooks/exhaustive-deps

    // -- Handlers --

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        setUploading(true)
        setUploadError(null)
        try {
            const result = await uploadCsvLog(file)
            setUploadResult(result)
            // Merge existing mappings returned in upload response
            const incoming = Object.entries(result.existingMappings).map(([csv_name, m]) => ({
                id: '', csv_name, user_id: m.userId, email: m.email, created_at: ''
            } as CsvMapping))
            setMappings(prev => {
                const existing = prev.filter(p => !result.existingMappings[p.csv_name])
                return [...existing, ...incoming]
            })
            setPhase('mapping')
        } catch (err: any) {
            setUploadError(err.message || 'Upload failed')
        } finally {
            setUploading(false)
        }
    }

    const handleMakePair = async () => {
        if (!selectedEmail || !selectedCsvName) return
        const student = appStudents.find(s => s.email === selectedEmail)
        if (!student) return

        setPairLoading(true)
        try {
            const result = await createCsvMapping(selectedCsvName, student.id)
            setMappings(prev => {
                const filtered = prev.filter(m => m.csv_name !== selectedCsvName)
                return [...filtered, result.mapping]
            })
            setSelectedEmail(null)
            setSelectedCsvName(null)
        } catch (err: any) {
            alert(`Could not create pair: ${err.message}`)
        } finally {
            setPairLoading(false)
        }
    }

    const handleDeletePair = async (csvName: string) => {
        try {
            await deleteCsvMapping(csvName)
            setMappings(prev => prev.filter(m => m.csv_name !== csvName))
        } catch (err: any) {
            alert(`Could not remove pair: ${err.message}`)
        }
    }

    const handleDeletePairWithData = async (csvName: string, email: string) => {
        if (!window.confirm(
            `Delete pair AND all imported LMS sessions for ${email}?\n\nThis cannot be undone.`
        )) return
        try {
            const result = await deleteCsvMappingWithData(csvName)
            setMappings(prev => prev.filter(m => m.csv_name !== csvName))
            alert(`Removed pair and ${result.sessionsDeleted} LMS session row${result.sessionsDeleted !== 1 ? 's' : ''} for ${email}.`)
        } catch (err: any) {
            alert(`Could not wipe data: ${err.message}`)
        }
    }

    const handleImport = async () => {
        if (!uploadResult) return
        setImporting(true)
        setImportError(null)
        try {
            const result = await importCsvLog(uploadResult.uploadId)
            setImportResult(result)
            setPhase('result')
        } catch (err: any) {
            setImportError(err.message || 'Import failed')
        } finally {
            setImporting(false)
        }
    }

    const handleReset = () => {
        setPhase('upload')
        setUploadResult(null)
        setImportResult(null)
        setUploadError(null)
        setImportError(null)
        setSelectedEmail(null)
        setSelectedCsvName(null)
    }

    const pairedCount = mappings.length

    // -- Render --

    return (
        <div className='admin-csv-panel'>
            <h3 className='admin-csv-title'>Moodle Activity Log Import</h3>

            {/* ── PHASE: Upload ── */}
            {phase === 'upload' && (
                <div className='admin-csv-upload-zone'>
                    <p className='admin-csv-hint'>
                        Export the course activity log from Moodle (CSV format) and upload it here.
                        Student names will be matched to app accounts using the mapping below.
                    </p>
                    <label className='admin-csv-file-label'>
                        <input
                            type='file'
                            accept='.csv'
                            onChange={handleFileChange}
                            disabled={uploading}
                            style={{ display: 'none' }}
                        />
                        {uploading ? 'Uploading...' : 'Choose CSV file'}
                    </label>
                    {uploadError && <p className='admin-csv-error'>{uploadError}</p>}

                    {/* Show existing mappings even before upload */}
                    {mappings.length > 0 && (
                        <div className='admin-csv-existing-note'>
                            {mappings.length} existing mapping{mappings.length !== 1 ? 's' : ''} will be reused automatically.
                            <button className='admin-csv-link-btn' onClick={() => setPhase('mapping')}>
                                Edit mappings →
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── PHASE: Mapping ── */}
            {phase === 'mapping' && (
                <div className='admin-csv-mapping'>
                    {uploadResult && (
                        <p className='admin-csv-meta'>
                            Uploaded: <strong>{uploadResult.rowCount} rows</strong>
                            {uploadResult.dateRange.start && (
                                <> · {uploadResult.dateRange.start} to {uploadResult.dateRange.end}</>
                            )}
                        </p>
                    )}

                    {/* Dual-list pairing UI */}
                    <div className='admin-csv-lists'>
                        {/* List A — App student emails */}
                        <div className='admin-csv-list'>
                            <div className='admin-csv-list-header'>App Students (email)</div>
                            <input
                                className='admin-csv-search'
                                placeholder='Search...'
                                value={searchA}
                                onChange={e => setSearchA(e.target.value)}
                            />
                            <div className='admin-csv-list-items'>
                                {filteredStudents.map(s => (
                                    <div
                                        key={s.id}
                                        className={`admin-csv-list-item ${selectedEmail === s.email ? 'selected' : ''}`}
                                        onClick={() => setSelectedEmail(
                                            selectedEmail === s.email ? null : s.email
                                        )}
                                    >
                                        {s.email}
                                    </div>
                                ))}
                                {filteredStudents.length === 0 && (
                                    <div className='admin-csv-empty'>All students paired</div>
                                )}
                            </div>
                        </div>

                        {/* List B — CSV participant names */}
                        <div className='admin-csv-list'>
                            <div className='admin-csv-list-header'>CSV Participants</div>
                            <input
                                className='admin-csv-search'
                                placeholder='Search...'
                                value={searchB}
                                onChange={e => setSearchB(e.target.value)}
                            />
                            <div className='admin-csv-list-items'>
                                {filteredCsvNames.map(name => (
                                    <div
                                        key={name}
                                        className={`admin-csv-list-item ${selectedCsvName === name ? 'selected' : ''}`}
                                        onClick={() => setSelectedCsvName(
                                            selectedCsvName === name ? null : name
                                        )}
                                    >
                                        {name}
                                    </div>
                                ))}
                                {filteredCsvNames.length === 0 && (
                                    <div className='admin-csv-empty'>No unmatched names</div>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        className='admin-csv-pair-btn'
                        onClick={handleMakePair}
                        disabled={!selectedEmail || !selectedCsvName || pairLoading}
                    >
                        {pairLoading ? 'Pairing...' : 'Make Pair'}
                    </button>

                    {/* Pairs table */}
                    {mappings.length > 0 && (
                        <div className='admin-csv-pairs'>
                            <div className='admin-csv-pairs-header'>Pairs ({mappings.length})</div>
                            {mappings.map(m => (
                                <div key={m.csv_name} className='admin-csv-pair-row'>
                                    <span className='admin-csv-pair-email'>{m.email}</span>
                                    <span className='admin-csv-pair-arrow'>→</span>
                                    <span className='admin-csv-pair-name'>{m.csv_name}</span>
                                    <button
                                        className='admin-csv-pair-delete'
                                        onClick={() => handleDeletePair(m.csv_name)}
                                        title='Remove pair only'
                                    >✕</button>
                                    <button
                                        className='admin-csv-pair-wipe'
                                        onClick={() => handleDeletePairWithData(m.csv_name, m.email)}
                                        title='Delete pair and all imported LMS data'
                                    >⊗</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Import button */}
                    {uploadResult && (
                        <div className='admin-csv-import-row'>
                            {importError && <p className='admin-csv-error'>{importError}</p>}
                            <button
                                className='admin-csv-import-btn'
                                onClick={handleImport}
                                disabled={importing || pairedCount === 0}
                            >
                                {importing
                                    ? 'Importing...'
                                    : `Import CSV (${pairedCount} paired student${pairedCount !== 1 ? 's' : ''})`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ── PHASE: Result ── */}
            {phase === 'result' && importResult && (
                <div className='admin-csv-result'>
                    <div className='admin-csv-result-summary'>
                        ✓ Import complete — {importResult.imported} student{importResult.imported !== 1 ? 's' : ''} updated,
                        {' '}{importResult.skipped} skipped (no data in file)
                    </div>
                    <div className='admin-csv-result-table'>
                        {importResult.details.filter(d => d.daysUpdated > 0).map(d => (
                            <div key={d.csvName} className='admin-csv-result-row'>
                                <span className='admin-csv-result-email'>{d.email}</span>
                                <span className='admin-csv-result-meta'>
                                    {d.daysUpdated} day{d.daysUpdated !== 1 ? 's' : ''} · {d.totalEvents} events
                                </span>
                            </div>
                        ))}
                    </div>
                    <button className='admin-csv-reset-btn' onClick={handleReset}>
                        Upload another file
                    </button>
                </div>
            )}
        </div>
    )
}

export default AdminCsvLogPanel

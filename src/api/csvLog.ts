// CSV Log API client — admin-only endpoints for Moodle activity log CSV upload.
// File upload uses raw fetch (not api.post) because we need to send text/csv body,
// not JSON. All other calls use the standard api client.

import { api } from './client'

// -- Types --

export interface CsvUploadResult {
    uploadId: string
    rowCount: number
    dateRange: { start: string | null; end: string | null }
    csvNames: string[]
    existingMappings: Record<string, { userId: string; email: string }>
}

export interface CsvMapping {
    id: string
    csv_name: string
    user_id: string
    email: string
    created_at: string
}

export interface CsvImportDetail {
    csvName: string
    email: string
    daysUpdated: number
    totalEvents: number
}

export interface CsvImportResult {
    imported: number
    skipped: number
    details: CsvImportDetail[]
}

// -- API functions --

/**
 * Upload a CSV file as raw text/csv body.
 * Returns extracted participant names and existing mappings.
 */
export async function uploadCsvLog(file: File): Promise<CsvUploadResult> {
    const text = await file.text()
    const res = await fetch('/api/lms/admin/csv/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
            'Content-Type': 'text/csv',
            'X-Filename': file.name,
        },
        body: text,
    })
    if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).message || 'Upload failed')
    }
    return res.json()
}

/**
 * Get all persistent name→email mappings.
 */
export const getCsvMappings = () =>
    api.get<{ mappings: CsvMapping[] }>('/lms/admin/csv/participants')

/**
 * Create or update a mapping (csv_name → userId).
 */
export const createCsvMapping = (csvName: string, userId: string) =>
    api.post<{ mapping: CsvMapping }>('/lms/admin/csv/mapping', { csvName, userId })

/**
 * Delete a mapping by CSV name.
 */
export const deleteCsvMapping = (csvName: string) =>
    api.delete<{ deleted: boolean; csvName: string }>(
        `/lms/admin/csv/mapping/${encodeURIComponent(csvName)}`
    )

/**
 * Delete a mapping AND all non-simulated lms_sessions for the linked user.
 */
export const deleteCsvMappingWithData = (csvName: string) =>
    api.delete<{ deleted: boolean; csvName: string; sessionsDeleted: number }>(
        `/lms/admin/csv/mapping/${encodeURIComponent(csvName)}/with-data`
    )

/**
 * Trigger import for a stored upload using current mappings.
 */
export const importCsvLog = (uploadId: string) =>
    api.post<CsvImportResult>(`/lms/admin/csv/import/${uploadId}`, {})

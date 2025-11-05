import { http, HttpResponse } from 'msw'
import { createSurvey, getResults, getSurvey, getSurveys, postResult, removeSurvey, updateSurvey } from '../models/in-memory-storage'
import { apiBaseAddress } from '../models/survey'

let currentUser: { id: string, role: 'admin' | 'student' } | null = null

export const handlers = [
    // Auth
    http.post('/api/login', async ({ request }) => {
        const body = await request.clone().json() as any
        const role = body.role === 'admin' ? 'admin' : 'student'
        currentUser = { id: 'demo-user', role }
        return HttpResponse.json(currentUser)
    }),
    http.post('/api/logout', () => {
        currentUser = null
        return HttpResponse.json({})
    }),
    http.get('/api/me', () => {
        return HttpResponse.json(currentUser)
    }),
    http.get(apiBaseAddress + '/surveys', () => {
        // const { userId } = req.params
        // return HttpResponse.json({
        //     id: userId,
        //     firstName: 'John',
        //     lastName: 'Maverick',
        //   })
        return HttpResponse.json(getSurveys())
    }),
    http.get(apiBaseAddress + '/getActive', () => {
        return HttpResponse.json(getSurveys())
    }),
    http.get(apiBaseAddress + '/create', () => {
        return HttpResponse.json(createSurvey())
    }),
    http.post(apiBaseAddress + '/create', () => {
        return HttpResponse.json(createSurvey())
    }),
    http.get(apiBaseAddress + '/delete', ({ request }) => {
        const url = new URL(request.url)
        const id = url.searchParams.get('id')
        removeSurvey(id as string);
        return HttpResponse.json({ id })
    }),
    http.post(apiBaseAddress + '/delete', async ({ request }) => {
        const body = await request.clone().json() as any
        removeSurvey(body.id as string)
        return HttpResponse.json({ id: body.id })
    }),
    http.get(apiBaseAddress + '/getSurvey', ({ request }) => {
        const url = new URL(request.url)
        const surveyId = url.searchParams.get('surveyId')
        return HttpResponse.json(getSurvey(surveyId as string))
    }),
    http.post(apiBaseAddress + '/changeJson', async ({ request }) => {
        const postData = await request.clone().json()
        const { id, json } = postData as Record<string, any>
        updateSurvey(id as string, json)
        return HttpResponse.json({ id, json })
    }),
    http.post(apiBaseAddress + '/post', async ({ request }) => {
        const postData = await request.clone().json()
        const { postId, surveyResult } = postData as Record<string, any>
        postResult(postId as string, surveyResult)
        return HttpResponse.json({})
    }),
    http.get(apiBaseAddress + '/results', ({ request }) => {
        const url = new URL(request.url)
        const postId = url.searchParams.get('postId')
        return HttpResponse.json({ id: postId, data: getResults(postId as string) })
    })
]
export interface ISurveyDefinition {
    id: string,
    name: string,
    json: any
}

export const defaultJSON = {
    id: '',
    name: 'New Survey',
    json: {
        title: 'Ratings Questionnaire',
        pages: [{
            elements: Array.from({ length: 10 }).map((_, i) => ({
                type: 'rating',
                name: `q${i + 1}`,
                title: `Question ${i + 1}`,
                mininumRateDescription: 'Low',
                maximumRateDescription: 'High'
            }))
        }]
    }
}

// Sample results for the ratings questionnaire format (10 rating questions q1..q10)
export const ratingSurveySampleResults = [
    { q1: 5, q2: 4, q3: 5, q4: 3, q5: 4, q6: 5, q7: 4, q8: 3, q9: 5, q10: 4 },
    { q1: 3, q2: 2, q3: 3, q4: 4, q5: 2, q6: 3, q7: 4, q8: 2, q9: 3, q10: 2 }
]

// Base API URL. In Docker, set via build arg REACT_APP_API_BASE; defaults to '/api'
export var apiBaseAddress = (process.env.REACT_APP_API_BASE as string) || '/api';
import { combineReducers } from '@reduxjs/toolkit'
import surveysReducer from './surveys'
import authReducer from './auth'
import resultsReducer from './results'
import profileReducer from './profile'

const rootReducer = combineReducers({
    surveys: surveysReducer,
    auth: authReducer,
    results: resultsReducer,
    profile: profileReducer,
})

export default rootReducer
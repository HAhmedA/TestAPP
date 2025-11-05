import { combineReducers } from '@reduxjs/toolkit'
import { connectRouter } from 'connected-react-router'
import { History } from 'history'
import surveysReducer from './surveys'
import authReducer from './auth'

const rootReducer = (history: History) =>
    combineReducers({
        surveys: surveysReducer,
        auth: authReducer,
        router: connectRouter(history),
    })

export default rootReducer
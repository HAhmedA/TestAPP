import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useReduxSelector } from '../redux'

const RequireAuth: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const user = useReduxSelector(state => state.auth.user)
    const location = useLocation()
    if (!user) {
        return <Navigate to="/login" state={{ from: location }} replace />
    }
    return children
}

export default RequireAuth



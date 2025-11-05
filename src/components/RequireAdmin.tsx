import React from 'react'
import { useReduxSelector } from '../redux'

const RequireAdmin: React.FC<{ children: React.ReactElement }> = ({ children }) => {
    const role = useReduxSelector(state => state.auth.user?.role)
    if (role !== 'admin') {
        return <h1>403 - Admins only</h1>
    }
    return children
}

export default RequireAdmin



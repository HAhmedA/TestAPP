import React from 'react'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { login, logout } from '../redux/auth'

const Login = (): React.ReactElement => {
    const dispatch = useReduxDispatch()
    const user = useReduxSelector(state => state.auth.user)
    const status = useReduxSelector(state => state.auth.status)

    return (
        <div className='sjs-client-app__content--login'>
            <h1>Authentication</h1>
            {user ? (
                <>
                    <p>Signed in as <strong>{user.role}</strong>.</p>
                    <span className='sjs-button' onClick={() => dispatch(logout())}>Logout</span>
                </>
            ) : (
                <>
                    <p>Select a role to sign in:</p>
                    <div>
                        <span className='sjs-button' onClick={() => dispatch(login('admin'))}>
                            {status === 'loading' ? 'Signing in...' : 'Sign in as Admin'}
                        </span>
                        <span className='sjs-button' style={{ marginLeft: 8 }} onClick={() => dispatch(login('student'))}>
                            {status === 'loading' ? 'Signing in...' : 'Sign in as Student'}
                        </span>
                    </div>
                </>
            )}
        </div>
    )
}

export default Login



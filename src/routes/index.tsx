import React from 'react'
import { Route, NavLink, Routes } from 'react-router-dom'
import Home from "../pages/Home"
import Run from "../pages/Run"
import Edit from "../pages/Edit"
import Results from "../pages/Results"
import Login from "../pages/Login"
import RequireAdmin from "../components/RequireAdmin"
import RequireAuth from "../components/RequireAuth"
import { useReduxDispatch, useReduxSelector } from '../redux'
import { logout } from '../redux/auth'

export const NavBar = () => {
    const user = useReduxSelector(state => state.auth.user)
    const dispatch = useReduxDispatch()
    return (
        <>
            {user && <NavLink className='sjs-nav-button' to="/"><span>My Surveys</span></NavLink>}
            {!user && <NavLink className='sjs-nav-button' to="/login"><span>Login</span></NavLink>}
            {user && (
                <span className='sjs-nav-button' onClick={() => dispatch(logout())}><span>Logout</span></span>
            )}
        </>
    )
}

const NoMatch = () => (<><h1>404</h1></>)

const Content = (): React.ReactElement => (
    <>
        <Routes>
            <Route path="/login" element={<Login/>}></Route>
            <Route path="/" element={<RequireAuth><Home/></RequireAuth>}></Route>
            <Route path="/run/:id" element={<RequireAuth><Run/></RequireAuth>}></Route>
            <Route path="/edit/:id" element={<RequireAuth><RequireAdmin><Edit/></RequireAdmin></RequireAuth>}></Route>
            <Route path="/results/:id" element={<RequireAuth><RequireAdmin><Results/></RequireAdmin></RequireAuth>}></Route>
            <Route element={<NoMatch/>}></Route>
        </Routes>
    </>
)

export default Content
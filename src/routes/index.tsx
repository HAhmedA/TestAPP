import React from 'react'
import { Route, NavLink, Routes } from 'react-router-dom'
import Home from "../pages/Home"
import Run from "../pages/Run"
import Edit from "../pages/Edit"
import Results from "../pages/Results"
import Login from "../pages/Login"
import Register from "../pages/Register"
import MoodHistory from "../pages/MoodHistory"
import Profile from "../pages/Profile"
import RequireAdmin from "../components/RequireAdmin"
import RequireAuth from "../components/RequireAuth"
import { useReduxDispatch, useReduxSelector } from '../redux'
import { logout } from '../redux/auth'

export const NavBar = () => {
    const user = useReduxSelector(state => state.auth.user)
    const dispatch = useReduxDispatch()
    return (
        <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
                {user && <NavLink className='sjs-nav-button sjs-nav-button-gold' to="/"><span>Home</span></NavLink>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
                {user && (
                    <>
                        <NavLink className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped' to="/profile"><span>Profile</span></NavLink>
                        <span className='sjs-nav-button sjs-nav-button-gold sjs-nav-button-grouped' onClick={() => dispatch(logout())}><span>Logout</span></span>
                    </>
                )}
            </div>
        </div>
    )
}

const NoMatch = () => (<><h1>404</h1></>)

const Content = (): React.ReactElement => (
    <>
        <Routes>
            <Route path="/login" element={<Login/>}></Route>
            <Route path="/register" element={<Register/>}></Route>
            <Route path="/" element={<RequireAuth><Home/></RequireAuth>}></Route>
            <Route path="/run/:id" element={<RequireAuth><Run/></RequireAuth>}></Route>
            <Route path="/edit/:id" element={<RequireAuth><RequireAdmin><Edit/></RequireAdmin></RequireAuth>}></Route>
            <Route path="/results/:id" element={<RequireAuth><RequireAdmin><Results/></RequireAdmin></RequireAuth>}></Route>
            <Route path="/mood-history/:id" element={<RequireAuth><MoodHistory/></RequireAuth>}></Route>
            <Route path="/profile" element={<RequireAuth><Profile/></RequireAuth>}></Route>
            <Route element={<NoMatch/>}></Route>
        </Routes>
    </>
)

export default Content
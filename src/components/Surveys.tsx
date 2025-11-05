import React, { useEffect } from 'react'
import { create, load, remove } from '../redux/surveys'
import { useReduxDispatch, useReduxSelector } from '../redux'
import { Link } from 'react-router-dom'
import './Surveys.css'

const Surveys = (): React.ReactElement => {
    const surveys = useReduxSelector(state => state.surveys.surveys)
    const dispatch = useReduxDispatch()
    const role = useReduxSelector(state => state.auth.user?.role)

    const status = useReduxSelector(state => state.surveys.status)

    useEffect(() => {
      if (status === 'idle' && surveys.length === 0) {
        dispatch(load())
      }
    }, [status, dispatch, surveys])

    return (<>
        <table className='sjs-surveys-list'>
            <tbody>
            {surveys.map(survey => 
                <tr key={survey.id} className='sjs-surveys-list__row'>
                    <td><span>{survey.json?.title || survey.name}</span></td>
                    <td>
                        <Link className='sjs-button' to={'run/' + survey.id}><span>Run</span></Link>
                        {role === 'admin' && <Link className='sjs-button' to={'edit/' + survey.id}><span>Edit</span></Link>}
                        {role === 'admin' && <Link className='sjs-button' to={'results/' + survey.id}><span>Results</span></Link>}
                        {role === 'admin' && <span className='sjs-button sjs-remove-btn' onClick={() => dispatch(remove(survey.id))}>Remove</span>}
                    </td>
                </tr>
            )}
            </tbody>
        </table>
        <div className='sjs-surveys-list__footer'>
            {role === 'admin' && (
                <span className='sjs-button sjs-add-btn' title='increment' onClick={() => dispatch(create())}>Add Survey</span>
            )}
        </div>
    </>)
}

export default Surveys
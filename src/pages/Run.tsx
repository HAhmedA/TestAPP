import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useReduxDispatch } from '../redux'
import { post } from '../redux/results'
import { get } from '../redux/surveys'
import { Model } from 'survey-core'
import { Survey } from 'survey-react-ui'
import 'survey-core/survey-core.css'
import './Run.css'

const Run = () => {
    const dispatch = useReduxDispatch()
    const navigate = useNavigate()
    const { id } = useParams();
    const [surveyData, surveyDataSet] = useState<any>(null)
    const [surveyModel, surveyModelSet] = useState<Model>()

    useEffect(() => {
        (async () => {
            const surveyAction = await dispatch(get(id as string))
            surveyDataSet(surveyAction.payload)
            
            // Make all questions mandatory by modifying the JSON before creating the model
            const surveyJson = JSON.parse(JSON.stringify(surveyAction.payload?.json || {}))
            if (surveyJson.pages) {
                surveyJson.pages.forEach((page: any) => {
                    if (page.elements) {
                        page.elements.forEach((element: any) => {
                            element.isRequired = true
                        })
                    }
                })
            }
            
            const model = new Model(surveyJson)
            
            // Set SurveyJS theme color
            model.css = {
                primary: '#850b0b',
                primaryForeground: '#ffffff',
                primaryLight: '#ffeaea'
            }
            
            // Set required text message
            model.requiredText = '*'
            
            // Ensure validation prevents incomplete submissions
            model.showProgressBar = 'bottom'
            model.showQuestionNumbers = 'on'
            
            model
                .onComplete
                .add(async (sender: Model) => {
                    await dispatch(post({postId: id as string, surveyResult: sender.data, surveyResultText: JSON.stringify(sender.data)}))
                    // Navigate to home page
                    navigate('/')
                })
            
            // Prevent completion if any required question is not answered
            model.onValidateQuestion.add((sender, options) => {
                if (options.question.isRequired && !options.value) {
                    options.error = 'This question is required'
                }
            })
            
            surveyModelSet(model)
        })()
    }, [dispatch, id, navigate])

    return (<>
        <button 
            className='run-back-button' 
            onClick={() => navigate('/')}
        >
            ← Back
        </button>
        {surveyData === null && <div>Loading...</div>}
        {surveyData === undefined && <div>Survey not found</div>}
        {!!surveyData && !!surveyModel && !surveyModel.title && <>
            <h1>{surveyData.name}</h1>
        </>}
        {!!surveyModel && <>
            <Survey model={surveyModel}/>
        </>}
    </>);
}

export default Run;
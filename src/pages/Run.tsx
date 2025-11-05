import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useReduxDispatch } from '../redux'
import { post } from '../redux/results'
import { get } from '../redux/surveys'
import { Model } from 'survey-core'
import { Survey } from 'survey-react-ui'
import 'survey-core/survey-core.css'

const Run = () => {
    const dispatch = useReduxDispatch()
    const { id } = useParams();
    const [surveyData, surveyDataSet] = useState<any>(null)
    const [surveyModel, surveyModelSet] = useState<Model>()

    useEffect(() => {
        (async () => {
            const surveyAction = await dispatch(get(id as string))
            surveyDataSet(surveyAction.payload)
            const model = new Model(surveyAction.payload?.json);
            model
                .onComplete
                .add((sender: Model) => {
                    dispatch(post({postId: id as string, surveyResult: sender.data, surveyResultText: JSON.stringify(sender.data)}))
                });    
            surveyModelSet(model)
        })()
    }, [dispatch, id])

    return (<>
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
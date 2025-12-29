import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useReduxSelector, useReduxDispatch } from '../redux'
import { loadProfile, saveProfile } from '../redux/profile'
import './Profile.css'

const educationLevels = ['Bachelor\'s', 'Master\'s', 'PhD', 'Post Doc']

const fieldsOfStudy = [
    'Engineering & Technology',
    'Computer Science & Information Technology',
    'Natural Sciences',
    'Health & Medical Sciences',
    'Business & Management',
    'Social Sciences',
    'Arts & Humanities',
    'Communication & Media',
    'Education',
    'Law, Policy & Public Service'
]

const majorsByField: Record<string, string[]> = {
    'Engineering & Technology': [
        'Mechanical Engineering', 'Civil Engineering', 'Electrical Engineering',
        'Computer Engineering', 'Chemical Engineering', 'Industrial Engineering',
        'Aerospace Engineering', 'Software Engineering', 'Biomedical Engineering',
        'Environmental Engineering'
    ],
    'Computer Science & Information Technology': [
        'Computer Science', 'Information Technology', 'Cybersecurity', 'Data Science',
        'Artificial Intelligence', 'Game Design', 'Computer Networks', 'Web Development',
        'Cloud Computing', 'Information Systems'
    ],
    'Natural Sciences': [
        'Biology', 'Chemistry', 'Physics', 'Geology', 'Environmental Science',
        'Astronomy', 'Oceanography', 'Ecology', 'Biochemistry', 'Marine Biology'
    ],
    'Health & Medical Sciences': [
        'Nursing', 'Medicine', 'Public Health', 'Pharmacy', 'Dentistry',
        'Nutrition and Dietetics', 'Physical Therapy', 'Biomedical Sciences',
        'Occupational Therapy', 'Health Administration'
    ],
    'Business & Management': [
        'Business Administration', 'Finance', 'Marketing', 'Accounting',
        'Human Resource Management', 'International Business', 'Entrepreneurship',
        'Supply Chain Management', 'Economics', 'Hospitality Management'
    ],
    'Social Sciences': [
        'Psychology', 'Sociology', 'Anthropology', 'Political Science', 'Criminology',
        'Geography', 'International Relations', 'Archaeology', 'Gender Studies',
        'Cultural Studies'
    ],
    'Arts & Humanities': [
        'English Literature', 'History', 'Philosophy', 'Linguistics', 'Religious Studies',
        'Fine Arts', 'Art History', 'Music', 'Theatre Arts', 'Creative Writing'
    ],
    'Communication & Media': [
        'Journalism', 'Media Studies', 'Public Relations', 'Film and Television Production',
        'Communication Studies', 'Advertising', 'Digital Media', 'Broadcasting',
        'Screenwriting', 'Visual Communication'
    ],
    'Education': [
        'Early Childhood Education', 'Elementary Education', 'Secondary Education',
        'Special Education', 'Educational Leadership', 'Curriculum and Instruction',
        'Adult Education', 'Educational Psychology', 'Counseling', 'TESOL'
    ],
    'Law, Policy & Public Service': [
        'Law', 'Public Policy', 'Public Administration', 'International Law',
        'Political Science', 'Criminal Justice', 'Legal Studies', 'Human Rights',
        'Urban Planning', 'Social Work'
    ]
}

const learningFormatOptions = ['Reading', 'Listening', 'Watching', 'Hands-on Practice', 'Discussion', 'Writing']

const disabilityCategories = {
    'Reading Disabilities': ['Dyslexia', 'Hyperlexia', 'Visual Processing Disorder'],
    'Writing Disabilities': ['Dysgraphia', 'Written Expression Disorder', 'Motor Coordination Disorder'],
    'Mathematics Disabilities': ['Dyscalculia', 'Math Reasoning Disorder', 'Number Processing Disorder'],
    'Attention & Focus Disorders': ['Attention Deficit Disorder (ADD)', 'Attention Deficit Hyperactivity Disorder (ADHD)', 'Executive Function Disorder'],
    'Language & Communication Disorders': ['Auditory Processing Disorder (APD)', 'Expressive Language Disorder', 'Receptive Language Disorder'],
    'Memory & Cognitive Processing Disorders': ['Working Memory Deficit', 'Slow Processing Speed', 'Nonverbal Learning Disability (NVLD)'],
    'Autism Spectrum-Related Learning Differences': ['High-Functioning Autism', 'Asperger\'s Syndrome', 'Social Communication Disorder'],
    'Generalized Learning Disorders': ['Specific Learning Disorder (SLD)', 'Global Developmental Delay', 'Mild Cognitive Impairment']
}

const Profile = () => {
    const navigate = useNavigate()
    const dispatch = useReduxDispatch()
    const user = useReduxSelector(state => state.auth.user)
    const profile = useReduxSelector(state => state.profile.profile)
    const profileStatus = useReduxSelector(state => state.profile.status)
    const userName = user?.name || user?.email || 'User'

    const [educationLevel, setEducationLevel] = useState('')
    const [fieldOfStudy, setFieldOfStudy] = useState('')
    const [major, setMajor] = useState('')
    const [learningFormats, setLearningFormats] = useState<string[]>([])
    const [disabilities, setDisabilities] = useState<string[]>([])
    const [saving, setSaving] = useState(false)

    const availableMajors = fieldOfStudy ? (majorsByField[fieldOfStudy] || []) : []

    // Load profile data when component mounts
    useEffect(() => {
        dispatch(loadProfile())
    }, [dispatch])

    // Populate form when profile is loaded
    useEffect(() => {
        if (profile) {
            setEducationLevel(profile.eduLevel || '')
            setFieldOfStudy(profile.fieldOfStudy || '')
            setMajor(profile.major || '')
            setLearningFormats(Array.isArray(profile.learningFormats) ? profile.learningFormats : [])
            // Handle disabilities - could be array or object
            if (Array.isArray(profile.disabilities)) {
                setDisabilities(profile.disabilities)
            } else if (typeof profile.disabilities === 'object') {
                // Convert object format to array
                const disabilityArray: string[] = []
                Object.values(profile.disabilities).forEach(categoryDisabilities => {
                    if (Array.isArray(categoryDisabilities)) {
                        disabilityArray.push(...categoryDisabilities)
                    }
                })
                setDisabilities(disabilityArray)
            } else {
                setDisabilities([])
            }
        }
    }, [profile])

    const handleLearningFormatChange = (format: string) => {
        setLearningFormats(prev =>
            prev.includes(format)
                ? prev.filter(f => f !== format)
                : [...prev, format]
        )
    }

    const handleDisabilityChange = (disability: string) => {
        setDisabilities(prev =>
            prev.includes(disability)
                ? prev.filter(d => d !== disability)
                : [...prev, disability]
        )
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            await dispatch(saveProfile({
                eduLevel: educationLevel || undefined,
                fieldOfStudy: fieldOfStudy || undefined,
                major: major || undefined,
                learningFormats: learningFormats.length > 0 ? learningFormats : undefined,
                disabilities: disabilities.length > 0 ? disabilities : undefined
            })).unwrap()
            // Show success message or navigate
            alert('Profile saved successfully!')
        } catch (error: any) {
            console.error('Failed to save profile:', error)
            alert('Failed to save profile. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className='profile-wrapper'>
            <div className='profile-container'>
                <button className='profile-back' onClick={() => navigate('/')}>
                    ← Back
                </button>
                <h1 className='profile-title'>{userName}'s profile</h1>
                <div className='profile-content'>
                    <form onSubmit={handleSubmit} className='profile-form'>
                        {/* Education Level */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Current education level
                            </label>
                            <select
                                className='profile-select'
                                value={educationLevel}
                                onChange={(e) => setEducationLevel(e.target.value)}
                            >
                                <option value=''>Select education level</option>
                                {educationLevels.map(level => (
                                    <option key={level} value={level}>{level}</option>
                                ))}
                            </select>
                        </div>

                        {/* Field of Study */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Field of study
                            </label>
                            <select
                                className='profile-select'
                                value={fieldOfStudy}
                                onChange={(e) => {
                                    setFieldOfStudy(e.target.value)
                                    setMajor('') // Reset major when field changes
                                }}
                            >
                                <option value=''>Select field of study</option>
                                {fieldsOfStudy.map(field => (
                                    <option key={field} value={field}>{field}</option>
                                ))}
                            </select>
                        </div>

                        {/* Major */}
                        {fieldOfStudy && (
                            <div className='profile-form-group'>
                                <label className='profile-label'>
                                    Major
                                </label>
                                <select
                                    className='profile-select'
                                    value={major}
                                    onChange={(e) => setMajor(e.target.value)}
                                >
                                    <option value=''>Select major</option>
                                    {availableMajors.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Preferred Learning Formats */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Preferred learning formats
                            </label>
                            <div className='profile-checkbox-group'>
                                {learningFormatOptions.map(format => (
                                    <label key={format} className='profile-checkbox-label'>
                                        <input
                                            type='checkbox'
                                            className='profile-checkbox'
                                            checked={learningFormats.includes(format)}
                                            onChange={() => handleLearningFormatChange(format)}
                                        />
                                        <span>{format}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Disabilities */}
                        <div className='profile-form-group'>
                            <label className='profile-label'>
                                Disabilities
                            </label>
                            <div className='profile-disabilities-container'>
                                {Object.entries(disabilityCategories).map(([category, items]) => (
                                    <div key={category} className='profile-disability-category'>
                                        <h3 className='profile-disability-category-title'>{category}</h3>
                                        <div className='profile-checkbox-group'>
                                            {items.map(disability => (
                                                <label key={disability} className='profile-checkbox-label'>
                                                    <input
                                                        type='checkbox'
                                                        className='profile-checkbox'
                                                        checked={disabilities.includes(disability)}
                                                        onChange={() => handleDisabilityChange(disability)}
                                                    />
                                                    <span>{disability}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className='profile-form-actions'>
                            <button 
                                type='submit' 
                                className='profile-submit-button'
                                disabled={saving || profileStatus === 'loading'}
                            >
                                {saving ? 'Saving...' : 'Save Profile'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}

export default Profile


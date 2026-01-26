-- Test Student with Pre-populated 7-Day Simulation Data
-- Email: test@example.com
-- Password: test
--
-- This creates a test student account with survey responses spanning 7 days
-- to enable immediate testing of Mood Today, Mood over 7 days, and Mood History.
--
-- PATTERN DESIGN (14 concepts with diverse patterns):
-- 1. efficiency     : Improving (2→2→3→3→4→4→5)
-- 2. importance     : Stable High (5→5→4→5→5→4→5)
-- 3. tracking       : Declining (5→4→4→3→3→2→2)
-- 4. clarity        : Fluctuating (2→4→2→5→2→4→2)
-- 5. effort         : Improving Steadily (1→2→2→3→3→4→5)
-- 6. focus          : Stable Average (3→3→3→3→3→3→3)
-- 7. help_seeking   : Improving Dramatically (1→1→2→3→4→5→5)
-- 8. community      : Stable Low (2→2→2→1→2→2→2)
-- 9. timeliness     : Declining Slightly (4→4→3→3→3→2→2)
-- 10. motivation    : Fluctuating (3→5→2→4→1→5→3)
-- 11. anxiety       : Improving (inverted: 5→5→4→3→2→2→1)
-- 12. enjoyment     : Stable High (4→5→4→5→5→4→5)
-- 13. learning_from_feedback : Improving (2→3→3→4→4→5→5)
-- 14. self_assessment : Stable Average (3→3→4→3→3→3→3)

-- Use a fixed UUID for test student so we can reference it
DO $$
DECLARE
    test_user_id UUID := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    survey_id UUID;
    q_id UUID;
    day_offset INT;
    response_num INT;
    ts TIMESTAMPTZ;
BEGIN
    -- 1. Create test student user
    INSERT INTO public.users (id, email, name, password_hash, role)
    VALUES (
        test_user_id,
        'test@example.com',
        'Test Student',
        '$2b$10$o4WDjkk/mAAFckP3u.q9yuDZ9XSsONFZQL4veMJgd246sjXaDttP.',
        'student'
    )
    ON CONFLICT (email) DO UPDATE SET
        id = test_user_id,
        name = 'Test Student',
        password_hash = '$2b$10$o4WDjkk/mAAFckP3u.q9yuDZ9XSsONFZQL4veMJgd246sjXaDttP.',
        role = 'student';

    -- 2. Create student profile with comprehensive test data
    -- Values must match exactly with profile-constants.ts options
    INSERT INTO public.student_profiles (user_id, edu_level, field_of_study, major, learning_formats, disabilities, simulated_profile)
    VALUES (
        test_user_id,
        'Bachelor''s',
        'Computer Science & Information Technology',
        'Software Engineering',
        '["Reading", "Watching", "Hands-on Practice", "Discussion"]'::jsonb,
        '["Dyslexia", "Attention Deficit Hyperactivity Disorder (ADHD)", "Working Memory Deficit"]'::jsonb,
        'average'
    )
    ON CONFLICT (user_id) DO UPDATE SET
        edu_level = 'Bachelor''s',
        field_of_study = 'Computer Science & Information Technology',
        major = 'Software Engineering',
        learning_formats = '["Reading", "Watching", "Hands-on Practice", "Discussion"]'::jsonb,
        disabilities = '["Dyslexia", "Attention Deficit Hyperactivity Disorder (ADHD)", "Working Memory Deficit"]'::jsonb,
        simulated_profile = 'average',
        updated_at = NOW();

    -- Get the survey ID (should be the fixed SRL questionnaire)
    SELECT id INTO survey_id FROM public.surveys LIMIT 1;
    
    -- If no survey exists, create it
    IF survey_id IS NULL THEN
        survey_id := uuid_generate_v4();
        INSERT INTO public.surveys (id, name, json)
        VALUES (survey_id, 'Self-Regulated Learning Questionnaire', 
            '{"title":"Self-Regulated Learning Questionnaire","pages":[{"elements":[
                {"type":"rating","name":"efficiency","title":"I believe I can accomplish my learning duties and learning tasks efficiently:"},
                {"type":"rating","name":"importance","title":"I believe that my learning tasks are very important to me:"},
                {"type":"rating","name":"tracking","title":"I am keeping track of what I need to do or accomplish:"},
                {"type":"rating","name":"clarity","title":"I know what I have to do to accomplish my learning tasks:"},
                {"type":"rating","name":"effort","title":"I am putting enough effort into my learning tasks to accomplish them well:"},
                {"type":"rating","name":"focus","title":"I am focusing on performing my learning tasks today and resisting distractions:"},
                {"type":"rating","name":"help_seeking","title":"I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks:"},
                {"type":"rating","name":"community","title":"I am having nice interactions and feeling at home within the college community:"},
                {"type":"rating","name":"timeliness","title":"I am doing my studies on time and keeping up with tasks/deadlines:"},
                {"type":"rating","name":"motivation","title":"I feel enthusiastic/motivated to learn, understand, and get better grades:"},
                {"type":"rating","name":"anxiety","title":"I feel anxious/stressed working on learning tasks, assignments, or in class:"},
                {"type":"rating","name":"enjoyment","title":"I enjoy my tasks and feel happy about my achievements/work/accomplishment:"},
                {"type":"rating","name":"learning_from_feedback","title":"I am learning from feedback and mistakes to accomplish my learning:"},
                {"type":"rating","name":"self_assessment","title":"I always assess my performance or work on tasks to improve my skills:"}
            ]}]}'::jsonb);
    END IF;

    -- Delete existing test data for this user (for idempotency)
    DELETE FROM public.srl_responses WHERE user_id = test_user_id;
    DELETE FROM public.srl_annotations WHERE user_id = test_user_id;
    DELETE FROM public.questionnaire_results WHERE user_id = test_user_id;

    -- 3. Insert questionnaire results (2 per day for 7 days = 14 total, plus 3 more today)
    -- Day 7 (6 days ago) - Morning response
    ts := NOW() - INTERVAL '6 days 10 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":2,"importance":5,"tracking":5,"clarity":2,"effort":1,"focus":3,"help_seeking":1,"community":2,"timeliness":4,"motivation":3,"anxiety":5,"enjoyment":4,"learning_from_feedback":2,"self_assessment":3}'::jsonb);
    -- Insert SRL responses
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 2, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 5, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 1, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 1, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 4, ts),
        (test_user_id, q_id, 'motivation', 3, ts),
        (test_user_id, q_id, 'anxiety', 5, ts),
        (test_user_id, q_id, 'enjoyment', 4, ts),
        (test_user_id, q_id, 'learning_from_feedback', 2, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 7 (6 days ago) - Evening response
    ts := NOW() - INTERVAL '6 days 2 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":2,"importance":5,"tracking":4,"clarity":4,"effort":2,"focus":3,"help_seeking":1,"community":2,"timeliness":4,"motivation":5,"anxiety":5,"enjoyment":5,"learning_from_feedback":3,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 2, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 4, ts),
        (test_user_id, q_id, 'clarity', 4, ts),
        (test_user_id, q_id, 'effort', 2, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 1, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 4, ts),
        (test_user_id, q_id, 'motivation', 5, ts),
        (test_user_id, q_id, 'anxiety', 5, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 3, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 6 (5 days ago) - Morning
    ts := NOW() - INTERVAL '5 days 9 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":3,"importance":4,"tracking":4,"clarity":2,"effort":2,"focus":3,"help_seeking":2,"community":2,"timeliness":3,"motivation":2,"anxiety":4,"enjoyment":4,"learning_from_feedback":3,"self_assessment":4}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 3, ts),
        (test_user_id, q_id, 'importance', 4, ts),
        (test_user_id, q_id, 'tracking', 4, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 2, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 2, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 3, ts),
        (test_user_id, q_id, 'motivation', 2, ts),
        (test_user_id, q_id, 'anxiety', 4, ts),
        (test_user_id, q_id, 'enjoyment', 4, ts),
        (test_user_id, q_id, 'learning_from_feedback', 3, ts),
        (test_user_id, q_id, 'self_assessment', 4, ts);

    -- Day 6 (5 days ago) - Evening
    ts := NOW() - INTERVAL '5 days 1 hour';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":3,"importance":5,"tracking":3,"clarity":5,"effort":3,"focus":3,"help_seeking":3,"community":1,"timeliness":3,"motivation":4,"anxiety":3,"enjoyment":5,"learning_from_feedback":4,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 3, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 3, ts),
        (test_user_id, q_id, 'clarity', 5, ts),
        (test_user_id, q_id, 'effort', 3, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 3, ts),
        (test_user_id, q_id, 'community', 1, ts),
        (test_user_id, q_id, 'timeliness', 3, ts),
        (test_user_id, q_id, 'motivation', 4, ts),
        (test_user_id, q_id, 'anxiety', 3, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 4, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 5 (4 days ago) - Morning
    ts := NOW() - INTERVAL '4 days 11 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":4,"importance":5,"tracking":3,"clarity":2,"effort":3,"focus":3,"help_seeking":4,"community":2,"timeliness":3,"motivation":1,"anxiety":2,"enjoyment":5,"learning_from_feedback":4,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 4, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 3, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 3, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 4, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 3, ts),
        (test_user_id, q_id, 'motivation', 1, ts),
        (test_user_id, q_id, 'anxiety', 2, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 4, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 5 (4 days ago) - Evening
    ts := NOW() - INTERVAL '4 days 3 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":4,"importance":4,"tracking":3,"clarity":4,"effort":3,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":5,"anxiety":2,"enjoyment":4,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 4, ts),
        (test_user_id, q_id, 'importance', 4, ts),
        (test_user_id, q_id, 'tracking', 3, ts),
        (test_user_id, q_id, 'clarity', 4, ts),
        (test_user_id, q_id, 'effort', 3, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 5, ts),
        (test_user_id, q_id, 'anxiety', 2, ts),
        (test_user_id, q_id, 'enjoyment', 4, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 4 (3 days ago) - Morning
    ts := NOW() - INTERVAL '3 days 10 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":4,"importance":5,"tracking":2,"clarity":2,"effort":4,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":3,"anxiety":2,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 4, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 4, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 3, ts),
        (test_user_id, q_id, 'anxiety', 2, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 4 (3 days ago) - Evening
    ts := NOW() - INTERVAL '3 days 2 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":5,"tracking":2,"clarity":4,"effort":4,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":5,"anxiety":1,"enjoyment":4,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 4, ts),
        (test_user_id, q_id, 'effort', 4, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 5, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 4, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 3 (2 days ago) - Morning
    ts := NOW() - INTERVAL '2 days 9 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":4,"tracking":2,"clarity":2,"effort":5,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":3,"anxiety":1,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 4, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 5, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 3, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 2 (yesterday) - Morning
    ts := NOW() - INTERVAL '1 day 11 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":5,"tracking":2,"clarity":4,"effort":5,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":4,"anxiety":1,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 4, ts),
        (test_user_id, q_id, 'effort', 5, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 4, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 2 (yesterday) - Evening
    ts := NOW() - INTERVAL '1 day 3 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":5,"tracking":2,"clarity":2,"effort":5,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":5,"anxiety":1,"enjoyment":4,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 5, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 5, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 4, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 1 (Today) - Morning response
    ts := NOW() - INTERVAL '10 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":5,"tracking":2,"clarity":2,"effort":5,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":3,"anxiety":1,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 5, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 3, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 1 (Today) - Afternoon response
    ts := NOW() - INTERVAL '5 hours';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":4,"importance":4,"tracking":2,"clarity":4,"effort":4,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":4,"anxiety":2,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 4, ts),
        (test_user_id, q_id, 'importance', 4, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 4, ts),
        (test_user_id, q_id, 'effort', 4, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 4, ts),
        (test_user_id, q_id, 'anxiety', 2, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- Day 1 (Today) - Recent response
    ts := NOW() - INTERVAL '1 hour';
    q_id := uuid_generate_v4();
    INSERT INTO public.questionnaire_results (id, postid, user_id, created_at, answers)
    VALUES (q_id, survey_id, test_user_id, ts,
        '{"efficiency":5,"importance":5,"tracking":2,"clarity":2,"effort":5,"focus":3,"help_seeking":5,"community":2,"timeliness":2,"motivation":3,"anxiety":1,"enjoyment":5,"learning_from_feedback":5,"self_assessment":3}'::jsonb);
    INSERT INTO public.srl_responses (user_id, questionnaire_id, concept_key, score, submitted_at) VALUES
        (test_user_id, q_id, 'efficiency', 5, ts),
        (test_user_id, q_id, 'importance', 5, ts),
        (test_user_id, q_id, 'tracking', 2, ts),
        (test_user_id, q_id, 'clarity', 2, ts),
        (test_user_id, q_id, 'effort', 5, ts),
        (test_user_id, q_id, 'focus', 3, ts),
        (test_user_id, q_id, 'help_seeking', 5, ts),
        (test_user_id, q_id, 'community', 2, ts),
        (test_user_id, q_id, 'timeliness', 2, ts),
        (test_user_id, q_id, 'motivation', 3, ts),
        (test_user_id, q_id, 'anxiety', 1, ts),
        (test_user_id, q_id, 'enjoyment', 5, ts),
        (test_user_id, q_id, 'learning_from_feedback', 5, ts),
        (test_user_id, q_id, 'self_assessment', 3, ts);

    -- 4. Insert pre-computed annotations (24h and 7d windows)
    -- Pattern summary:
    -- efficiency: Improving (2→5), importance: Stable High, tracking: Declining (5→2)
    -- clarity: Fluctuating (2,4,2,5,2,4,2), effort: Improving (1→5), focus: Stable Avg (3)
    -- help_seeking: Improving (1→5), community: Stable Low (2), timeliness: Declining (4→2)
    -- motivation: Fluctuating (3,5,2,4,1,5,3), anxiety: Improving/inverted (5→1)
    -- enjoyment: Stable High (4-5), learning_from_feedback: Improving (2→5)
    -- self_assessment: Stable Avg (3)

    -- 24h annotations
    INSERT INTO public.srl_annotations (user_id, concept_key, time_window, avg_score, min_score, max_score, response_count, trend, is_inverted, has_sufficient_data, distinct_day_count, annotation_text, annotation_text_llm, computed_at) VALUES
    (test_user_id, 'efficiency', '24h', 4.67, 4, 5, 3, 'stable_high', false, true, NULL, 'Your Efficiency has been consistently high today, with an average of 4.7 out of 5.', 'Regarding "I believe I can accomplish my learning duties and learning tasks efficiently": The student''s responses have been consistently high in the last 24 hours. Statistics: average 4.7, min 4, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'importance', '24h', 4.67, 4, 5, 3, 'stable_high', false, true, NULL, 'Your Importance has been consistently high today, with an average of 4.7 out of 5.', 'Regarding "I believe that my learning tasks are very important to me": The student''s responses have been consistently high in the last 24 hours. Statistics: average 4.7, min 4, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'tracking', '24h', 2.00, 2, 2, 3, 'stable_low', false, true, NULL, 'Your Tracking has been consistently low today, with an average of 2.0 out of 5.', 'Regarding "I am keeping track of what I need to do or accomplish": The student''s responses have been consistently low in the last 24 hours. Statistics: average 2.0, min 2, max 2 (based on 3 responses).', NOW()),
    (test_user_id, 'clarity', '24h', 2.67, 2, 4, 3, 'fluctuating', false, true, NULL, 'Your Clarity has been fluctuating today, with an average of 2.7 out of 5.', 'Regarding "I know what I have to do to accomplish my learning tasks": The student''s responses have been fluctuating in the last 24 hours. Statistics: average 2.7, min 2, max 4 (based on 3 responses).', NOW()),
    (test_user_id, 'effort', '24h', 4.67, 4, 5, 3, 'stable_high', false, true, NULL, 'Your Effort has been consistently high today, with an average of 4.7 out of 5.', 'Regarding "I am putting enough effort into my learning tasks to accomplish them well": The student''s responses have been consistently high in the last 24 hours. Statistics: average 4.7, min 4, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'focus', '24h', 3.00, 3, 3, 3, 'stable_avg', false, true, NULL, 'Your Focus has been stable today, with an average of 3.0 out of 5.', 'Regarding "I am focusing on performing my learning tasks today and resisting distractions": The student''s responses have been stable in the last 24 hours. Statistics: average 3.0, min 3, max 3 (based on 3 responses).', NOW()),
    (test_user_id, 'help_seeking', '24h', 5.00, 5, 5, 3, 'stable_high', false, true, NULL, 'Your Help Seeking has been consistently high today, with an average of 5.0 out of 5.', 'Regarding "I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks": The student''s responses have been consistently high in the last 24 hours. Statistics: average 5.0, min 5, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'community', '24h', 2.00, 2, 2, 3, 'stable_low', false, true, NULL, 'Your Community has been consistently low today, with an average of 2.0 out of 5.', 'Regarding "I am having nice interactions and feeling at home within the college community": The student''s responses have been consistently low in the last 24 hours. Statistics: average 2.0, min 2, max 2 (based on 3 responses).', NOW()),
    (test_user_id, 'timeliness', '24h', 2.00, 2, 2, 3, 'stable_low', false, true, NULL, 'Your Timeliness has been consistently low today, with an average of 2.0 out of 5.', 'Regarding "I am doing my studies on time and keeping up with tasks/deadlines": The student''s responses have been consistently low in the last 24 hours. Statistics: average 2.0, min 2, max 2 (based on 3 responses).', NOW()),
    (test_user_id, 'motivation', '24h', 3.33, 3, 4, 3, 'stable_avg', false, true, NULL, 'Your Motivation has been stable today, with an average of 3.3 out of 5.', 'Regarding "I feel enthusiastic/motivated to learn, understand, and get better grades": The student''s responses have been stable in the last 24 hours. Statistics: average 3.3, min 3, max 4 (based on 3 responses).', NOW()),
    (test_user_id, 'anxiety', '24h', 1.33, 1, 2, 3, 'stable_low', true, true, NULL, 'Your Anxiety has been consistently low (which is good) today, with an average of 1.3 out of 5.', 'Regarding "I feel anxious/stressed working on learning tasks, assignments, or in class": The student''s responses have been consistently low (which is good) in the last 24 hours. Statistics: average 1.3, min 1, max 2 (based on 3 responses).', NOW()),
    (test_user_id, 'enjoyment', '24h', 5.00, 5, 5, 3, 'stable_high', false, true, NULL, 'Your Enjoyment has been consistently high today, with an average of 5.0 out of 5.', 'Regarding "I enjoy my tasks and feel happy about my achievements/work/accomplishment": The student''s responses have been consistently high in the last 24 hours. Statistics: average 5.0, min 5, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'learning_from_feedback', '24h', 5.00, 5, 5, 3, 'stable_high', false, true, NULL, 'Your Learning from Feedback has been consistently high today, with an average of 5.0 out of 5.', 'Regarding "I am learning from feedback and mistakes to accomplish my learning": The student''s responses have been consistently high in the last 24 hours. Statistics: average 5.0, min 5, max 5 (based on 3 responses).', NOW()),
    (test_user_id, 'self_assessment', '24h', 3.00, 3, 3, 3, 'stable_avg', false, true, NULL, 'Your Self Assessment has been stable today, with an average of 3.0 out of 5.', 'Regarding "I always assess my performance or work on tasks to improve my skills": The student''s responses have been stable in the last 24 hours. Statistics: average 3.0, min 3, max 3 (based on 3 responses).', NOW());

    -- 7d annotations (calculated from actual response data: 14 responses over 7 days)
    INSERT INTO public.srl_annotations (user_id, concept_key, time_window, avg_score, min_score, max_score, response_count, trend, is_inverted, has_sufficient_data, distinct_day_count, annotation_text, annotation_text_llm, computed_at) VALUES
    (test_user_id, 'efficiency', '7d', 4.00, 2, 5, 14, 'improving', false, true, 7, 'Your Efficiency has been improving over the past 7 days, with an average of 4.0 out of 5.', 'Regarding "I believe I can accomplish my learning duties and learning tasks efficiently": The student''s responses have been improving over the past 7 days. Statistics: average 4.0, min 2, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'importance', '7d', 4.71, 4, 5, 14, 'stable_high', false, true, 7, 'Your Importance has been consistently high over the past 7 days, with an average of 4.7 out of 5.', 'Regarding "I believe that my learning tasks are very important to me": The student''s responses have been consistently high over the past 7 days. Statistics: average 4.7, min 4, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'tracking', '7d', 2.71, 2, 5, 14, 'declining', false, true, 7, 'Your Tracking has been declining over the past 7 days, with an average of 2.7 out of 5.', 'Regarding "I am keeping track of what I need to do or accomplish": The student''s responses have been declining over the past 7 days. Statistics: average 2.7, min 2, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'clarity', '7d', 2.93, 2, 5, 14, 'fluctuating', false, true, 7, 'Your Clarity has been fluctuating over the past 7 days, with an average of 2.9 out of 5.', 'Regarding "I know what I have to do to accomplish my learning tasks": The student''s responses have been fluctuating over the past 7 days. Statistics: average 2.9, min 2, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'effort', '7d', 3.64, 1, 5, 14, 'improving', false, true, 7, 'Your Effort has been improving over the past 7 days, with an average of 3.6 out of 5.', 'Regarding "I am putting enough effort into my learning tasks to accomplish them well": The student''s responses have been improving over the past 7 days. Statistics: average 3.6, min 1, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'focus', '7d', 3.00, 3, 3, 14, 'stable_avg', false, true, 7, 'Your Focus has been stable over the past 7 days, with an average of 3.0 out of 5.', 'Regarding "I am focusing on performing my learning tasks today and resisting distractions": The student''s responses have been stable over the past 7 days. Statistics: average 3.0, min 3, max 3 (based on 14 responses).', NOW()),
    (test_user_id, 'help_seeking', '7d', 4.00, 1, 5, 14, 'improving', false, true, 7, 'Your Help Seeking has been improving over the past 7 days, with an average of 4.0 out of 5.', 'Regarding "I seek help from teachers, friends, or the internet when I need explanation or help with difficult tasks": The student''s responses have been improving over the past 7 days. Statistics: average 4.0, min 1, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'community', '7d', 1.93, 1, 2, 14, 'stable_low', false, true, 7, 'Your Community has been consistently low over the past 7 days, with an average of 1.9 out of 5.', 'Regarding "I am having nice interactions and feeling at home within the college community": The student''s responses have been consistently low over the past 7 days. Statistics: average 1.9, min 1, max 2 (based on 14 responses).', NOW()),
    (test_user_id, 'timeliness', '7d', 2.50, 2, 4, 14, 'declining', false, true, 7, 'Your Timeliness has been declining over the past 7 days, with an average of 2.5 out of 5.', 'Regarding "I am doing my studies on time and keeping up with tasks/deadlines": The student''s responses have been declining over the past 7 days. Statistics: average 2.5, min 2, max 4 (based on 14 responses).', NOW()),
    (test_user_id, 'motivation', '7d', 3.57, 1, 5, 14, 'fluctuating', false, true, 7, 'Your Motivation has been fluctuating over the past 7 days, with an average of 3.6 out of 5.', 'Regarding "I feel enthusiastic/motivated to learn, understand, and get better grades": The student''s responses have been fluctuating over the past 7 days. Statistics: average 3.6, min 1, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'anxiety', '7d', 2.21, 1, 5, 14, 'improving', true, true, 7, 'Your Anxiety has been decreasing (which is good) over the past 7 days, with an average of 2.2 out of 5.', 'Regarding "I feel anxious/stressed working on learning tasks, assignments, or in class": The student''s responses have been decreasing (which is good) over the past 7 days. Statistics: average 2.2, min 1, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'enjoyment', '7d', 4.64, 4, 5, 14, 'stable_high', false, true, 7, 'Your Enjoyment has been consistently high over the past 7 days, with an average of 4.6 out of 5.', 'Regarding "I enjoy my tasks and feel happy about my achievements/work/accomplishment": The student''s responses have been consistently high over the past 7 days. Statistics: average 4.6, min 4, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'learning_from_feedback', '7d', 4.36, 2, 5, 14, 'improving', false, true, 7, 'Your Learning from Feedback has been improving over the past 7 days, with an average of 4.4 out of 5.', 'Regarding "I am learning from feedback and mistakes to accomplish my learning": The student''s responses have been improving over the past 7 days. Statistics: average 4.4, min 2, max 5 (based on 14 responses).', NOW()),
    (test_user_id, 'self_assessment', '7d', 3.07, 3, 4, 14, 'stable_avg', false, true, 7, 'Your Self Assessment has been stable over the past 7 days, with an average of 3.1 out of 5.', 'Regarding "I always assess my performance or work on tasks to improve my skills": The student''s responses have been stable over the past 7 days. Statistics: average 3.1, min 3, max 4 (based on 14 responses).', NOW());

    -- ============================================================================
    -- 5. SLEEP DATA (Average achiever pattern - irregular sleep)
    -- ============================================================================
    
    -- Delete existing sleep data for idempotency
    DELETE FROM public.sleep_judgments WHERE user_id = test_user_id;
    DELETE FROM public.sleep_sessions WHERE user_id = test_user_id;
    DELETE FROM public.sleep_baselines WHERE user_id = test_user_id;

    -- Insert sleep baseline
    INSERT INTO public.sleep_baselines (user_id, avg_total_sleep_minutes, avg_bedtime_hour, avg_wake_time_hour, sessions_count, computed_at)
    VALUES (test_user_id, 400, 23.5, 7.5, 7, NOW());

    -- Insert 7 days of sleep sessions (average pattern: variable, some disruptions)
    -- Day 7 (6 days ago) - Decent night
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0001-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '6 days',
        (CURRENT_DATE - INTERVAL '6 days' + TIME '23:30:00')::timestamptz,
        (CURRENT_DATE - INTERVAL '5 days' + TIME '07:00:00')::timestamptz,
        420, 450, 2, 8, true
    );

    -- Day 6 (5 days ago) - Poor night (late bedtime)
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0002-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '5 days',
        (CURRENT_DATE - INTERVAL '5 days' + TIME '01:30:00')::timestamptz,
        (CURRENT_DATE - INTERVAL '4 days' + TIME '07:30:00')::timestamptz,
        330, 360, 4, 18, true
    );

    -- Day 5 (4 days ago) - Fragmented
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0003-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '4 days',
        (CURRENT_DATE - INTERVAL '4 days' + TIME '00:00:00')::timestamptz,
        (CURRENT_DATE - INTERVAL '3 days' + TIME '07:45:00')::timestamptz,
        380, 465, 6, 35, true
    );

    -- Day 4 (3 days ago) - Good night
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0004-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '3 days',
        (CURRENT_DATE - INTERVAL '3 days' + TIME '23:00:00')::timestamptz,
        (CURRENT_DATE - INTERVAL '2 days' + TIME '07:15:00')::timestamptz,
        450, 495, 1, 5, true
    );

    -- Day 3 (2 days ago) - Average
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0005-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '2 days',
        (CURRENT_DATE - INTERVAL '2 days' + TIME '23:45:00')::timestamptz,
        (CURRENT_DATE - INTERVAL '1 day' + TIME '07:30:00')::timestamptz,
        405, 465, 3, 12, true
    );

    -- Day 2 (yesterday) - Short sleep
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0006-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE - INTERVAL '1 day',
        (CURRENT_DATE - INTERVAL '1 day' + TIME '00:30:00')::timestamptz,
        (CURRENT_DATE + TIME '06:30:00')::timestamptz,
        340, 360, 2, 10, true
    );

    -- Day 1 (last night) - Irregular timing
    INSERT INTO public.sleep_sessions (id, user_id, session_date, bedtime, wake_time, total_sleep_minutes, time_in_bed_minutes, awakenings_count, awake_minutes, is_simulated)
    VALUES (
        'b1b2c3d4-0007-7890-abcd-ef1234567890',
        test_user_id,
        CURRENT_DATE,
        (CURRENT_DATE + TIME '02:00:00')::timestamptz,
        (CURRENT_DATE + TIME '09:00:00')::timestamptz,
        390, 420, 3, 15, true
    );

    -- Insert sleep judgments for each session (4 domains each)
    -- Judgments for Day 7 (good night)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0001-7890-abcd-ef1234567890', 'duration', 'sleep_time_sufficient', 'ok', 'Sleep time was sufficient', 'Sleep duration was within the healthy range (420 minutes, close to the usual 400 minutes). Good job maintaining consistent sleep duration.', NOW()),
    (test_user_id, 'b1b2c3d4-0001-7890-abcd-ef1234567890', 'continuity', 'sleep_continuous', 'ok', 'Sleep was continuous', 'Sleep was continuous with minimal interruptions (2 awakenings, 8 minutes awake). This indicates good sleep quality and efficient rest.', NOW()),
    (test_user_id, 'b1b2c3d4-0001-7890-abcd-ef1234567890', 'timing', 'schedule_consistent', 'ok', 'Sleep schedule was consistent', 'Sleep schedule was consistent with usual patterns. Bedtime and wake time were within 30 minutes of the normal schedule.', NOW());

    -- Judgments for Day 6 (poor - late bedtime)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0002-7890-abcd-ef1234567890', 'duration', 'sleep_time_low', 'warning', 'Sleep time was slightly low', 'Sleep duration was slightly below normal (330 minutes, 83% of the usual 400 minutes). A bit more rest might help with focus and energy levels.', NOW()),
    (test_user_id, 'b1b2c3d4-0002-7890-abcd-ef1234567890', 'continuity', 'sleep_minor_interruptions', 'warning', 'Sleep had minor interruptions', 'Sleep had some interruptions (4 awakenings, 18 minutes awake). While not severe, this may slightly reduce the restorative quality of sleep.', NOW()),
    (test_user_id, 'b1b2c3d4-0002-7890-abcd-ef1234567890', 'timing', 'schedule_inconsistent', 'poor', 'Sleep schedule was inconsistent', 'Sleep schedule was significantly inconsistent. Bedtime was about 120 minutes off from the usual pattern.', NOW());

    -- Judgments for Day 5 (fragmented)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0003-7890-abcd-ef1234567890', 'duration', 'sleep_time_low', 'warning', 'Sleep time was slightly low', 'Sleep duration was slightly below normal (380 minutes, 95% of the usual 400 minutes).', NOW()),
    (test_user_id, 'b1b2c3d4-0003-7890-abcd-ef1234567890', 'continuity', 'sleep_fragmented', 'poor', 'Sleep was fragmented', 'Sleep was fragmented with significant time spent awake (6 awakenings, 35 minutes awake). This level of disruption typically reduces sleep quality.', NOW()),
    (test_user_id, 'b1b2c3d4-0003-7890-abcd-ef1234567890', 'timing', 'timing_slightly_irregular', 'warning', 'Sleep timing was slightly irregular', 'Sleep timing was slightly irregular, with bedtime shifted by about 30 minutes from the usual schedule.', NOW());

    -- Judgments for Day 4 (good night)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0004-7890-abcd-ef1234567890', 'duration', 'sleep_time_sufficient', 'ok', 'Sleep time was sufficient', 'Sleep duration was within the healthy range (450 minutes, 113% of the usual 400 minutes). Good job maintaining consistent sleep duration.', NOW()),
    (test_user_id, 'b1b2c3d4-0004-7890-abcd-ef1234567890', 'continuity', 'sleep_continuous', 'ok', 'Sleep was continuous', 'Sleep was continuous with minimal interruptions (1 awakening, 5 minutes awake). This indicates good sleep quality.', NOW()),
    (test_user_id, 'b1b2c3d4-0004-7890-abcd-ef1234567890', 'timing', 'schedule_consistent', 'ok', 'Sleep schedule was consistent', 'Sleep schedule was consistent with usual patterns. Bedtime and wake time were within 30 minutes of the normal schedule.', NOW());

    -- Judgments for Day 3 (average)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0005-7890-abcd-ef1234567890', 'duration', 'sleep_time_sufficient', 'ok', 'Sleep time was sufficient', 'Sleep duration was within the healthy range (405 minutes, close to the usual 400 minutes).', NOW()),
    (test_user_id, 'b1b2c3d4-0005-7890-abcd-ef1234567890', 'continuity', 'sleep_minor_interruptions', 'warning', 'Sleep had minor interruptions', 'Sleep had some interruptions (3 awakenings, 12 minutes awake).', NOW()),
    (test_user_id, 'b1b2c3d4-0005-7890-abcd-ef1234567890', 'timing', 'schedule_consistent', 'ok', 'Sleep schedule was consistent', 'Sleep schedule was consistent with usual patterns.', NOW());

    -- Judgments for Day 2 (short sleep)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0006-7890-abcd-ef1234567890', 'duration', 'sleep_time_low', 'warning', 'Sleep time was slightly low', 'Sleep duration was slightly below normal (340 minutes, 85% of the usual 400 minutes).', NOW()),
    (test_user_id, 'b1b2c3d4-0006-7890-abcd-ef1234567890', 'continuity', 'sleep_continuous', 'ok', 'Sleep was continuous', 'Sleep was continuous with minimal interruptions (2 awakenings, 10 minutes awake).', NOW()),
    (test_user_id, 'b1b2c3d4-0006-7890-abcd-ef1234567890', 'timing', 'timing_slightly_irregular', 'warning', 'Sleep timing was slightly irregular', 'Sleep timing was slightly irregular, with bedtime shifted by about 60 minutes from the usual schedule.', NOW());

    -- Judgments for Day 1 (last night - irregular timing)
    INSERT INTO public.sleep_judgments (user_id, session_id, domain, judgment_key, severity, explanation, explanation_llm, computed_at) VALUES
    (test_user_id, 'b1b2c3d4-0007-7890-abcd-ef1234567890', 'duration', 'sleep_time_sufficient', 'ok', 'Sleep time was sufficient', 'Sleep duration was within the healthy range (390 minutes, 98% of the usual 400 minutes).', NOW()),
    (test_user_id, 'b1b2c3d4-0007-7890-abcd-ef1234567890', 'continuity', 'sleep_minor_interruptions', 'warning', 'Sleep had minor interruptions', 'Sleep had some interruptions (3 awakenings, 15 minutes awake).', NOW()),
    (test_user_id, 'b1b2c3d4-0007-7890-abcd-ef1234567890', 'timing', 'schedule_inconsistent', 'poor', 'Sleep schedule was inconsistent', 'Sleep schedule was significantly inconsistent. Bedtime was about 150 minutes off from the usual pattern. Large timing shifts can disrupt circadian rhythm.', NOW());

    RAISE NOTICE 'Test student created successfully with 14 questionnaire responses, annotations, 7 sleep sessions, and sleep judgments';
END $$;

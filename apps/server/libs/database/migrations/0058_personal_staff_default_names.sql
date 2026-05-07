WITH candidates AS (
  SELECT
    bot_user.id AS bot_user_id,
    LOWER(COALESCE(owner_user.language, '')) AS owner_language,
    COALESCE(NULLIF(owner_user.display_name, ''), owner_user.username) AS owner_name
  FROM im_bots AS bot
  INNER JOIN im_installed_applications AS installed_app
    ON installed_app.id = bot.installed_application_id
  INNER JOIN im_users AS bot_user
    ON bot_user.id = bot.user_id
  INNER JOIN im_users AS owner_user
    ON owner_user.id = bot.owner_id
  WHERE installed_app.application_id = 'personal-staff'
    AND (
      bot_user.display_name IS NULL
      OR bot_user.display_name IN (
        'Personal Staff',
        'Personal Assistant',
        '私人秘书',
        '私人秘書',
        'パーソナルスタッフ',
        '퍼스널 스태프',
        'Assistente Pessoal',
        'Assistente pessoal',
        'Assistant personnel',
        'Persönlicher Assistent',
        'Assistente personale',
        'Persoonlijke assistent',
        'Личный помощник'
      )
    )
)
UPDATE im_users AS bot_user
SET
  display_name = CASE
    WHEN candidates.owner_language LIKE 'zh%' THEN candidates.owner_name || '的助理'
    WHEN candidates.owner_language LIKE 'ja%' THEN candidates.owner_name || 'のアシスタント'
    WHEN candidates.owner_language LIKE 'ko%' THEN candidates.owner_name || '님의 어시스턴트'
    WHEN candidates.owner_language LIKE 'es%' THEN 'Asistente de ' || candidates.owner_name
    WHEN candidates.owner_language LIKE 'pt%' THEN 'Assistente de ' || candidates.owner_name
    WHEN candidates.owner_language LIKE 'fr%' THEN 'Assistant de ' || candidates.owner_name
    WHEN candidates.owner_language LIKE 'de%' THEN candidates.owner_name || 's Assistent'
    WHEN candidates.owner_language LIKE 'it%' THEN 'Assistente di ' || candidates.owner_name
    WHEN candidates.owner_language LIKE 'nl%' THEN 'Assistent van ' || candidates.owner_name
    WHEN candidates.owner_language LIKE 'ru%' THEN 'Помощник ' || candidates.owner_name
    ELSE candidates.owner_name || '''s Assistant'
  END,
  updated_at = NOW()
FROM candidates
WHERE bot_user.id = candidates.bot_user_id;

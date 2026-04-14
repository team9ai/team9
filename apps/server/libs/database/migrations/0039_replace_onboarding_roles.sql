-- Replace all onboarding roles with updated catalog (12 languages)
DELETE FROM "onboarding_roles";
--> statement-breakpoint
INSERT INTO "onboarding_roles" (
	"id",
	"slug",
	"emoji",
	"label",
	"category",
	"category_key",
	"featured",
	"sort_order",
	"is_active"
) VALUES
	-- ═══════════════════════════════════════
	-- Creator
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'content-creator', '✍️',
		'{"en":"Content Creator","zh":"内容创作者","zh-TW":"內容創作者","es":"Creador de contenido","pt":"Criador de conteúdo","fr":"Créateur de contenu","de":"Content Creator","ja":"コンテンツクリエイター","ko":"콘텐츠 크리에이터","ru":"Контент-криэйтор","it":"Creatore di contenuti","nl":"Contentmaker"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', true, 1, true),
	(gen_random_uuid(), 'youtuber', '📺',
		'{"en":"YouTuber","zh":"YouTuber","zh-TW":"YouTuber","es":"YouTuber","pt":"YouTuber","fr":"YouTubeur","de":"YouTuber","ja":"YouTuber","ko":"유튜버","ru":"Ютубер","it":"YouTuber","nl":"YouTuber"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', false, 2, true),
	(gen_random_uuid(), 'tiktok-creator', '🎵',
		'{"en":"TikTok Creator","zh":"TikTok 创作者","zh-TW":"TikTok 創作者","es":"Creador de TikTok","pt":"Criador de TikTok","fr":"Créateur TikTok","de":"TikTok Creator","ja":"TikTokクリエイター","ko":"틱톡 크리에이터","ru":"TikTok-криэйтор","it":"Creatore TikTok","nl":"TikTok-maker"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', false, 3, true),
	(gen_random_uuid(), 'instagram-creator', '📸',
		'{"en":"Instagram Creator","zh":"Instagram 创作者","zh-TW":"Instagram 創作者","es":"Creador de Instagram","pt":"Criador de Instagram","fr":"Créateur Instagram","de":"Instagram Creator","ja":"Instagramクリエイター","ko":"인스타그램 크리에이터","ru":"Instagram-криэйтор","it":"Creatore Instagram","nl":"Instagram-maker"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', false, 4, true),
	(gen_random_uuid(), 'podcast-host', '🎙️',
		'{"en":"Podcast Host","zh":"播客主播","zh-TW":"Podcast 主持人","es":"Presentador de podcast","pt":"Apresentador de podcast","fr":"Animateur de podcast","de":"Podcast-Host","ja":"ポッドキャストホスト","ko":"팟캐스트 호스트","ru":"Ведущий подкаста","it":"Conduttore di podcast","nl":"Podcasthost"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', false, 5, true),
	(gen_random_uuid(), 'newsletter-host', '📧',
		'{"en":"Newsletter Host","zh":"Newsletter 主理人","zh-TW":"Newsletter 主理人","es":"Editor de newsletter","pt":"Editor de newsletter","fr":"Éditeur de newsletter","de":"Newsletter-Herausgeber","ja":"ニュースレター運営者","ko":"뉴스레터 운영자","ru":"Автор рассылки","it":"Editore di newsletter","nl":"Nieuwsbriefuitgever"}'::jsonb,
		'{"en":"Creator","zh":"创作者","zh-TW":"創作者","es":"Creador","pt":"Criador","fr":"Créateur","de":"Creator","ja":"クリエイター","ko":"크리에이터","ru":"Создатели","it":"Creatore","nl":"Creator"}'::jsonb,
		'creator', false, 6, true),

	-- ═══════════════════════════════════════
	-- Marketing
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'performance-marketer', '🎯',
		'{"en":"Performance Marketer","zh":"效果营销","zh-TW":"績效行銷","es":"Marketing de rendimiento","pt":"Marketing de performance","fr":"Marketing de performance","de":"Performance-Marketer","ja":"パフォーマンスマーケター","ko":"퍼포먼스 마케터","ru":"Перфоманс-маркетолог","it":"Performance marketer","nl":"Performance marketeer"}'::jsonb,
		'{"en":"Marketing","zh":"营销","zh-TW":"行銷","es":"Marketing","pt":"Marketing","fr":"Marketing","de":"Marketing","ja":"マーケティング","ko":"마케팅","ru":"Маркетинг","it":"Marketing","nl":"Marketing"}'::jsonb,
		'marketing', true, 1, true),
	(gen_random_uuid(), 'seo-manager', '🔍',
		'{"en":"SEO Manager","zh":"SEO 经理","zh-TW":"SEO 經理","es":"Gerente de SEO","pt":"Gerente de SEO","fr":"Responsable SEO","de":"SEO-Manager","ja":"SEOマネージャー","ko":"SEO 매니저","ru":"SEO-менеджер","it":"SEO manager","nl":"SEO-manager"}'::jsonb,
		'{"en":"Marketing","zh":"营销","zh-TW":"行銷","es":"Marketing","pt":"Marketing","fr":"Marketing","de":"Marketing","ja":"マーケティング","ko":"마케팅","ru":"Маркетинг","it":"Marketing","nl":"Marketing"}'::jsonb,
		'marketing', true, 2, true),
	(gen_random_uuid(), 'content-marketer', '📝',
		'{"en":"Content Marketer","zh":"内容营销","zh-TW":"內容行銷","es":"Marketing de contenidos","pt":"Marketing de conteúdo","fr":"Marketing de contenu","de":"Content-Marketer","ja":"コンテンツマーケター","ko":"콘텐츠 마케터","ru":"Контент-маркетолог","it":"Content marketer","nl":"Contentmarketeer"}'::jsonb,
		'{"en":"Marketing","zh":"营销","zh-TW":"行銷","es":"Marketing","pt":"Marketing","fr":"Marketing","de":"Marketing","ja":"マーケティング","ko":"마케팅","ru":"Маркетинг","it":"Marketing","nl":"Marketing"}'::jsonb,
		'marketing', true, 3, true),
	(gen_random_uuid(), 'lifecycle-marketing-manager', '🔄',
		'{"en":"Lifecycle Marketing Manager","zh":"生命周期营销经理","zh-TW":"生命週期行銷經理","es":"Gerente de marketing de ciclo de vida","pt":"Gerente de marketing de ciclo de vida","fr":"Responsable marketing lifecycle","de":"Lifecycle-Marketing-Manager","ja":"ライフサイクルマーケティングマネージャー","ko":"라이프사이클 마케팅 매니저","ru":"Менеджер lifecycle-маркетинга","it":"Lifecycle marketing manager","nl":"Lifecycle marketing manager"}'::jsonb,
		'{"en":"Marketing","zh":"营销","zh-TW":"行銷","es":"Marketing","pt":"Marketing","fr":"Marketing","de":"Marketing","ja":"マーケティング","ko":"마케팅","ru":"Маркетинг","it":"Marketing","nl":"Marketing"}'::jsonb,
		'marketing', false, 4, true),

	-- ═══════════════════════════════════════
	-- Sales
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'sdr-bdr', '📞',
		'{"en":"SDR / BDR","zh":"SDR / BDR","zh-TW":"SDR / BDR","es":"SDR / BDR","pt":"SDR / BDR","fr":"SDR / BDR","de":"SDR / BDR","ja":"SDR / BDR","ko":"SDR / BDR","ru":"SDR / BDR","it":"SDR / BDR","nl":"SDR / BDR"}'::jsonb,
		'{"en":"Sales","zh":"销售","zh-TW":"銷售","es":"Ventas","pt":"Vendas","fr":"Ventes","de":"Vertrieb","ja":"セールス","ko":"영업","ru":"Продажи","it":"Vendite","nl":"Sales"}'::jsonb,
		'sales', true, 1, true),
	(gen_random_uuid(), 'account-executive', '💬',
		'{"en":"Account Executive","zh":"客户经理","zh-TW":"客戶經理","es":"Ejecutivo de cuentas","pt":"Executivo de contas","fr":"Responsable de comptes","de":"Account Executive","ja":"アカウントエグゼクティブ","ko":"어카운트 엑세큐티브","ru":"Менеджер по работе с клиентами","it":"Account executive","nl":"Account executive"}'::jsonb,
		'{"en":"Sales","zh":"销售","zh-TW":"銷售","es":"Ventas","pt":"Vendas","fr":"Ventes","de":"Vertrieb","ja":"セールス","ko":"영업","ru":"Продажи","it":"Vendite","nl":"Sales"}'::jsonb,
		'sales', false, 2, true),
	(gen_random_uuid(), 'account-manager', '🤝',
		'{"en":"Account Manager","zh":"客户管理","zh-TW":"客戶管理","es":"Gerente de cuentas","pt":"Gerente de contas","fr":"Gestionnaire de comptes","de":"Account Manager","ja":"アカウントマネージャー","ko":"어카운트 매니저","ru":"Аккаунт-менеджер","it":"Account manager","nl":"Accountmanager"}'::jsonb,
		'{"en":"Sales","zh":"销售","zh-TW":"銷售","es":"Ventas","pt":"Vendas","fr":"Ventes","de":"Vertrieb","ja":"セールス","ko":"영업","ru":"Продажи","it":"Vendite","nl":"Sales"}'::jsonb,
		'sales', false, 3, true),

	-- ═══════════════════════════════════════
	-- Ecommerce
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'ecommerce-manager', '🛒',
		'{"en":"Ecommerce Manager","zh":"电商运营","zh-TW":"電商運營","es":"Gerente de e-commerce","pt":"Gerente de e-commerce","fr":"Responsable e-commerce","de":"E-Commerce-Manager","ja":"ECマネージャー","ko":"이커머스 매니저","ru":"E-commerce менеджер","it":"E-commerce manager","nl":"E-commercemanager"}'::jsonb,
		'{"en":"Ecommerce","zh":"电商","zh-TW":"電商","es":"E-commerce","pt":"E-commerce","fr":"E-commerce","de":"E-Commerce","ja":"EC","ko":"이커머스","ru":"E-commerce","it":"E-commerce","nl":"E-commerce"}'::jsonb,
		'ecommerce', false, 1, true),
	(gen_random_uuid(), 'amazon-seller', '📦',
		'{"en":"Amazon Seller","zh":"亚马逊卖家","zh-TW":"亞馬遜賣家","es":"Vendedor de Amazon","pt":"Vendedor da Amazon","fr":"Vendeur Amazon","de":"Amazon-Verkäufer","ja":"Amazonセラー","ko":"아마존 셀러","ru":"Продавец на Amazon","it":"Venditore Amazon","nl":"Amazon-verkoper"}'::jsonb,
		'{"en":"Ecommerce","zh":"电商","zh-TW":"電商","es":"E-commerce","pt":"E-commerce","fr":"E-commerce","de":"E-Commerce","ja":"EC","ko":"이커머스","ru":"E-commerce","it":"E-commerce","nl":"E-commerce"}'::jsonb,
		'ecommerce', false, 2, true),
	(gen_random_uuid(), 'shopify-seller', '🛍️',
		'{"en":"Shopify Seller","zh":"Shopify 商家","zh-TW":"Shopify 商家","es":"Vendedor de Shopify","pt":"Vendedor Shopify","fr":"Vendeur Shopify","de":"Shopify-Verkäufer","ja":"Shopifyセラー","ko":"Shopify 셀러","ru":"Продавец на Shopify","it":"Venditore Shopify","nl":"Shopify-verkoper"}'::jsonb,
		'{"en":"Ecommerce","zh":"电商","zh-TW":"電商","es":"E-commerce","pt":"E-commerce","fr":"E-commerce","de":"E-Commerce","ja":"EC","ko":"이커머스","ru":"E-commerce","it":"E-commerce","nl":"E-commerce"}'::jsonb,
		'ecommerce', true, 3, true),

	-- ═══════════════════════════════════════
	-- Finance
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'investment-analyst', '📊',
		'{"en":"Investment Analyst","zh":"投资分析师","zh-TW":"投資分析師","es":"Analista de inversiones","pt":"Analista de investimentos","fr":"Analyste en investissement","de":"Investmentanalyst","ja":"投資アナリスト","ko":"투자 애널리스트","ru":"Инвестиционный аналитик","it":"Analista degli investimenti","nl":"Investeringsanalist"}'::jsonb,
		'{"en":"Finance","zh":"金融","zh-TW":"金融","es":"Finanzas","pt":"Finanças","fr":"Finance","de":"Finanzen","ja":"ファイナンス","ko":"금융","ru":"Финансы","it":"Finanza","nl":"Financiën"}'::jsonb,
		'finance', false, 1, true),
	(gen_random_uuid(), 'equity-research-analyst', '📈',
		'{"en":"Equity Research Analyst","zh":"股票研究分析师","zh-TW":"股票研究分析師","es":"Analista de renta variable","pt":"Analista de pesquisa de ações","fr":"Analyste recherche actions","de":"Equity-Research-Analyst","ja":"エクイティリサーチアナリスト","ko":"주식 리서치 애널리스트","ru":"Аналитик фондового рынка","it":"Analista ricerca azionaria","nl":"Equity research-analist"}'::jsonb,
		'{"en":"Finance","zh":"金融","zh-TW":"金融","es":"Finanzas","pt":"Finanças","fr":"Finance","de":"Finanzen","ja":"ファイナンス","ko":"금융","ru":"Финансы","it":"Finanza","nl":"Financiën"}'::jsonb,
		'finance', false, 2, true),
	(gen_random_uuid(), 'fpa-manager', '🧮',
		'{"en":"FP&A Manager","zh":"FP&A 经理","zh-TW":"FP&A 經理","es":"Gerente de FP&A","pt":"Gerente de FP&A","fr":"Responsable FP&A","de":"FP&A-Manager","ja":"FP&Aマネージャー","ko":"FP&A 매니저","ru":"FP&A менеджер","it":"FP&A manager","nl":"FP&A-manager"}'::jsonb,
		'{"en":"Finance","zh":"金融","zh-TW":"金融","es":"Finanzas","pt":"Finanças","fr":"Finance","de":"Finanzen","ja":"ファイナンス","ko":"금융","ru":"Финансы","it":"Finanza","nl":"Financiën"}'::jsonb,
		'finance', false, 3, true),
	(gen_random_uuid(), 'venture-capital-associate', '💰',
		'{"en":"Venture Capital Associate","zh":"风险投资经理","zh-TW":"創投經理","es":"Asociado de capital de riesgo","pt":"Associado de capital de risco","fr":"Associé capital-risque","de":"Venture-Capital-Associate","ja":"ベンチャーキャピタルアソシエイト","ko":"벤처캐피탈 어소시에이트","ru":"Специалист по венчурным инвестициям","it":"Associato venture capital","nl":"Venture capital-medewerker"}'::jsonb,
		'{"en":"Finance","zh":"金融","zh-TW":"金融","es":"Finanzas","pt":"Finanças","fr":"Finance","de":"Finanzen","ja":"ファイナンス","ko":"금융","ru":"Финансы","it":"Finanza","nl":"Financiën"}'::jsonb,
		'finance', false, 4, true),

	-- ═══════════════════════════════════════
	-- Investment Banking
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'investment-banking-analyst', '🏦',
		'{"en":"Investment Banking Analyst","zh":"投行分析师","zh-TW":"投行分析師","es":"Analista de banca de inversión","pt":"Analista de banco de investimento","fr":"Analyste banque d''investissement","de":"Investmentbanking-Analyst","ja":"投資銀行アナリスト","ko":"투자은행 애널리스트","ru":"Аналитик инвестбанка","it":"Analista investment banking","nl":"Investmentbanking-analist"}'::jsonb,
		'{"en":"Investment Banking","zh":"投行","zh-TW":"投行","es":"Banca de inversión","pt":"Banco de investimento","fr":"Banque d''investissement","de":"Investmentbanking","ja":"投資銀行","ko":"투자은행","ru":"Инвестбанкинг","it":"Investment Banking","nl":"Zakenbank"}'::jsonb,
		'investment_banking', false, 1, true),
	(gen_random_uuid(), 'ma-analyst', '📑',
		'{"en":"M&A Analyst","zh":"并购分析师","zh-TW":"併購分析師","es":"Analista de M&A","pt":"Analista de M&A","fr":"Analyste M&A","de":"M&A-Analyst","ja":"M&Aアナリスト","ko":"M&A 애널리스트","ru":"Аналитик M&A","it":"Analista M&A","nl":"M&A-analist"}'::jsonb,
		'{"en":"Investment Banking","zh":"投行","zh-TW":"投行","es":"Banca de inversión","pt":"Banco de investimento","fr":"Banque d''investissement","de":"Investmentbanking","ja":"投資銀行","ko":"투자은행","ru":"Инвестбанкинг","it":"Investment Banking","nl":"Zakenbank"}'::jsonb,
		'investment_banking', false, 2, true),

	-- ═══════════════════════════════════════
	-- Consulting
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'strategy-consultant', '🧭',
		'{"en":"Strategy Consultant","zh":"战略咨询顾问","zh-TW":"策略諮詢顧問","es":"Consultor de estrategia","pt":"Consultor de estratégia","fr":"Consultant en stratégie","de":"Strategieberater","ja":"戦略コンサルタント","ko":"전략 컨설턴트","ru":"Стратегический консультант","it":"Consulente strategico","nl":"Strategieconsultant"}'::jsonb,
		'{"en":"Consulting","zh":"咨询","zh-TW":"諮詢","es":"Consultoría","pt":"Consultoria","fr":"Conseil","de":"Beratung","ja":"コンサルティング","ko":"컨설팅","ru":"Консалтинг","it":"Consulenza","nl":"Consulting"}'::jsonb,
		'consulting', false, 1, true),
	(gen_random_uuid(), 'management-consultant', '📌',
		'{"en":"Management Consultant","zh":"管理咨询顾问","zh-TW":"管理諮詢顧問","es":"Consultor de gestión","pt":"Consultor de gestão","fr":"Consultant en management","de":"Managementberater","ja":"経営コンサルタント","ko":"경영 컨설턴트","ru":"Управленческий консультант","it":"Consulente di gestione","nl":"Managementconsultant"}'::jsonb,
		'{"en":"Consulting","zh":"咨询","zh-TW":"諮詢","es":"Consultoría","pt":"Consultoria","fr":"Conseil","de":"Beratung","ja":"コンサルティング","ko":"컨설팅","ru":"Консалтинг","it":"Consulenza","nl":"Consulting"}'::jsonb,
		'consulting', false, 2, true),
	(gen_random_uuid(), 'business-analyst', '🔎',
		'{"en":"Business Analyst","zh":"商业分析师","zh-TW":"商業分析師","es":"Analista de negocios","pt":"Analista de negócios","fr":"Analyste d''affaires","de":"Business Analyst","ja":"ビジネスアナリスト","ko":"비즈니스 애널리스트","ru":"Бизнес-аналитик","it":"Business analyst","nl":"Business analist"}'::jsonb,
		'{"en":"Consulting","zh":"咨询","zh-TW":"諮詢","es":"Consultoría","pt":"Consultoria","fr":"Conseil","de":"Beratung","ja":"コンサルティング","ko":"컨설팅","ru":"Консалтинг","it":"Consulenza","nl":"Consulting"}'::jsonb,
		'consulting', false, 3, true),

	-- ═══════════════════════════════════════
	-- Legal
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'corporate-counsel', '⚖️',
		'{"en":"Corporate Counsel","zh":"公司法务","zh-TW":"公司法務","es":"Abogado corporativo","pt":"Advogado corporativo","fr":"Juriste d''entreprise","de":"Unternehmensjurist","ja":"企業法務","ko":"기업 법무","ru":"Корпоративный юрист","it":"Avvocato d''impresa","nl":"Bedrijfsjurist"}'::jsonb,
		'{"en":"Legal","zh":"法律","zh-TW":"法律","es":"Legal","pt":"Jurídico","fr":"Juridique","de":"Recht","ja":"法務","ko":"법률","ru":"Право","it":"Legale","nl":"Juridisch"}'::jsonb,
		'legal', false, 1, true),
	(gen_random_uuid(), 'commercial-counsel', '📄',
		'{"en":"Commercial Counsel","zh":"商事律师","zh-TW":"商事律師","es":"Abogado comercial","pt":"Advogado comercial","fr":"Juriste commercial","de":"Wirtschaftsjurist","ja":"商事弁護士","ko":"상사 변호사","ru":"Коммерческий юрист","it":"Avvocato commerciale","nl":"Commercieel jurist"}'::jsonb,
		'{"en":"Legal","zh":"法律","zh-TW":"法律","es":"Legal","pt":"Jurídico","fr":"Juridique","de":"Recht","ja":"法務","ko":"법률","ru":"Право","it":"Legale","nl":"Juridisch"}'::jsonb,
		'legal', false, 2, true),
	(gen_random_uuid(), 'paralegal', '📋',
		'{"en":"Paralegal","zh":"律师助理","zh-TW":"律師助理","es":"Paralegal","pt":"Paralegal","fr":"Parajuriste","de":"Rechtsanwaltsfachangestellter","ja":"パラリーガル","ko":"패러리걸","ru":"Помощник юриста","it":"Paralegale","nl":"Juridisch medewerker"}'::jsonb,
		'{"en":"Legal","zh":"法律","zh-TW":"法律","es":"Legal","pt":"Jurídico","fr":"Juridique","de":"Recht","ja":"法務","ko":"법률","ru":"Право","it":"Legale","nl":"Juridisch"}'::jsonb,
		'legal', false, 3, true),

	-- ═══════════════════════════════════════
	-- Education
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'online-tutor', '🧑‍🏫',
		'{"en":"Online Tutor","zh":"在线导师","zh-TW":"線上導師","es":"Tutor en línea","pt":"Tutor online","fr":"Tuteur en ligne","de":"Online-Tutor","ja":"オンライン講師","ko":"온라인 튜터","ru":"Онлайн-репетитор","it":"Tutor online","nl":"Online tutor"}'::jsonb,
		'{"en":"Education","zh":"教育","zh-TW":"教育","es":"Educación","pt":"Educação","fr":"Éducation","de":"Bildung","ja":"教育","ko":"교육","ru":"Образование","it":"Istruzione","nl":"Onderwijs"}'::jsonb,
		'education', false, 1, true),
	(gen_random_uuid(), 'instructional-designer', '🗒️',
		'{"en":"Instructional Designer","zh":"教学设计师","zh-TW":"教學設計師","es":"Diseñador instruccional","pt":"Designer instrucional","fr":"Concepteur pédagogique","de":"Instruktionsdesigner","ja":"インストラクショナルデザイナー","ko":"교수 설계자","ru":"Разработчик учебных программ","it":"Progettista didattico","nl":"Instructieontwerper"}'::jsonb,
		'{"en":"Education","zh":"教育","zh-TW":"教育","es":"Educación","pt":"Educação","fr":"Éducation","de":"Bildung","ja":"教育","ko":"교육","ru":"Образование","it":"Istruzione","nl":"Onderwijs"}'::jsonb,
		'education', false, 2, true),
	(gen_random_uuid(), 'research-assistant', '📚',
		'{"en":"Research Assistant","zh":"研究助理","zh-TW":"研究助理","es":"Asistente de investigación","pt":"Assistente de pesquisa","fr":"Assistant de recherche","de":"Forschungsassistent","ja":"リサーチアシスタント","ko":"연구 조교","ru":"Научный ассистент","it":"Assistente di ricerca","nl":"Onderzoeksassistent"}'::jsonb,
		'{"en":"Education","zh":"教育","zh-TW":"教育","es":"Educación","pt":"Educação","fr":"Éducation","de":"Bildung","ja":"教育","ko":"교육","ru":"Образование","it":"Istruzione","nl":"Onderwijs"}'::jsonb,
		'education', false, 3, true),
	(gen_random_uuid(), 'student', '🎓',
		'{"en":"Student","zh":"学生","zh-TW":"學生","es":"Estudiante","pt":"Estudante","fr":"Étudiant","de":"Student","ja":"学生","ko":"학생","ru":"Студент","it":"Studente","nl":"Student"}'::jsonb,
		'{"en":"Education","zh":"教育","zh-TW":"教育","es":"Educación","pt":"Educação","fr":"Éducation","de":"Bildung","ja":"教育","ko":"교육","ru":"Образование","it":"Istruzione","nl":"Onderwijs"}'::jsonb,
		'education', false, 4, true),

	-- ═══════════════════════════════════════
	-- Corporate Functions
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'recruiter', '👤',
		'{"en":"Recruiter","zh":"招聘专员","zh-TW":"招聘專員","es":"Reclutador","pt":"Recrutador","fr":"Recruteur","de":"Recruiter","ja":"リクルーター","ko":"리크루터","ru":"Рекрутер","it":"Recruiter","nl":"Recruiter"}'::jsonb,
		'{"en":"Corporate Functions","zh":"企业职能","zh-TW":"企業職能","es":"Funciones corporativas","pt":"Funções corporativas","fr":"Fonctions d''entreprise","de":"Unternehmensfunktionen","ja":"コーポレート","ko":"기업 기능","ru":"Корпоративные функции","it":"Funzioni aziendali","nl":"Bedrijfsfuncties"}'::jsonb,
		'corporate_functions', false, 1, true),
	(gen_random_uuid(), 'procurement-manager', '🧾',
		'{"en":"Procurement Manager","zh":"采购经理","zh-TW":"採購經理","es":"Gerente de compras","pt":"Gerente de compras","fr":"Responsable achats","de":"Einkaufsleiter","ja":"調達マネージャー","ko":"구매 매니저","ru":"Менеджер по закупкам","it":"Responsabile acquisti","nl":"Inkoopmanager"}'::jsonb,
		'{"en":"Corporate Functions","zh":"企业职能","zh-TW":"企業職能","es":"Funciones corporativas","pt":"Funções corporativas","fr":"Fonctions d''entreprise","de":"Unternehmensfunktionen","ja":"コーポレート","ko":"기업 기능","ru":"Корпоративные функции","it":"Funzioni aziendali","nl":"Bedrijfsfuncties"}'::jsonb,
		'corporate_functions', false, 2, true),
	(gen_random_uuid(), 'compliance-manager', '🛡️',
		'{"en":"Compliance Manager","zh":"合规经理","zh-TW":"合規經理","es":"Gerente de cumplimiento","pt":"Gerente de compliance","fr":"Responsable conformité","de":"Compliance-Manager","ja":"コンプライアンスマネージャー","ko":"컴플라이언스 매니저","ru":"Менеджер по комплаенсу","it":"Compliance manager","nl":"Compliance manager"}'::jsonb,
		'{"en":"Corporate Functions","zh":"企业职能","zh-TW":"企業職能","es":"Funciones corporativas","pt":"Funções corporativas","fr":"Fonctions d''entreprise","de":"Unternehmensfunktionen","ja":"コーポレート","ko":"기업 기능","ru":"Корпоративные функции","it":"Funzioni aziendali","nl":"Bedrijfsfuncties"}'::jsonb,
		'corporate_functions', false, 3, true),
	(gen_random_uuid(), 'administrative-manager', '🗄️',
		'{"en":"Administrative Manager","zh":"行政经理","zh-TW":"行政經理","es":"Gerente administrativo","pt":"Gerente administrativo","fr":"Responsable administratif","de":"Verwaltungsleiter","ja":"管理部門マネージャー","ko":"행정 매니저","ru":"Административный менеджер","it":"Responsabile amministrativo","nl":"Administratief manager"}'::jsonb,
		'{"en":"Corporate Functions","zh":"企业职能","zh-TW":"企業職能","es":"Funciones corporativas","pt":"Funções corporativas","fr":"Fonctions d''entreprise","de":"Unternehmensfunktionen","ja":"コーポレート","ko":"기업 기능","ru":"Корпоративные функции","it":"Funzioni aziendali","nl":"Bedrijfsfuncties"}'::jsonb,
		'corporate_functions', false, 4, true),

	-- ═══════════════════════════════════════
	-- Advisors & Agents
	-- ═══════════════════════════════════════
	(gen_random_uuid(), 'real-estate-agent', '🏠',
		'{"en":"Real Estate Agent","zh":"房产经纪人","zh-TW":"房產經紀人","es":"Agente inmobiliario","pt":"Corretor de imóveis","fr":"Agent immobilier","de":"Immobilienmakler","ja":"不動産エージェント","ko":"부동산 에이전트","ru":"Агент по недвижимости","it":"Agente immobiliare","nl":"Makelaar"}'::jsonb,
		'{"en":"Advisors & Agents","zh":"顾问与经纪","zh-TW":"顧問與經紀","es":"Asesores y agentes","pt":"Consultores e agentes","fr":"Conseillers et agents","de":"Berater & Makler","ja":"アドバイザー","ko":"어드바이저","ru":"Консультанты","it":"Consulenti e agenti","nl":"Adviseurs"}'::jsonb,
		'advisors_agents', false, 1, true),
	(gen_random_uuid(), 'insurance-agent', '📘',
		'{"en":"Insurance Agent","zh":"保险经纪人","zh-TW":"保險經紀人","es":"Agente de seguros","pt":"Corretor de seguros","fr":"Agent d''assurance","de":"Versicherungsvertreter","ja":"保険代理人","ko":"보험 에이전트","ru":"Страховой агент","it":"Agente assicurativo","nl":"Verzekeringsagent"}'::jsonb,
		'{"en":"Advisors & Agents","zh":"顾问与经纪","zh-TW":"顧問與經紀","es":"Asesores y agentes","pt":"Consultores e agentes","fr":"Conseillers et agents","de":"Berater & Makler","ja":"アドバイザー","ko":"어드바이저","ru":"Консультанты","it":"Consulenti e agenti","nl":"Adviseurs"}'::jsonb,
		'advisors_agents', false, 2, true),
	(gen_random_uuid(), 'mortgage-broker', '🏡',
		'{"en":"Mortgage Broker","zh":"贷款经纪人","zh-TW":"貸款經紀人","es":"Corredor hipotecario","pt":"Corretor de hipoteca","fr":"Courtier en prêt immobilier","de":"Hypothekenmakler","ja":"住宅ローンブローカー","ko":"모기지 브로커","ru":"Ипотечный брокер","it":"Broker ipotecario","nl":"Hypotheekadviseur"}'::jsonb,
		'{"en":"Advisors & Agents","zh":"顾问与经纪","zh-TW":"顧問與經紀","es":"Asesores y agentes","pt":"Consultores e agentes","fr":"Conseillers et agents","de":"Berater & Makler","ja":"アドバイザー","ko":"어드바이저","ru":"Консультанты","it":"Consulenti e agenti","nl":"Adviseurs"}'::jsonb,
		'advisors_agents', false, 3, true),
	(gen_random_uuid(), 'financial-advisor', '💼',
		'{"en":"Financial Advisor","zh":"理财顾问","zh-TW":"理財顧問","es":"Asesor financiero","pt":"Consultor financeiro","fr":"Conseiller financier","de":"Finanzberater","ja":"ファイナンシャルアドバイザー","ko":"재무 어드바이저","ru":"Финансовый советник","it":"Consulente finanziario","nl":"Financieel adviseur"}'::jsonb,
		'{"en":"Advisors & Agents","zh":"顾问与经纪","zh-TW":"顧問與經紀","es":"Asesores y agentes","pt":"Consultores e agentes","fr":"Conseillers et agents","de":"Berater & Makler","ja":"アドバイザー","ko":"어드바이저","ru":"Консультанты","it":"Consulenti e agenti","nl":"Adviseurs"}'::jsonb,
		'advisors_agents', false, 4, true);

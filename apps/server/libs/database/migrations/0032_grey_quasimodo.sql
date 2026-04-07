CREATE TYPE "public"."push_platform" AS ENUM('ios', 'android');--> statement-breakpoint
CREATE TABLE "im_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" varchar(512),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "unique_push_endpoint" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "im_user_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(512) NOT NULL,
	"platform" "push_platform" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_user_push_token" UNIQUE("user_id","token")
);
--> statement-breakpoint
CREATE TABLE "onboarding_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(100) NOT NULL,
	"emoji" varchar(16) NOT NULL,
	"label" jsonb NOT NULL,
	"category" jsonb NOT NULL,
	"category_key" varchar(32) NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_roles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "workspace_onboarding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"step_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_onboarding_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "im_push_subscriptions" ADD CONSTRAINT "im_push_subscriptions_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_user_push_tokens" ADD CONSTRAINT "im_user_push_tokens_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ADD CONSTRAINT "workspace_onboarding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_onboarding" ADD CONSTRAINT "workspace_onboarding_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_push_sub_user" ON "im_push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_push_tokens_user_id" ON "im_user_push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "onboarding_roles_category_idx" ON "onboarding_roles" USING btree ("category_key");--> statement-breakpoint
CREATE INDEX "onboarding_roles_active_idx" ON "onboarding_roles" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "workspace_onboarding_tenant_idx" ON "workspace_onboarding" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workspace_onboarding_user_idx" ON "workspace_onboarding" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bots_owner_app_unique" ON "im_bots" USING btree ("owner_id","installed_application_id") WHERE "im_bots"."owner_id" IS NOT NULL AND "im_bots"."installed_application_id" IS NOT NULL AND "im_bots"."extra"->>'personalStaff' IS NOT NULL;--> statement-breakpoint
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
	(gen_random_uuid(), 'investment-banking-analyst', '🏦', '{"zh":"投行分析师","en":"Investment Banking Analyst"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', true, 1, true),
	(gen_random_uuid(), 'ma-advisor', '📑', '{"zh":"并购顾问","en":"M&A Advisor"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 2, true),
	(gen_random_uuid(), 'private-equity-manager', '💼', '{"zh":"私募投资经理","en":"Private Equity Manager"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 3, true),
	(gen_random_uuid(), 'equity-researcher', '📊', '{"zh":"二级研究员","en":"Equity Researcher"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 4, true),
	(gen_random_uuid(), 'fund-manager', '💹', '{"zh":"基金经理","en":"Fund Manager"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 5, true),
	(gen_random_uuid(), 'wealth-advisor', '📈', '{"zh":"财富顾问","en":"Wealth Advisor"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 6, true),
	(gen_random_uuid(), 'risk-manager', '🛡️', '{"zh":"风控经理","en":"Risk Manager"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 7, true),
	(gen_random_uuid(), 'accountant', '🧾', '{"zh":"会计师","en":"Accountant"}'::jsonb, '{"zh":"金融","en":"Finance"}'::jsonb, 'finance', false, 8, true),
	(gen_random_uuid(), 'lawyer', '⚖️', '{"zh":"律师","en":"Lawyer"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', true, 1, true),
	(gen_random_uuid(), 'inhouse-counsel', '📄', '{"zh":"公司法务","en":"In-house Counsel"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', false, 2, true),
	(gen_random_uuid(), 'compliance-lawyer', '🧾', '{"zh":"合规律师","en":"Compliance Lawyer"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', false, 3, true),
	(gen_random_uuid(), 'ip-lawyer', '🧠', '{"zh":"知识产权律师","en":"IP Lawyer"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', false, 4, true),
	(gen_random_uuid(), 'litigation-lawyer', '🏛️', '{"zh":"诉讼律师","en":"Litigation Lawyer"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', false, 5, true),
	(gen_random_uuid(), 'contract-manager', '✒️', '{"zh":"合同经理","en":"Contract Manager"}'::jsonb, '{"zh":"法律","en":"Legal"}'::jsonb, 'legal', false, 6, true),
	(gen_random_uuid(), 'strategy-consultant', '🧭', '{"zh":"战略咨询顾问","en":"Strategy Consultant"}'::jsonb, '{"zh":"咨询","en":"Consulting"}'::jsonb, 'consulting', true, 1, true),
	(gen_random_uuid(), 'management-consultant', '📌', '{"zh":"管理咨询顾问","en":"Management Consultant"}'::jsonb, '{"zh":"咨询","en":"Consulting"}'::jsonb, 'consulting', false, 2, true),
	(gen_random_uuid(), 'industry-consultant', '🔎', '{"zh":"行业研究顾问","en":"Industry Consultant"}'::jsonb, '{"zh":"咨询","en":"Consulting"}'::jsonb, 'consulting', false, 3, true),
	(gen_random_uuid(), 'esg-consultant', '🌿', '{"zh":"ESG 顾问","en":"ESG Consultant"}'::jsonb, '{"zh":"咨询","en":"Consulting"}'::jsonb, 'consulting', false, 4, true),
	(gen_random_uuid(), 'finance-consultant', '🧮', '{"zh":"财务顾问","en":"Finance Consultant"}'::jsonb, '{"zh":"咨询","en":"Consulting"}'::jsonb, 'consulting', false, 5, true),
	(gen_random_uuid(), 'marketing-specialist', '📢', '{"zh":"市场专员","en":"Marketing Specialist"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', true, 1, true),
	(gen_random_uuid(), 'growth-marketer', '📈', '{"zh":"增长营销","en":"Growth Marketer"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', true, 2, true),
	(gen_random_uuid(), 'media-buyer', '🎯', '{"zh":"广告投手","en":"Media Buyer"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', false, 3, true),
	(gen_random_uuid(), 'seo-specialist', '🔍', '{"zh":"SEO 专员","en":"SEO Specialist"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', false, 4, true),
	(gen_random_uuid(), 'content-marketer', '📝', '{"zh":"内容营销","en":"Content Marketer"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', false, 5, true),
	(gen_random_uuid(), 'social-media-manager', '📱', '{"zh":"社媒经理","en":"Social Media Manager"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', false, 6, true),
	(gen_random_uuid(), 'pr-manager', '📣', '{"zh":"PR 经理","en":"PR Manager"}'::jsonb, '{"zh":"营销","en":"Marketing"}'::jsonb, 'marketing', false, 7, true),
	(gen_random_uuid(), 'b2b-sales', '🤝', '{"zh":"B2B 销售","en":"B2B Sales"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', true, 1, true),
	(gen_random_uuid(), 'account-executive', '💬', '{"zh":"客户经理","en":"Account Executive"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 2, true),
	(gen_random_uuid(), 'sales-manager', '📞', '{"zh":"销售经理","en":"Sales Manager"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 3, true),
	(gen_random_uuid(), 'business-development', '🧱', '{"zh":"商务拓展","en":"Business Development"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 4, true),
	(gen_random_uuid(), 'channel-manager', '🔗', '{"zh":"渠道经理","en":"Channel Manager"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 5, true),
	(gen_random_uuid(), 'pre-sales-consultant', '🖥️', '{"zh":"售前顾问","en":"Pre-sales Consultant"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 6, true),
	(gen_random_uuid(), 'insurance-broker', '📘', '{"zh":"保险经纪人","en":"Insurance Broker"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', true, 7, true),
	(gen_random_uuid(), 'real-estate-sales', '🏠', '{"zh":"房产销售","en":"Real Estate Sales"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 8, true),
	(gen_random_uuid(), 'course-consultant', '🎓', '{"zh":"课程顾问","en":"Course Consultant"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 9, true),
	(gen_random_uuid(), 'auto-sales', '🚗', '{"zh":"汽车销售","en":"Auto Sales"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 10, true),
	(gen_random_uuid(), 'medical-aesthetics-consultant', '✨', '{"zh":"医美咨询","en":"Medical Aesthetics Consultant"}'::jsonb, '{"zh":"销售","en":"Sales"}'::jsonb, 'sales', false, 11, true),
	(gen_random_uuid(), 'shopify-seller', '🛍️', '{"zh":"Shopify 商家","en":"Shopify Seller"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', true, 1, true),
	(gen_random_uuid(), 'amazon-seller', '📦', '{"zh":"亚马逊卖家","en":"Amazon Seller"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', false, 2, true),
	(gen_random_uuid(), 'ecommerce-manager', '🛒', '{"zh":"电商运营","en":"E-commerce Manager"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', false, 3, true),
	(gen_random_uuid(), 'merchandising-manager', '🧺', '{"zh":"选品经理","en":"Merchandising Manager"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', false, 4, true),
	(gen_random_uuid(), 'marketplace-partnerships', '🏪', '{"zh":"平台招商","en":"Marketplace Partnerships"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', false, 5, true),
	(gen_random_uuid(), 'user-operations', '👥', '{"zh":"用户运营","en":"User Operations"}'::jsonb, '{"zh":"电商","en":"E-commerce"}'::jsonb, 'ecommerce', false, 6, true),
	(gen_random_uuid(), 'seo-writer', '✍️', '{"zh":"SEO 写手","en":"SEO Writer"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', true, 1, true),
	(gen_random_uuid(), 'content-editor', '🗂️', '{"zh":"内容编辑","en":"Content Editor"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', false, 2, true),
	(gen_random_uuid(), 'copywriter', '🧠', '{"zh":"文案策划","en":"Copywriter"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', false, 3, true),
	(gen_random_uuid(), 'video-producer', '🎬', '{"zh":"视频编导","en":"Video Producer"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', false, 4, true),
	(gen_random_uuid(), 'podcast-producer', '🎙️', '{"zh":"播客制作人","en":"Podcast Producer"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', false, 5, true),
	(gen_random_uuid(), 'journalist', '📰', '{"zh":"新闻作者","en":"Journalist"}'::jsonb, '{"zh":"创作","en":"Creative"}'::jsonb, 'creator', false, 6, true),
	(gen_random_uuid(), 'youtube-creator', '📺', '{"zh":"YouTube 创作者","en":"YouTube Creator"}'::jsonb, '{"zh":"Influencer","en":"Influencer"}'::jsonb, 'influencer', true, 1, true),
	(gen_random_uuid(), 'instagram-creator', '📸', '{"zh":"Instagram 创作者","en":"Instagram Creator"}'::jsonb, '{"zh":"Influencer","en":"Influencer"}'::jsonb, 'influencer', true, 2, true),
	(gen_random_uuid(), 'tiktok-creator', '🎵', '{"zh":"TikTok 创作者","en":"TikTok Creator"}'::jsonb, '{"zh":"Influencer","en":"Influencer"}'::jsonb, 'influencer', true, 3, true),
	(gen_random_uuid(), 'visual-designer', '🎨', '{"zh":"视觉设计师","en":"Visual Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', true, 1, true),
	(gen_random_uuid(), 'graphic-designer', '🖼️', '{"zh":"平面设计师","en":"Graphic Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 2, true),
	(gen_random_uuid(), 'brand-designer', '🏷️', '{"zh":"品牌设计师","en":"Brand Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 3, true),
	(gen_random_uuid(), 'ui-designer', '🧩', '{"zh":"UI 设计师","en":"UI Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 4, true),
	(gen_random_uuid(), 'interior-designer', '🛋️', '{"zh":"室内设计师","en":"Interior Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 5, true),
	(gen_random_uuid(), 'photographer', '📷', '{"zh":"摄影师","en":"Photographer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', true, 6, true),
	(gen_random_uuid(), 'videographer', '📹', '{"zh":"摄像师","en":"Videographer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 7, true),
	(gen_random_uuid(), 'illustrator', '🖍️', '{"zh":"插画师","en":"Illustrator"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 8, true),
	(gen_random_uuid(), '3d-designer', '🧊', '{"zh":"3D 设计师","en":"3D Designer"}'::jsonb, '{"zh":"设计","en":"Design"}'::jsonb, 'design', false, 9, true),
	(gen_random_uuid(), 'software-engineer', '💻', '{"zh":"软件工程师","en":"Software Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', true, 1, true),
	(gen_random_uuid(), 'frontend-engineer', '🧱', '{"zh":"前端工程师","en":"Frontend Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 2, true),
	(gen_random_uuid(), 'backend-engineer', '🗄️', '{"zh":"后端工程师","en":"Backend Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 3, true),
	(gen_random_uuid(), 'fullstack-engineer', '🛠️', '{"zh":"全栈工程师","en":"Full-stack Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 4, true),
	(gen_random_uuid(), 'qa-engineer', '🧪', '{"zh":"测试工程师","en":"QA Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 5, true),
	(gen_random_uuid(), 'devops-engineer', '☁️', '{"zh":"DevOps 工程师","en":"DevOps Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 6, true),
	(gen_random_uuid(), 'ml-engineer', '🤖', '{"zh":"机器学习工程师","en":"Machine Learning Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 7, true),
	(gen_random_uuid(), 'data-engineer', '🗃️', '{"zh":"数据工程师","en":"Data Engineer"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 8, true),
	(gen_random_uuid(), 'solutions-architect', '🏗️', '{"zh":"解决方案架构师","en":"Solutions Architect"}'::jsonb, '{"zh":"技术","en":"Engineering"}'::jsonb, 'engineering', false, 9, true),
	(gen_random_uuid(), 'ai-product-manager', '🧠', '{"zh":"AI 产品经理","en":"AI Product Manager"}'::jsonb, '{"zh":"AI","en":"AI"}'::jsonb, 'ai', true, 1, true),
	(gen_random_uuid(), 'ai-consultant', '🤖', '{"zh":"AI 顾问","en":"AI Consultant"}'::jsonb, '{"zh":"AI","en":"AI"}'::jsonb, 'ai', true, 2, true),
	(gen_random_uuid(), 'ai-automation-builder', '⚙️', '{"zh":"AI 自动化工程师","en":"AI Automation Builder"}'::jsonb, '{"zh":"AI","en":"AI"}'::jsonb, 'ai', false, 3, true),
	(gen_random_uuid(), 'prompt-engineer', '📝', '{"zh":"提示词工程师","en":"Prompt Engineer"}'::jsonb, '{"zh":"AI","en":"AI"}'::jsonb, 'ai', false, 4, true),
	(gen_random_uuid(), 'ai-operations', '📡', '{"zh":"AI 运营","en":"AI Operations"}'::jsonb, '{"zh":"AI","en":"AI"}'::jsonb, 'ai', false, 5, true),
	(gen_random_uuid(), 'teacher', '🧑‍🏫', '{"zh":"老师","en":"Teacher"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', true, 1, true),
	(gen_random_uuid(), 'curriculum-researcher', '📚', '{"zh":"教研员","en":"Curriculum Researcher"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 2, true),
	(gen_random_uuid(), 'curriculum-designer', '🗒️', '{"zh":"课程设计师","en":"Curriculum Designer"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 3, true),
	(gen_random_uuid(), 'admissions-advisor', '🎓', '{"zh":"升学顾问","en":"Admissions Advisor"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 4, true),
	(gen_random_uuid(), 'academic-director', '🏫', '{"zh":"学术主管","en":"Academic Director"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 5, true),
	(gen_random_uuid(), 'training-manager', '🗂️', '{"zh":"培训经理","en":"Training Manager"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 6, true),
	(gen_random_uuid(), 'fitness-coach', '💪', '{"zh":"健身教练","en":"Fitness Coach"}'::jsonb, '{"zh":"教育","en":"Education"}'::jsonb, 'education', false, 7, true),
	(gen_random_uuid(), 'hrbp', '🧑‍💼', '{"zh":"HRBP","en":"HRBP"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', true, 1, true),
	(gen_random_uuid(), 'headhunter', '🎯', '{"zh":"猎头","en":"Headhunter"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 2, true),
	(gen_random_uuid(), 'recruiting-manager', '🧾', '{"zh":"招聘经理","en":"Recruiting Manager"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 3, true),
	(gen_random_uuid(), 'operations-manager', '📋', '{"zh":"运营经理","en":"Operations Manager"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 4, true),
	(gen_random_uuid(), 'project-manager', '📍', '{"zh":"项目经理","en":"Project Manager"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 5, true),
	(gen_random_uuid(), 'admin-manager', '🗄️', '{"zh":"行政经理","en":"Admin Manager"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 6, true),
	(gen_random_uuid(), 'procurement-manager', '📦', '{"zh":"采购经理","en":"Procurement Manager"}'::jsonb, '{"zh":"企业职能","en":"Business Functions"}'::jsonb, 'business_functions', false, 7, true)
ON CONFLICT ("slug") DO NOTHING;

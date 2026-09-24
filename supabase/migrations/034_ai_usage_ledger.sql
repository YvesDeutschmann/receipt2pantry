-- AI usage ledger: attribution columns, service-role-only access, ops union view.

ALTER TABLE public.ai_processing_log
    ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES public.households (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'openai',
    ADD COLUMN IF NOT EXISTS key_label TEXT NOT NULL DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS environment TEXT,
    ADD COLUMN IF NOT EXISTS request_id TEXT;

ALTER TABLE public.ai_processing_log
    DROP CONSTRAINT IF EXISTS ai_processing_log_provider_check;

ALTER TABLE public.ai_processing_log
    ADD CONSTRAINT ai_processing_log_provider_check
    CHECK (provider IN ('openai', 'gemini'));

CREATE INDEX IF NOT EXISTS idx_ai_log_user_created
    ON public.ai_processing_log (user_id, created_at DESC);

DROP POLICY IF EXISTS "Users can view own AI logs" ON public.ai_processing_log;
DROP POLICY IF EXISTS "Service role can manage AI logs" ON public.ai_processing_log;

CREATE POLICY "Service role manages ai_processing_log"
    ON public.ai_processing_log
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.ai_processing_log FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_processing_log FROM anon;
REVOKE SELECT ON TABLE public.ai_processing_log FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_processing_log TO service_role;

REVOKE ALL ON FUNCTION public.log_ai_processing(
    text, text, integer, integer, integer, boolean, text, uuid, uuid, integer, jsonb, jsonb
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE VIEW public.vendor_usage_daily AS
SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day_utc,
    user_id,
    provider AS vendor,
    operation,
    COUNT(*)::bigint AS request_count,
    SUM(estimated_cost) AS estimated_usd,
    NULL::numeric AS points
FROM public.ai_processing_log
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day_utc,
    user_id,
    'spoonacular'::text AS vendor,
    caller AS operation,
    COUNT(*)::bigint AS request_count,
    NULL::numeric AS estimated_usd,
    SUM(points) AS points
FROM public.spoonacular_usage
GROUP BY 1, 2, 3, 4;

ALTER VIEW public.vendor_usage_daily SET (security_invoker = true);

REVOKE ALL ON TABLE public.vendor_usage_daily FROM PUBLIC;
REVOKE ALL ON TABLE public.vendor_usage_daily FROM anon;
REVOKE ALL ON TABLE public.vendor_usage_daily FROM authenticated;
GRANT SELECT ON TABLE public.vendor_usage_daily TO service_role;

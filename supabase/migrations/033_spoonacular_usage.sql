-- Per-user Spoonacular API usage ledger (operator visibility + daily point cap).

CREATE TABLE IF NOT EXISTS public.spoonacular_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users (id) ON DELETE CASCADE,
    caller TEXT NOT NULL CHECK (
        caller IN (
            'recipe_open',
            'pool_generate',
            'suggestion_score',
            'suggestion_search',
            'dismiss',
            'meal_plan'
        )
    ),
    endpoint TEXT NOT NULL CHECK (
        endpoint IN ('findByIngredients', 'complexSearch', 'recipeInformation')
    ),
    points NUMERIC NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spoonacular_usage_user_created
    ON public.spoonacular_usage (user_id, created_at);

COMMENT ON TABLE public.spoonacular_usage IS
    'Spoonacular billed calls by user; service_role only';

ALTER TABLE public.spoonacular_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages spoonacular_usage" ON public.spoonacular_usage;
CREATE POLICY "Service role manages spoonacular_usage"
    ON public.spoonacular_usage
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE ALL ON TABLE public.spoonacular_usage FROM PUBLIC;
REVOKE ALL ON TABLE public.spoonacular_usage FROM anon;
REVOKE ALL ON TABLE public.spoonacular_usage FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.spoonacular_usage TO service_role;

CREATE OR REPLACE VIEW public.spoonacular_usage_daily AS
SELECT
    (created_at AT TIME ZONE 'UTC')::date AS day_utc,
    user_id,
    caller,
    endpoint,
    COUNT(*)::bigint AS request_count,
    SUM(points) AS total_points
FROM public.spoonacular_usage
GROUP BY 1, 2, 3, 4;

ALTER VIEW public.spoonacular_usage_daily SET (security_invoker = true);

REVOKE ALL ON TABLE public.spoonacular_usage_daily FROM PUBLIC;
REVOKE ALL ON TABLE public.spoonacular_usage_daily FROM anon;
REVOKE ALL ON TABLE public.spoonacular_usage_daily FROM authenticated;
GRANT SELECT ON TABLE public.spoonacular_usage_daily TO service_role;

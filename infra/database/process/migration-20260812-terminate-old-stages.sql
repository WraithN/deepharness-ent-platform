-- 终止所有产品流程中处于 pending/in_progress 状态的旧阶段
-- 用于清理旧数据，确保旧流程不会与新流程冲突
WITH stage_updated AS (
  SELECT
    p.id,
    jsonb_agg(
      CASE 
        WHEN (stage->>'status' IN ('pending', 'in_progress'))
        THEN jsonb_set(jsonb_set(stage, '{status}', '"terminated"'), '{completedAt}', to_jsonb(NOW()::text))
        ELSE stage
      END
      ORDER BY ord
    ) AS new_stages
  FROM processes p,
  LATERAL jsonb_array_elements(p.stages) WITH ORDINALITY AS t(stage, ord)
  WHERE p.type = 'product' AND p.stages IS NOT NULL AND jsonb_typeof(p.stages) = 'array'
  GROUP BY p.id
)
UPDATE processes p
SET stages = su.new_stages, updated_at = NOW()
FROM stage_updated su
WHERE p.id = su.id
  AND p.stages::text != su.new_stages::text;

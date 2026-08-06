-- Migration: 去除历史 UUID 中的横线，统一为 32 字符无横线格式
-- 日期: 2026-08-06
-- 说明: 新代码使用 NanoID（21 字符无横线），历史数据中存在带横线的 UUID（36 字符），
--       需统一去除横线。同时清理无效仓库记录。
-- 注意: 需在维护窗口执行，执行前请备份数据库。

BEGIN;

-- ── 1. 清理无效仓库 ──

DELETE FROM repositories 
WHERE clone_status = 'failed' 
  AND (url = '' OR url NOT LIKE 'http%' AND url NOT LIKE 'git@%');

-- ── 2. 临时删除所有外键约束 ──

-- 保存外键约束定义到临时表
CREATE TEMP TABLE _fk_constraints AS
SELECT
    tc.constraint_name,
    tc.table_name,
    kcu.column_name,
    ccu.table_name AS foreign_table,
    ccu.column_name AS foreign_column,
    pg_get_constraintdef(oid) AS definition
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu 
    ON tc.constraint_name = ccu.constraint_name AND tc.constraint_schema = ccu.table_schema
JOIN pg_constraint pgc 
    ON pgc.conname = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_schema = 'public';

-- 删除所有外键约束
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT DISTINCT constraint_name, table_name FROM _fk_constraints LOOP
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
    END LOOP;
END $$;

-- ── 3. 去除所有 varchar 列中 UUID 格式值的横线 ──
-- 匹配 8-4-4-4-12 格式的 UUID

DO $$
DECLARE
    r RECORD;
    updated_count INTEGER;
    total_updated INTEGER := 0;
BEGIN
    FOR r IN
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t 
            ON c.table_name = t.table_name AND t.table_schema = c.table_schema
        WHERE c.table_schema = 'public'
          AND c.data_type = 'character varying'
          AND t.table_type = 'BASE TABLE'
          AND c.column_name LIKE '%id'
    LOOP
        EXECUTE format(
            'UPDATE public.%I SET %I = REPLACE(%I, ''-'', '''') WHERE %I LIKE ''________-____-____-____-____________''',
            r.table_name, r.column_name, r.column_name, r.column_name
        );
        GET DIAGNOSTICS updated_count = ROW_COUNT;
        IF updated_count > 0 THEN
            RAISE NOTICE 'Updated % rows in %.%', updated_count, r.table_name, r.column_name;
            total_updated := total_updated + updated_count;
        END IF;
    END LOOP;
    RAISE NOTICE 'Total rows updated: %', total_updated;
END $$;

-- ── 4. 重建外键约束 ──

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT DISTINCT constraint_name, table_name, definition FROM _fk_constraints LOOP
        EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', r.table_name, r.constraint_name, r.definition);
    END LOOP;
END $$;

-- 清理临时表
DROP TABLE _fk_constraints;

COMMIT;

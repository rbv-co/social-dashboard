-- 01 policies reais
-- O pg_policies de produção é a fonte da verdade das policies dinâmicas (ex.: so_contas_permitidas, expandida em todas as tabelas com escopo de conta); o catálogo só a marca como dinâmica.
select schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check from pg_policies where schemaname = 'public' order by 1, 2, 3;
-- 02 funções do schema public (corpo completo)
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definicao from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1, 2;
-- 03 triggers
select event_object_table, trigger_name, action_timing, event_manipulation, action_statement from information_schema.triggers where trigger_schema = 'public' order by 1, 2;
-- 04 agendamentos reais do pg_cron
select jobid, jobname, schedule, active, command from cron.job order by jobid;
-- 05 extensões instaladas
select extname, extversion from pg_extension order by 1;
-- 06 tamanho do banco
select current_database() as banco, pg_size_pretty(pg_database_size(current_database())) as tamanho;
-- 07 linhas por tabela (estimativa) — as 80 maiores
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup desc limit 80;
-- 08 usuários do Auth
select count(*) as usuarios, count(*) filter (where coalesce(encrypted_password, '') <> '') as com_senha, count(*) filter (where banned_until > now()) as banidos from auth.users;
-- 09 provedores de login
select provider, count(*) as n from auth.identities group by 1 order by 2 desc;
-- 10 buckets e objetos
select b.id, b.public, b.file_size_limit, b.allowed_mime_types::text, count(o.id) as objetos, pg_size_pretty(coalesce(sum((o.metadata ->> 'size')::bigint), 0)) as tamanho from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by b.id, b.public, b.file_size_limit, b.allowed_mime_types order by 1;
-- 11 views
select viewname, definition from pg_views where schemaname = 'public' order by 1;
-- 12 colunas de profiles (modelo de permissão real)
select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position;
-- 13 sequências e tabelas sem chave primária (risco de importação)
select c.relname as tabela from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) order by 1;
-- 14 contas desativadas em profiles (flag real de desativação)
select count(*) filter (where coalesce(disabled, false)) as desativados, count(*) as total from public.profiles;
-- 15 formato de profiles.permissions (só contagem por tipo jsonb)
select jsonb_typeof(permissions) as tipo, count(*) as n from public.profiles group by 1 order by 2 desc;
-- 16 e-mails duplicados em auth.users ignorando maiúsculas (só contagens, sem e-mails)
select count(*) as emails_duplicados, coalesce(sum(n), 0) as contas_envolvidas from (select count(*) as n from auth.users group by lower(email) having count(*) > 1) d;
-- 17 usuários banidos para sempre (banned_until = infinity)
select count(*) as banidos_para_sempre from auth.users where banned_until = 'infinity';
-- 18 usuários com senha e e-mail não confirmado
select count(*) as com_senha_sem_confirmacao from auth.users where coalesce(encrypted_password, '') <> '' and email_confirmed_at is null;

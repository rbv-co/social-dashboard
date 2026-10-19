#!/usr/bin/env bash
# Prova os 16 papéis de robô (papel-robo-*.sql) num banco DESCARTÁVEL de um Postgres de teste que já esteja de pé (o mesmo dos
# testes Go; precisa de `psql` 17). Nada de produção. Cria um banco e os papéis, e remove tudo no fim.
# Uso (na raiz do repositório):
#   TEST_DATABASE_URL='postgres://postgres@127.0.0.1:55606/postgres?sslmode=disable' bash ops/vps/api-db/papel-robos.teste.sh
# Prova: (1) recusa se PUBLIC tem EXECUTE; (2) recusa sem senha; (3) roda 2x igual; (4) o que o robô faz funciona; (5) o resto dá
# `permission denied`; (6) papel que já existia (pdv_leitura) fica intacto. O esquema abaixo é MÍNIMO (só as colunas que importam
# para a prova); o ensaio com o esquema real do api-db está no plano 02 (Resultado).
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
[ -n "${TEST_DATABASE_URL:-}" ] || { echo "falta TEST_DATABASE_URL"; exit 2; }
BASE="${TEST_DATABASE_URL%%\?*}"
SERVIDOR="${BASE%/*}"
NOME="robos_t02_$$"
ARQS=("$AQUI"/papel-robo-*.sql)
falhas=0
confere() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FALHA $1 (esperado '$3', veio '$2')"; falhas=$((falhas + 1)); fi; }
adm() { psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -At "$@"; }
como() { local r="$1"; shift; psql "$(printf %s "$SERVIDOR" | sed "s#//[^@/]*@#//$r@#")/$NOME" -X -q -At "$@"; }
ok() { # ok <papel> <descrição> <sql> : tem de rodar sem erro
  local s; s="$(como "$1" -v ON_ERROR_STOP=1 -c "$3" 2>&1)"; [ $? -eq 0 ] && echo "ok   $1: $2" || { echo "FALHA $1: $2 (veio: $s)"; falhas=$((falhas + 1)); }
}
nega() { # nega <papel> <descrição> <sql> : tem de falhar com permission denied
  local s; s="$(como "$1" -c "$3" 2>&1)"
  case "$s" in *"permission denied"*) echo "ok   $1 não: $2" ;; *) echo "FALHA $1 não: $2 (veio: $s)"; falhas=$((falhas + 1)) ;; esac
}
limpar() {
  adm -c "drop owned by pdv_leitura" -c "drop owned by conteudo_robo" >/dev/null 2>&1
  for a in "${ARQS[@]}"; do r="$(sed -n "s/^select not exists (select 1 from pg_roles where rolname = '\(.*\)') as criar.*/\1/p" "$a")"; adm -c "drop owned by $r" >/dev/null 2>&1; done
  psql "$BASE" -X -q -c "drop database if exists $NOME" >/dev/null 2>&1
  for a in "${ARQS[@]}"; do r="$(sed -n "s/^select not exists (select 1 from pg_roles where rolname = '\(.*\)') as criar.*/\1/p" "$a")"; psql "$BASE" -X -q -c "drop role if exists $r" >/dev/null 2>&1; done
  psql "$BASE" -X -q -c "drop role if exists pdv_leitura" -c "drop role if exists conteudo_robo" >/dev/null 2>&1
}
trap limpar EXIT

confere "são 16 arquivos de papel de robô" "${#ARQS[@]}" "16"
psql "$BASE" -X -q -v ON_ERROR_STOP=1 -c "create database $NOME" || exit 1
adm <<'SQLX'
create role pdv_leitura login;  -- papel que JÁ existe: tem de sobreviver intacto
create table accounts (id text primary key, name text, ad_account_id text, instagram_id text, access_token text);
create table acessos_conexoes (provedor text primary key, client_id text, client_secret text, refresh_token text, data_center text, oauth_state text);
create table bling_tokens (id int primary key, access_token text, refresh_token text, client_secret text);
create table vessel_lotes (id uuid primary key default gen_random_uuid(), modelo text, cor text, sku text, fotos text, criado_em timestamptz default now(), fabricado_em date);
create table vessel_vendedores_bling (bling_vendedor_id bigint primary key, nome text);
create table bling_vendedores (vendor_id bigint primary key, nome text not null default '');
create table bling_pedido_vendedor (pedido_id bigint primary key, vendor_id bigint not null);
create table vessel_pedidos (id bigserial primary key, bling_pedido_id bigint unique, total numeric);
create table vessel_pedido_itens (id bigserial primary key, pedido_id bigint, sku text);
create table bling_pedido_forma_pagamento (parcela_id bigint primary key, pedido_id bigint);
create table bling_pedido_nota (pedido_id bigint primary key, total numeric);
create table bling_pedido_ajuste_valor (pedido_id bigint primary key, total_corrigido numeric);
create table vessel_client_advisors (id uuid primary key default gen_random_uuid(), bling_vendedor_id bigint, chave text);
create table vessel_pessoas (id uuid primary key default gen_random_uuid(), telefone text, bling_contato_id bigint, email text);
create table vessel_lista_espera (id uuid primary key default gen_random_uuid(), nome text, email text, whatsapp text, origem text, criado_em timestamptz, bling_id bigint, utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, clique_meta text, senha_hash text, ip_hash text);
create table shopify_pedidos (id bigint primary key, total numeric);
create table campaigns (campaign_id text primary key, name text, objective text, account_id text);
create table campaign_insights (id bigserial primary key, campaign_id text, spend numeric);
create table ads (ad_id text primary key);
create table ad_insights_hora (ad_id text, hora int);
create table gt_problemas_meta (ad_id text, codigo text);
create table bling_depositos (deposito_id bigint primary key, nome text);
create table bling_lojas (loja_id bigint primary key, nome text);
create table gc_estoque_item (sku text primary key, saldo int);
create table gc_vendas_item (sku text primary key, unidades int);
create table visitas_perfil_dia (account_id uuid not null, dia date not null, visitas int not null, calculado_em timestamptz default now(), primary key (account_id, dia));
create table bling_metas (id uuid primary key default gen_random_uuid(), meta_valor numeric);
create table gestao_comercial_briefings (id uuid primary key default gen_random_uuid(), rodada text, dados_json jsonb, resumo text);
create table ia_execucoes (id uuid primary key default gen_random_uuid(), robo text);
create table gestor_log (id uuid primary key default gen_random_uuid(), fase text);
create table coletor_log (id uuid primary key default gen_random_uuid(), fase text);
create table noticias_concorrentes (id uuid primary key default gen_random_uuid(), marca text, titulo text, resumo text, categoria text, fonte text, data_publicacao date, rodada text, produtos text, url text);
create table noticias_panorama (rodada text primary key, conteudo_md text);
create table fabrica_marcas (id uuid primary key default gen_random_uuid(), nome text, segmento text, termos_produto text, account_id text, ativo bool, caption_template text);
create table fabrica_lojas (deposito_id bigint primary key, nome text, marca_id uuid, geo_cities text, whatsapp text);
create table interesses_sugeridos (id uuid primary key default gen_random_uuid(), marca_id uuid, objetivo text);
create table followers_leituras (id uuid primary key default gen_random_uuid(), followers_count int);
create table chatwoot_eventos (id bigserial primary key, tipo text, dia_br date, contact_phone_number text);
create table gt_ponderada_config (id int primary key, pesos jsonb);
create table gt_objetivo_interacao (alvo_id text primary key, interacao text);
create table gt_budget_analises (campaign_id text primary key, veredito text);
create table gt_ad_analises (ad_id text primary key, veredito text);
create table fabrica_campanhas (id uuid primary key default gen_random_uuid(), fechada_em timestamptz, purgado_em timestamptz, nome text);
create table fabrica_criativos (id uuid primary key default gen_random_uuid(), storage_path text, purgado_em timestamptz, url text);
create table fabrica_looks (chave text primary key, preview_url text, nome text);
create table robos_execucoes (id bigserial primary key, robo text, disparado_em timestamptz, status_code int, ok bool, resposta text, conferido_em timestamptz);
create table vessel_pecas (codigo text primary key, lote_id uuid references vessel_lotes(id), numero_na_serie int, cartao_gerado_em timestamptz);
create table vessel_cartao_pedidos (id uuid primary key default gen_random_uuid(), pecas text[], situacao text, pasta text, erro text, criado_em timestamptz default now());
create table vessel_cartao_arquivos (codigo text, nome text, zoho_id text not null, pasta_id text, atualizado_em timestamptz default now(), primary key (codigo, nome));
create function vessel_cartao_pegar_da_fila() returns json language sql security definer as $$ select '{"ok":true}'::json $$;
create function vessel_cartao_pedido_terminou(p_pedido uuid, p_ok boolean, p_pasta text, p_erro text, p_pecas text[]) returns json language sql security definer as $$ select '{"ok":true}'::json $$;
create function vessel_cartao_recolocar_travados(p_minutos int default 150) returns json language sql security definer as $$ select '{"ok":true}'::json $$;
create table usuarios (id uuid primary key, email text, senha_hash text);
create function unaccent_simples(t text) returns text language sql as $$ select lower(t) $$;
create function vessel_chave_do_nome(t text) returns text language sql as $$ select unaccent_simples(t) $$;
create function gt_registrar_problemas(p_conta text, p_itens jsonb) returns void language sql as $$ select 1 $$;
create function apaga_tudo() returns void language sql security definer as $$ delete from usuarios $$;
grant select on usuarios to pdv_leitura;
SQLX
before="$(adm -c "select rolname, rolconnlimit, has_table_privilege(oid::regrole::text, 'usuarios', 'select') from pg_roles where rolname = 'pdv_leitura'")"

# senhas só deste teste, uma por arquivo, no AMBIENTE
for a in "${ARQS[@]}"; do v="$(sed -n 's/^\\getenv senha \(.*\)/\1/p' "$a")"; export "$v"=senha-so-deste-teste; done
# (1) sem o EXECUTE de PUBLIC revogado, recusa e não cria papel nenhum
psql "$SERVIDOR/$NOME" -X -q -f "${ARQS[0]}" >/dev/null 2>&1; confere "PUBLIC com EXECUTE em função: recusa" "$([ $? -ne 0 ] && echo recusou || echo rodou)" "recusou"
confere "e nenhum papel ficou criado" "$(adm -c "select count(*) from pg_roles where rolname = 'robo_reporte'")" "0"
adm -c "revoke execute on all functions in schema public from public" -c "alter default privileges revoke execute on functions from public"
# (2) sem senha recusa; (3) 2 rodadas
for a in "${ARQS[@]}"; do
  n="$(basename "$a")"; v="$(sed -n 's/^\\getenv senha \(.*\)/\1/p' "$a")"; s="${!v}"
  unset "$v"; psql "$SERVIDOR/$NOME" -X -q -f "$a" >/dev/null 2>&1; confere "$n: sem $v recusa" "$([ $? -ne 0 ] && echo recusou || echo rodou)" "recusou"
  export "$v=$s"
  for rodada in 1 2; do psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -f "$a" >/dev/null 2>&1; confere "$n: roda (rodada $rodada)" "$?" "0"; done
done
confere "nenhum papel é superusuário, bypassrls nem herda" "$(adm -c "select count(*) from pg_roles where rolname like 'robo\_%' and (rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or not rolcanlogin)")" "0"
confere "16 papéis com limite de conexões" "$(adm -c "select count(*) from pg_roles where rolname like 'robo\_%' and rolconnlimit > 0")" "16"
confere "papel que já existia ficou intacto" "$(adm -c "select rolname, rolconnlimit, has_table_privilege(oid::regrole::text, 'usuarios', 'select') from pg_roles where rolname = 'pdv_leitura'")" "$before"

# (4) o que cada robô faz
ok robo_reporte "grava a rodada" "insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em) values ('x', now(), 200, true, 'ok', now())"
ok robo_selo "token, lê e atualiza o lote" "select id, access_token from bling_tokens; select id, modelo, cor, sku, fotos, criado_em from vessel_lotes; update vessel_lotes set cor = 'a', fotos = 'b'"
ok robo_pedidos_vessel "pedido novo (com sequence), itens, pagamento, chave" "insert into vessel_pedidos (bling_pedido_id, total) values (1, 2) on conflict (bling_pedido_id) do update set total = 3; insert into vessel_pedido_itens (pedido_id, sku) values (1, 'a'); delete from vessel_pedido_itens; insert into bling_pedido_forma_pagamento values (1, 1); select vessel_chave_do_nome('A'); select pedido_id, total_corrigido from bling_pedido_ajuste_valor; select id, nome, email, whatsapp, origem, criado_em, bling_id from vessel_lista_espera; update vessel_pessoas set bling_contato_id = 1"
ok robo_pedidos_vessel "caches do ranking por vendedor" "insert into bling_vendedores (vendor_id, nome) values (1, 'a') on conflict (vendor_id) do update set nome = 'b'; insert into bling_pedido_vendedor (pedido_id, vendor_id) values (1, 1) on conflict (pedido_id) do update set vendor_id = 2"
ok robo_shopify "upsert do pedido" "insert into shopify_pedidos values (1, 2) on conflict (id) do update set total = 3"
ok robo_metaads_zoho "credencial do Zoho e leads" "select provedor, client_id, client_secret, refresh_token, data_center from acessos_conexoes; select nome, utm_term, clique_meta from vessel_lista_espera; select * from campaigns, ads, ad_insights_hora; select pedido_id, total_corrigido from bling_pedido_ajuste_valor"
ok robo_vigia_meta "conta e registro de problemas" "select id, name, ad_account_id from accounts; select gt_registrar_problemas('a', '[]'); select provedor, client_id, client_secret, refresh_token, data_center from acessos_conexoes; insert into robos_execucoes (robo, ok, status_code, resposta, conferido_em) values ('v', true, 200, 'ok', now())"
ok robo_notas "grava a nota, lê o ajuste" "insert into bling_pedido_nota values (1, 2) on conflict (pedido_id) do update set total = 3; delete from bling_pedido_nota where pedido_id in (1) returning to_json(bling_pedido_nota); select * from bling_pedido_ajuste_valor"
ok robo_relatorios "estoque e vendas" "insert into gc_estoque_item values ('a', 1) on conflict (sku) do update set saldo = 2; insert into gc_vendas_item values ('a', 1) on conflict (sku) do update set unidades = 2; delete from gc_vendas_item where sku = 'a'; insert into bling_lojas values (1, 'a') on conflict (loja_id) do update set nome = 'b'; select * from bling_pedido_nota"
ok robo_cards "metas, briefing, execução" "select * from bling_metas; update gestao_comercial_briefings set dados_json = '{}'; insert into ia_execucoes (robo) values ('x')"
ok robo_gestor "briefing, notícias, log" "insert into gestao_comercial_briefings (rodada) values ('a'); select marca, titulo, resumo, categoria, fonte, data_publicacao, rodada from noticias_concorrentes; insert into gestor_log (fase) values ('a'); insert into ia_execucoes (robo) values ('x')"
ok robo_interesses "marcas, lojas, interesse" "select id, nome, segmento, termos_produto, account_id, ativo from fabrica_marcas; select nome, marca_id, geo_cities from fabrica_lojas; insert into interesses_sugeridos (marca_id, objetivo) values (null, 'a'); update interesses_sugeridos set objetivo = 'b'"
ok robo_opr "contas, campanhas, seguidores, eventos" "select id, instagram_id from accounts; select campaign_id, name, objective from campaigns; select * from campaign_insights, followers_leituras; select tipo, dia_br from chatwoot_eventos; insert into visitas_perfil_dia (account_id, dia, visitas) values (gen_random_uuid(), current_date, 1) on conflict (account_id, dia) do update set visitas = 2"
ok robo_budget "configuração e análises" "select * from gt_ponderada_config, gt_objetivo_interacao; insert into gt_budget_analises values ('a', 'b') on conflict (campaign_id) do update set veredito = 'c'; insert into gt_ad_analises values ('a', 'b') on conflict (ad_id) do update set veredito = 'c'"
ok robo_noticias "notícia, log, panorama" "insert into noticias_concorrentes (marca, titulo) values ('a', 'b'); update noticias_concorrentes set produtos = 'x'; delete from noticias_concorrentes; insert into coletor_log (fase) values ('a'); insert into noticias_panorama values ('a', 'b') on conflict (rodada) do update set conteudo_md = 'c'"
ok robo_faxina "lê o que está em uso" "select id, fechada_em, purgado_em from fabrica_campanhas; select storage_path, purgado_em from fabrica_criativos; select preview_url from fabrica_looks"
ok robo_cartoes "fila, peças com SKU, ids dos arquivos (upsert 2x), credencial do Zoho e as 3 funções" "select vessel_cartao_recolocar_travados(150); select vessel_cartao_pegar_da_fila(); select vessel_cartao_pedido_terminou(gen_random_uuid(), true, 'p', null, array['A']); select id, situacao, criado_em, pecas from vessel_cartao_pedidos; select p.codigo, p.numero_na_serie, l.sku from vessel_pecas p left join vessel_lotes l on l.id = p.lote_id; insert into vessel_cartao_arquivos (codigo, nome, zoho_id, pasta_id, atualizado_em) values ('A', 'a.png', 'z', 'p', now()) on conflict (codigo, nome) do update set zoho_id = excluded.zoho_id, pasta_id = excluded.pasta_id, atualizado_em = excluded.atualizado_em; insert into vessel_cartao_arquivos (codigo, nome, zoho_id, pasta_id, atualizado_em) values ('A', 'a.png', 'z2', 'p', now()) on conflict (codigo, nome) do update set zoho_id = excluded.zoho_id, pasta_id = excluded.pasta_id, atualizado_em = excluded.atualizado_em; select provedor, client_id, client_secret, refresh_token, data_center from acessos_conexoes"

# (5) o que NÃO podem
for r in $(adm -c "select rolname from pg_roles where rolname like 'robo\_%' order by 1"); do
  nega "$r" "lê usuarios" "select * from usuarios"
  nega "$r" "executa função de apagar" "select apaga_tudo()"
  nega "$r" "cria tabela" "create table t_x (a int)"
  nega "$r" "lê access_token das contas" "select access_token from accounts"
done
nega robo_reporte "lê robos_execucoes" "select * from robos_execucoes"
nega robo_reporte "apaga robos_execucoes" "delete from robos_execucoes"
nega robo_selo "lê refresh_token do Bling" "select refresh_token from bling_tokens"
nega robo_selo "grava sku do lote" "update vessel_lotes set sku = 'x'"
nega robo_pedidos_vessel "lê client_secret do Bling" "select client_secret from bling_tokens"
nega robo_pedidos_vessel "lê senha_hash da lista de espera" "select senha_hash from vessel_lista_espera"
nega robo_pedidos_vessel "lê ip_hash da lista de espera" "select ip_hash from vessel_lista_espera"
nega robo_metaads_zoho "lê oauth_state do Zoho" "select oauth_state from acessos_conexoes"
nega robo_metaads_zoho "grava no Zoho" "update acessos_conexoes set refresh_token = 'x'"
nega robo_metaads_zoho "lê senha_hash da lista de espera" "select senha_hash from vessel_lista_espera"
nega robo_vigia_meta "lê campanhas" "select * from campaigns"
nega robo_notas "grava o ajuste de valor" "insert into bling_pedido_ajuste_valor values (1, 2)"
nega robo_cards "grava o resumo do briefing" "update gestao_comercial_briefings set resumo = 'x'"
nega robo_gestor "lê a url da notícia" "select url from noticias_concorrentes"
nega robo_noticias "lê os pedidos" "select * from vessel_pedidos"
nega robo_noticias "altera o título da notícia" "update noticias_concorrentes set titulo = 'x'"
nega robo_opr "lê telefone do chatwoot" "select contact_phone_number from chatwoot_eventos"
nega robo_opr "grava seguidores" "insert into followers_leituras (followers_count) values (1)"
nega robo_cartoes "muda o pedido direto (só pelas funções)" "update vessel_cartao_pedidos set situacao = 'pronto'"
nega robo_cartoes "grava em vessel_pecas" "update vessel_pecas set cartao_gerado_em = now()"
nega robo_cartoes "lê o oauth_state do Zoho" "select oauth_state from acessos_conexoes"
nega robo_cartoes "lê o resto do lote" "select modelo, cor, fotos from vessel_lotes"
nega robo_faxina "grava em fabrica_criativos" "update fabrica_criativos set purgado_em = now()"
nega robo_faxina "lê a url do criativo" "select url from fabrica_criativos"

# (7) conteudo_robo (papel-conteudo.sql, anterior ao plano 02): mesma trava, mesma senha obrigatória, mesmo 2x
adm <<'SQLX'
alter table accounts add column username text, add column conteudo_usa_portal boolean;
create table conteudo_blocos (id int); create table conteudo_pecas (id int); create table conteudo_concorrentes (id int);
create table conteudo_metricas (id int);
create table conteudo_ideias (id uuid primary key default gen_random_uuid(), titulo text);
create table conteudo_jobs (id int primary key, tipo text, account_id text, params text, status text, created_at timestamptz, updated_at timestamptz, resultado text, erro text);
SQLX
CO="$AQUI/papel-conteudo.sql"; export SENHA_CONTEUDO=senha-so-deste-teste
unset SENHA_CONTEUDO; psql "$SERVIDOR/$NOME" -X -q -f "$CO" >/dev/null 2>&1; confere "papel-conteudo.sql: sem senha recusa" "$([ $? -ne 0 ] && echo recusou || echo rodou)" "recusou"
export SENHA_CONTEUDO=senha-so-deste-teste
for rodada in 1 2; do psql "$SERVIDOR/$NOME" -X -v ON_ERROR_STOP=1 -q -f "$CO" >/dev/null 2>&1; confere "papel-conteudo.sql: roda (rodada $rodada)" "$?" "0"; done
confere "conteudo_robo sem bypassrls, com limite" "$(adm -c "select rolbypassrls, rolconnlimit from pg_roles where rolname = 'conteudo_robo'")" "f|2"
ok conteudo_robo "contexto, ideia, fila e custo" "select id, name, username, conteudo_usa_portal from accounts; select * from conteudo_blocos; insert into conteudo_ideias (titulo) values ('a'); update conteudo_jobs set status = 'x'; insert into ia_execucoes (robo) values ('x')"
nega conteudo_robo "lê access_token" "select access_token from accounts"
nega conteudo_robo "cria job" "insert into conteudo_jobs (id) values (1)"

[ "$falhas" -eq 0 ] && echo "TUDO OK" || { echo "$falhas falha(s)"; exit 1; }

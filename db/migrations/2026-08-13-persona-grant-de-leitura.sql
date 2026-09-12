-- A PERSONA volta a ser LEGÍVEL pela tela (o GRANT que faltou em 12/08)
--
-- O SINTOMA (relatado pelo dono, 13/08/2026): abrir Meta Ads › Gestor de
-- Tráfego mostrava, no lugar da lista de contas:
--
--     Erro ao carregar contas: g is not iterable
--
-- A CAUSA, medida no banco (não deduzida):
-- `public.accounts` NÃO tem GRANT de SELECT no nível da TABELA. Ela usa GRANT
-- POR COLUNA — foi assim que se escondeu `access_token` (o token da Meta) do
-- front sem esconder o resto. Confira com:
--
--     select has_table_privilege('authenticated','public.accounts','SELECT');   -- false
--     select has_column_privilege('authenticated','public.accounts','name','SELECT'); -- true
--
-- A migration 2026-08-12-persona-da-marca.sql criou a coluna `persona` e parou
-- aí. Como o padrão da tabela é grant por coluna, **a coluna nasceu ilegível**:
-- ninguém, nem super-admin, podia lê-la (GRANT é do Postgres, não olha RLS nem
-- `is_superadmin`).
--
-- POR QUE ISSO VIRA "g is not iterable": a tela pede
-- `accounts?select=id,name,ad_account_id,profile_picture_url,picture_url,persona`.
-- Basta UMA coluna sem permissão para o PostgREST recusar a linha inteira e
-- responder 401 com um OBJETO de erro (`{"code":"42501",...}`) em vez de uma
-- lista. A tela fazia `for (const acc of socialAccs)` em cima desse objeto —
-- e objeto não se percorre. O "g" era o nome da variável depois de minificada.
--
-- Provado isolando a coluna, com a chave anônima:
--   select=id,name,ad_account_id,profile_picture_url,picture_url  → HTTP 200 []
--   select=persona                                               → HTTP 401 42501
--
-- O ESTRAGO IA ALÉM DA LISTA: salvar a persona na tela usa PATCH com
-- `Prefer: return=representation` e `select=id,persona` — devolver a linha
-- também exige SELECT na coluna, então a gravação inteira caía. A persona
-- NUNCA pôde ser salva pela tela desde que foi criada. É por isso que só a
-- Vessel tem persona (posta direto no banco) e as outras 4 contas estão vazias,
-- item que a lista de pendências cobrava do dono em B4b — não era falta de
-- clique, era a porta trancada.
--
-- ESCOPO DE PROPÓSITO ESTREITO:
--   - `authenticated` apenas. `anon` continua sem ler nada de `accounts`, e é
--     assim que deve ser: quem não entrou não vê a persona da marca.
--   - Só `persona`. `access_token` continua REVOGADO para os dois papéis — é o
--     segredo de verdade e nada aqui o toca.
--   - `publicacao_automatica` também está sem grant, mas NENHUMA tela a lê
--     (conferido por grep no `src/`). Fica como está: dar permissão que ninguém
--     usa é aumentar a superfície à toa.
--
-- A LIÇÃO, que vale para a próxima coluna: em `accounts`, **coluna nova nasce
-- sem permissão de leitura**. Quem adicionar coluna que a tela precisa ler tem
-- que dar o GRANT no mesmo arquivo — a migration da coluna e a permissão dela
-- são a mesma tarefa, não duas.

grant select (persona) on public.accounts to authenticated;

-- Registro na mão, no mesmo SQL: o runner de migrations não é confiável hoje
-- (ver B12 na lista de pendências — ele acha que 57 estão pendentes).
insert into public.schema_migrations (name)
values ('2026-08-13-persona-grant-de-leitura.sql')
on conflict do nothing;

-- Tira do banco as permissoes que nao mandavam em nada. Itens B1d e B1e.
-- Aplicado em producao em 2026-08-13 (projeto kounqtdoioootxqegkij).
--
-- POR QUE MEXER NO DADO, e nao so no catalogo:
-- o catalogo (`RECURSOS`, em src/compartilhado/controle-de-login-e-usuario.js)
-- e quem desenha o editor de permissoes. Tirar a chave de la faz o degrau sumir
-- da tela, mas o que ja estava GRAVADO continua no perfil das pessoas. E existe
-- uma guarda no projeto (src/compartilhado/recursos-editaveis.test.mjs) que
-- cobra exatamente isso: **toda permissao concedida precisa ter linha no
-- editor**, senao vira permissao que ninguem consegue ver nem tirar pela tela.
-- Ela quebrou na hora em que o catalogo mudou -- foi o teste pedindo esta
-- migration.
--
-- O QUE SAI, e o tamanho de cada coisa (medido em 13/08 antes de rodar):
--   - `sales.metas` inteira ....................... 15 pessoas
--   - a acao `exportar` de `social` ............... 13 pessoas
--   - a acao `exportar` de `sales.gestao` ......... 12 pessoas
--   - a acao `exportar` de `sales.analise` ........ 12 pessoas
--   - a acao `exportar` de `meta.campanha` ......... 8 pessoas
--
-- POR QUE ISSO NAO TIRA ACESSO DE NINGUEM:
--   - nenhuma tela consultava `sales.metas`. Quem edita meta e o painel de
--     Administracao, que ja e so de super-admin; e VER a meta acompanha ver o
--     telao, recortada pela loja da pessoa (decisao do dono, 13/08). Conferido
--     tambem que ninguem tem `sales.metas` SEM ter `sales.gestao` ou
--     `sales.analise` -- se tivesse, perderia o `features` pai 'sales' e com ele
--     o acesso ao bling-proxy.
--   - as quatro ferramentas com `exportar` nao tem uma linha de codigo de
--     download. O degrau "Ver e baixar" era igual a "So ver". Conferido que
--     ninguem tem `exportar` sem ter `ver` junto, entao ninguem fica com a
--     chave vazia.
--   - `permissions_excecao` nao tinha nenhuma das duas coisas (medido: zero).
--
-- Onde o download existe de verdade -- `social.relatorio`,
-- `patrimonio.relatorios`, `frota.relatorios` e `gestor.relatorios` -- a acao
-- CONTINUA, e sempre foi respeitada pelas telas.
--
-- E um UPDATE so por pessoa, de proposito: o gatilho `guard_profiles` grava uma
-- linha de `acesso_change` por UPDATE, e uma limpeza que deixasse cinco linhas
-- por pessoa no registro so atrapalharia quem for ler depois.

update public.profiles
   set permissions = (
     select coalesce(jsonb_object_agg(chave, acoes_limpas), '{}'::jsonb)
       from (
         select chave,
                case when chave in ('social', 'sales.gestao', 'sales.analise', 'meta.campanha')
                     then acoes - 'exportar'
                     else acoes
                end as acoes_limpas
           from jsonb_each(public.profiles.permissions) as e(chave, acoes)
          where chave <> 'sales.metas'
       ) limpo
   )
 where permissions ? 'sales.metas'
    or permissions->'social' ? 'exportar'
    or permissions->'sales.gestao' ? 'exportar'
    or permissions->'sales.analise' ? 'exportar'
    or permissions->'meta.campanha' ? 'exportar';

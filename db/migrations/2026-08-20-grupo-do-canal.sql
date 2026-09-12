-- O GRUPO DO CANAL (atacado / varejo) — 20/08/2026
--
-- PEDIDO DO DONO: "nas vendas tem o campo seletor de canais, eu quero uma
-- separação por canal — exemplo, atacado (opção pra marcar/desmarcar todos) e
-- varejo".
--
-- POR QUE AQUI E NÃO EM `equipes` (medido em 20/08/2026):
--   canais no Bling ....... 14
--   canais com time ....... 3   (os mesmos 3 que têm venda)
-- Pôr o rótulo no time deixaria 11 canais sem grupo — inclusive "Private Label"
-- e "Institucional", que não são time de gente nenhuma. O dono confirmou que os
-- 11 vão vender um dia e quer marcá-los agora. Então o grupo é do CANAL, e o
-- time é atacado ou varejo pelo canal a que já está amarrado.
--
-- TEXTO, e não uma lista travada no código: o dono disse "exemplo, atacado e
-- varejo", e "exemplo" é o aviso de que um terceiro pode aparecer. Grupo novo
-- tem de ser digitação na tela, não migration — a mesma decisão que este banco
-- já tomou para as lojas em 2026-08-04-equipes-e-escopo.sql.
--
-- NASCE VAZIO NOS 14, de propósito. É tentador marcar "Atacado Fábrica" como
-- atacado sozinho, mas adivinhar pelo nome é o defeito que acabou de ser
-- consertado no estoque, onde uma lista de palavras decidia o que era produto e
-- errava em 213 linhas. Quem marca é o dono, na tela.
alter table public.bling_lojas
  add column if not exists grupo text;

comment on column public.bling_lojas.grupo is
  'Grupo comercial do canal (atacado, varejo, ...). NULL = sem grupo. Editavel so por superadmin, na Config de Admin > Canais de venda. O time herda daqui pelo equipes.canal_loja_id.';

-- ─────────────────────────────────────────────────────────────────────────────
-- O AJUDANTE, E POR QUE ELE PRECISOU EXISTIR
--
-- A primeira versão desta política lia `profiles` direto:
--     using (coalesce((select is_superadmin from profiles where id = auth.uid()), false))
-- e NÃO FUNCIONAVA NEM PARA O SUPERADMIN. Medido: `auth.uid()` estava certo, mas
-- a expressão de uma política roda como o PRÓPRIO usuário, e `profiles` tem RLS
-- — a pessoa não enxerga a própria linha ali (0 linhas visíveis). O subselect
-- voltava vazio, o coalesce virava false e o update alcançava zero linhas.
-- Por isso todo o resto do banco lê `profiles` de dentro de SECURITY DEFINER.
--
-- ⚠️ EXISTEM DOIS "SUPERADMIN" NESTE BANCO, E ELES NÃO SÃO A MESMA COISA:
--   · a coluna `profiles.is_superadmin` — é o que a Central usa na tela
--     (`estado.is_superadmin`) e o que `pode_ver_canal` consulta;
--   · a função `public.is_superadmin()` — que NÃO lê a coluna: ela confere o
--     e-mail contra uma lista de três, cravada no corpo dela.
-- Hoje os dois concordam (as mesmas 3 pessoas, de 22 perfis). Mas se alguém
-- marcar a coluna para uma quarta pessoa, a função continua dizendo não — e essa
-- pessoa veria a tela e não conseguiria salvar, calada. Como quem abre a tela é
-- a coluna, é a coluna que manda aqui.
create or replace function public.superadmin_pela_ficha()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p.is_superadmin from public.profiles p where p.id = auth.uid()), false);
$$;

comment on function public.superadmin_pela_ficha() is
  'Superadmin PELA COLUNA profiles.is_superadmin (que e o que a tela usa), lido em security definer porque profiles tem RLS e a pessoa nao enxerga a propria linha de dentro de uma policy. NAO confundir com is_superadmin(), que confere e-mail contra uma lista cravada.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A POLÍTICA QUE FALTAVA

--
-- `bling_lojas` tinha RLS ligado e UMA política: leitura (`authenticated read
-- bling_lojas`). Não havia nenhuma de escrita. Sem acrescentar uma, a tela
-- salvaria sem salvar — o PostgREST responde SUCESSO COM ZERO LINHAS quando o
-- RLS barra, sem erro nenhum. Esse defeito já custou um dia neste projeto.
--
-- `using` E `with check`: só o `using` é metade da trava. Ele decide quais linhas
-- podem ser alcançadas; o `with check` decide o que pode ficar gravado nelas.
--
-- `to authenticated` de propósito: `anon` tem grant largo nesta tabela e quem o
-- segura é justamente o RLS não lhe dar política nenhuma. Esta não abre nada
-- para ele.
drop policy if exists "bling_lojas_grupo_superadmin" on public.bling_lojas;
create policy "bling_lojas_grupo_superadmin"
  on public.bling_lojas for update
  to authenticated
  using      (public.superadmin_pela_ficha())
  with check (public.superadmin_pela_ficha());

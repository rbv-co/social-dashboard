-- O ALCANCE DA SUPERVISORA — 20/08/2026 (Peça 3)
--
-- PEDIDO DO DONO: "função de supervisora (hierarquia na sequência: vendedor(a) >
-- gerente > supervisor(a)) pode ver todos os canais dela (todos atacado),
-- gestora e vendedora vê somente sua loja". Ele confirmou que `gestor` no banco
-- é a "gerente" da fala dele.
--
-- ATÉ AQUI `pode_ver_canal` PERGUNTAVA SÓ "ESSA PESSOA ESTÁ NO TIME?" — o papel
-- era ignorado, e supervisora via exatamente o mesmo que vendedora.
--
-- A MESMA REGRA PRECISA VALER EM TRÊS LUGARES, e este é um deles:
--   1. `_shared/canais-de-venda-permitidos.js`  — as telas
--   2. a edge `bling-proxy`                     — a resposta do Bling
--   3. `pode_ver_canal`                         — o RLS de gc_vendas_item (aqui)
-- Só na tela não vale: o front é público. Foi esse buraco que se fechou em
-- 13/08 e é por isso que os três andam juntos.
--
-- ⚠️ O GRUPO VEM DO CANAL (`bling_lojas.grupo`, Peça 1). Canal sem grupo NÃO
-- amplia nada — e essa é a parte que não pode dar errado: "sem grupo" jamais
-- pode virar "vê tudo". Por isso o `nullif(btrim(...),'') is not null`.
create or replace function public.pode_ver_canal(p_canal bigint)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    -- (a) o canal de um time meu, com qualquer papel — como sempre foi
    or exists (select 1 from public.equipes e
                where e.canal_loja_id = p_canal
                  and e.id in (select public.minhas_equipes()))
    -- (b) NOVO: qualquer canal do GRUPO de um time onde eu sou SUPERVISORA
    or exists (
         select 1
           from public.equipes_membros m
           join public.equipes     e    on e.id = m.equipe_id
           join public.bling_lojas meu  on meu.loja_id = e.canal_loja_id
           join public.bling_lojas alvo on alvo.loja_id = p_canal
          where m.profile_id = auth.uid()
            and m.papel = 'supervisora'
            and nullif(btrim(meu.grupo), '')  is not null
            and nullif(btrim(alvo.grupo), '') is not null
            and lower(btrim(meu.grupo)) = lower(btrim(alvo.grupo)));
$$;

comment on function public.pode_ver_canal(bigint) is
  'Ve a venda deste canal? Superadmin e quem nao esta sob escopo por equipe veem tudo. Quem esta sob escopo ve os canais dos times dele; SUPERVISORA ve todo o grupo (bling_lojas.grupo) dos times onde supervisiona. Canal sem grupo nao amplia nada. Mesma regra de _shared/canais-de-venda-permitidos.js e da edge bling-proxy.';

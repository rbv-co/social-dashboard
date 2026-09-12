-- DUAS FUNÇÕES COM PODER DE DONO E SEM PORTÃO POR DENTRO.
--
-- ⚠️ ORDEM ALFABÉTICA. `coletor/run-migrations.mjs` aplica em ordem alfabética.
-- O `zz` é funcional: este arquivo fecha portas, e fechar porta vem por último
-- no dia em que houver outra migration da mesma data.
--
-- ACHADAS numa varredura de 01/09/2026, feita porque o repositório do painel é
-- PÚBLICO e o dono perguntou o que garante a segurança nesse caso. A resposta
-- é: a trava mora no banco, não no código. Estas duas estavam sem ela.
--
-- AS DUAS EXIGEM ESTAR LOGADO NA CENTRAL — não são alcançáveis por anônimo.
-- Mas nenhuma exigia ter a PERMISSÃO da ferramenta, e é aí que mora o furo:
-- `revoke ... from public` NÃO fecha para quem tem conta. É a mesma cicatriz de
-- 30/08 (ver `2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql`), agora em
-- duas funções que já existiam.
--
-- NENHUMA DAS DUAS MUDA DE COMPORTAMENTO PARA QUEM TEM A PERMISSÃO. O que muda
-- é o que acontece com quem não tem.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. `etiqueta_quem_e` — o inventário inteiro estava legível por qualquer conta
-- ══════════════════════════════════════════════════════════════════════════
--
-- Ela recebe um NÚMERO de patrimônio e devolve nome do bem, categoria e A PLACA
-- do veículo. Sem portão, qualquer pessoa logada — inclusive quem não tem
-- Patrimônio nem Frota — percorria os números de 1 em diante e baixava o
-- inventário da empresa com as placas. A permissão da ferramenta era contornada
-- por inteiro.
--
-- O PORTEIRO É O MESMO DA TABELA: `patrimonio_bens` já se protege com
-- `is_patrimonio_admin()`. Usar outro aqui criaria uma segunda verdade sobre
-- quem pode ver bem — e duas verdades sobre a mesma coisa é uma delas
-- envelhecendo em silêncio.
--
-- POR QUE `existe: false` E NÃO UM ERRO: quem não tem permissão não deve nem
-- descobrir QUANTOS bens existem. Erro diferente de "não achei" já é resposta:
-- quem estivesse varrendo saberia onde a lista acaba. A recusa se parece com o
-- número não existir.
create or replace function public.etiqueta_quem_e(p_numero integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case
    when not public.is_patrimonio_admin() then jsonb_build_object('existe', false)
    else coalesce(
      (select jsonb_build_object(
         'existe', true,
         'nome', b.nome,
         'categoria', c.nome,
         'eh_veiculo', coalesce(c.nome ilike '%ve%cul%', false),
         'placa_ligada', (select v.placa from public.frota_veiculos v where v.bem_id = b.id))
         from public.patrimonio_bens b
         left join public.patrimonio_categorias c on c.id = b.categoria_id
        where b.numero = p_numero),
      jsonb_build_object('existe', false))
  end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. `frota_pdf_aceite_pegar_da_fila` — a fila de PDFs podia ser esvaziada
-- ══════════════════════════════════════════════════════════════════════════
--
-- É a função que o ROBÔ usa para pegar trabalho da fila. Sem portão, qualquer
-- pessoa logada podia chamá-la em sequência: os itens ficavam marcados como
-- 'enviando', o robô de verdade PASSAVA POR CIMA deles (o `where` dele só pega
-- 'na_fila'), e o contador de tentativas subia até serem dados como falhos.
--
-- O estrago não é vazamento — é SILÊNCIO: os PDFs de aceite param de chegar e
-- ninguém entende por quê. Defeito que se esconde é pior que defeito que grita.
--
-- O PORTEIRO É `is_frota_admin()`, o mesmo que já protege `frota_uso_pdf`. O
-- robô entra com LOGIN de conta de serviço (é assim que os robôs desta base
-- funcionam, ver `bling-proxy`), então ele passa pelo mesmo portão que uma
-- pessoa da Frota — e não precisa de exceção nenhuma.
-- ⚠️ O `default 20` PRECISA ser repetido. O Postgres recusa `create or replace`
-- que remova o padrão de um parâmetro existente ("cannot remove parameter
-- defaults"), e quem chama sem argumento quebraria. Foi o primeiro erro ao
-- rodar esta migration.
create or replace function public.frota_pdf_aceite_pegar_da_fila(p_limite integer default 20)
returns table(id_da_fila uuid, id_do_uso uuid, tentativas_ate_agora integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sem permissão, devolve NADA — e nada é a resposta certa para quem pega
  -- trabalho de fila: o robô sem permissão simplesmente não tem o que fazer.
  if not public.is_frota_admin() then
    return;
  end if;

  insert into public.frota_uso_pdf(uso_id)
  select u.id from public.frota_uso u
   where u.aceite_em is not null
     and not exists (select 1 from public.frota_uso_pdf p where p.uso_id = u.id)
  on conflict (uso_id) do nothing;

  return query
  update public.frota_uso_pdf f
     set situacao = 'enviando', tentativas = f.tentativas + 1, tentado_em = now()
   where f.id in (
     select p.id from public.frota_uso_pdf p
      where p.situacao = 'na_fila'
         or (p.situacao = 'enviando' and p.tentado_em < now() - interval '15 minutes')
      order by p.criado_em
      limit greatest(1, coalesce(p_limite, 20))
      for update skip locked
   )
  returning f.id, f.uso_id, f.tentativas;
end
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- AS CONCESSÕES — a segunda trava, e a que já foi esquecida antes
-- ══════════════════════════════════════════════════════════════════════════
--
-- `revoke ... from public, anon` NÃO tira a concessão que o Postgres dá por
-- default a `authenticated`. Sem o `authenticated` no revoke, o grant seguinte
-- não é o que manda — a concessão de origem continua lá. As duas telas chamam
-- estas funções, então elas PRECISAM do grant; quem trava é o portão de dentro.
revoke all on function public.etiqueta_quem_e(integer) from public, anon, authenticated;
revoke all on function public.frota_pdf_aceite_pegar_da_fila(integer) from public, anon, authenticated;

grant execute on function public.etiqueta_quem_e(integer) to authenticated;
grant execute on function public.frota_pdf_aceite_pegar_da_fila(integer) to authenticated;

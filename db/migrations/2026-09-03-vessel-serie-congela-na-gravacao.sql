-- O NÚMERO DE SÉRIE DE UMA BOLSA QUE JÁ ESTÁ NO MUNDO NÃO MUDA MAIS.
--
-- ── O QUE ACONTECEU ────────────────────────────────────────────────────────
--
-- Em 02/09/2026 a REFERÊNCIA e a PEÇA viraram um NÚMERO DE SÉRIE só: os dígitos
-- da referência colados na sequência da peça. `H0015S` peça 1 vira `00151`. Ele
-- aparece no certificado que a cliente abre ao encostar o celular na bolsa.
--
-- Até esse dia, `numero_na_serie` era POSIÇÃO: o "nº 7 de 20" da bancada, um
-- dado de dentro de casa. Renumerar o lote para fechar buraco era inócuo —
-- ninguém lá fora tinha visto aquele número.
--
-- Depois desse dia, `numero_na_serie` virou IDENTIDADE. E `vessel_renumerar_lote`
-- continuou renumerando TODAS as peças do lote, inclusive as já gravadas e
-- vendidas. O caminho, medido no banco e não deduzido:
--
--   lote com as peças 1 a 10; a 6 e a 7 gravadas e com a cliente;
--   excluo a peça 5, que está LIVRE — `vessel_excluir_peca` permite, e está certo;
--   `vessel_renumerar_lote` roda para fechar o buraco: a 6 vira 5, a 7 vira 6.
--
-- A etiqueta continua funcionando: o código (`K7M4X9QP2R`) não mudou e a bolsa
-- abre o certificado dela. O que mudou foi o NÚMERO DE SÉRIE IMPRESSO NESSE
-- CERTIFICADO. A cliente que anotou `001517` na compra volta meses depois e lê
-- `001516`. Nada quebra, nada dá erro — e é exatamente por isso que é grave:
-- ninguém fica sabendo. É o número da garantia dela mudando calado.
--
-- ── O QUE JÁ ESTAVA CERTO, E POR ISSO NÃO SE MEXE AQUI ─────────────────────
--
-- Conferido no `prosrc` que está em produção, não no arquivo:
--
--   · `vessel_excluir_peca` JÁ recusa peça gravada (`esta_gravada`) e peça com
--     garantia registrada (`tem_garantia`), e a tela JÁ traduz a primeira
--     mandando dar baixa em vez de excluir.
--   · `vessel_editar_lote` JÁ conta as PRESAS (gravada OU com garantia), recusa
--     baixar a quantidade abaixo delas (`abaixo_do_gravado`) e, quando diminui,
--     só apaga as LIVRES.
--
-- Ou seja: ninguém consegue apagar uma peça que está no mundo. O buraco não era
-- esse — era o EFEITO COLATERAL de apagar a peça do lado.
--
-- ── A REGRA NOVA ───────────────────────────────────────────────────────────
--
-- PEÇA PRESA NUNCA MUDA DE NÚMERO. Presa é a mesma definição que `vessel_editar_lote`
-- já usa, de propósito — GRAVADA ou COM GARANTIA REGISTRADA. As duas querem
-- dizer "esta peça já existe fora daqui". Definição diferente aqui e lá seriam
-- duas verdades sobre a mesma coisa.
--
-- As LIVRES continuam se acomodando: recebem, na ordem em que já estavam, os
-- MENORES números ainda não ocupados por uma presa. Elas ainda não foram vistas
-- por ninguém, então mexer nelas não custa nada — e é isso que mantém a série
-- contígua na esmagadora maioria dos casos.
--
-- Exemplo do caminho de cima, agora: peças 1 a 10, a 6 e a 7 presas, excluo a 5.
-- As presas ficam em 6 e 7. As oito livres ocupam 1,2,3,4,5,8,9,10 — nove peças,
-- números de 1 a 10 com o buraco onde ele tem que ficar. A cliente da 001517
-- continua sendo a 001517.
--
-- ⚠️ ISTO ACEITA BURACO NA SÉRIE, e é o preço combinado com o dono. Se um dia
-- uma peça presa tiver número muito acima do total do lote, a série fica com
-- vão. Um vão na numeração é feio; um número de série que muda depois de
-- vendido é defeito.
--
-- ⚠️ O `generate_series` VAI ATÉ `total + presas`, não até `total`. Uma peça
-- presa com número maior que o total do lote não consome nenhuma vaga de dentro
-- da faixa, então a faixa precisa de folga do tamanho das presas para nunca
-- faltar vaga para as livres. Sem a folga, `livre join vaga` perde linhas em
-- silêncio e peça nenhuma é renumerada — o pior tipo de defeito, o que não
-- reclama.

create or replace function public.vessel_renumerar_lote(p_lote uuid)
returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  -- Portão por dentro. `revoke ... from public` NÃO tira a concessão que o
  -- Postgres dá por DEFAULT PRIVILEGES a `authenticated`, então quem protege
  -- este ajudante é esta linha, não o grant.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  with presa as (
    -- PRESA = está no mundo. Mesma definição de `vessel_editar_lote`.
    select p.codigo, p.numero_na_serie
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and (p.gravada_em is not null
            or exists (select 1 from public.vessel_registros r where r.codigo = p.codigo))
  ),
  livre as (
    -- a ordem atual manda: quem era o primeiro continua sendo o primeiro
    select p.codigo,
           row_number() over (order by p.numero_na_serie, p.criado_em, p.codigo) as ordem
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and not exists (select 1 from presa x where x.codigo = p.codigo)
  ),
  vaga as (
    select n, row_number() over (order by n) as ordem
      from generate_series(
             1,
             (select count(*) from public.vessel_pecas where lote_id = p_lote)
               + (select count(*) from presa)
           ) as n
     where not exists (select 1 from presa x where x.numero_na_serie = n)
  ),
  nova as (
    select l.codigo, v.n from livre l join vaga v on v.ordem = l.ordem
  )
  update public.vessel_pecas p
     set numero_na_serie = nova.n
    from nova
   where nova.codigo = p.codigo
     and p.numero_na_serie is distinct from nova.n;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- O grant repetido de propósito: `create or replace` mantém os privilégios da
-- função antiga, mas escrever aqui faz o arquivo dizer a verdade inteira sobre
-- quem pode chamar — e um banco novo nasce igual ao de produção.
revoke all on function public.vessel_renumerar_lote(uuid) from public, anon, authenticated;

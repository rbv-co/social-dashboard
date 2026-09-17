-- O FIO QUE FALTAVA: A CLIENT ADVISOR E O VENDEDOR DO BLING
--
-- Hoje o sistema sabe quem MANDOU o convite (CA-03) e sabe quem VENDEU
-- (`vessel_pedidos.vendedor_id`, que vem do Bling em 444 dos 456 pedidos da
-- janela de 90 dias). O que ele NÃO sabe é que os dois são a mesma pessoa —
-- então dá para dizer "a Kariny mandou 14 convites e 9 vieram", mas não
-- "e 5 compraram R$ 7.300".
--
-- A LIGAÇÃO É FEITA PELA PRÓPRIA CLIENT ADVISOR, UMA VEZ (ideia do dono,
-- 17/09/2026): ela digita o nome no gerador de cartão, o sistema procura na
-- lista de vendedores do Bling e pergunta "você é Fulana de Tal?". Ela
-- confirma, e o fio fica amarrado para sempre.
--
-- ⚠️ POR QUE NÃO CASAR SOZINHO PELO NOME. "Maria Eduarda" são DUAS pessoas
-- diferentes no Bling (Florêncio e Cristina Schettini), e "Fábrica" é um
-- vendedor que não é gente. Casamento automático por nome daria, nesses casos,
-- a venda de uma pessoa para outra — e ninguém descobriria, porque o número
-- continuaria fechando. Um toque de confirmação custa uma vez na vida.
--
-- ⚠️ E O CAMPO "LOJA" DO VENDEDOR NÃO SERVE DE FILTRO. Medido em 17/09/2026: a
-- equipe do Iguatemi ainda está cadastrada no Bling na **Loja Dom Pedro**, que
-- está FECHADA — a loja mudou e o cadastro do vendedor não acompanhou. Filtrar
-- os candidatos "pela loja dela" esconderia justamente a pessoa certa.

-- ── A lista de vendedores do Bling, copiada para cá ────────────────────────
-- ⚠️ CÓPIA, e não consulta ao vivo: o gerador de cartão é uma página pública
-- com a chave anônima. Ela não pode falar com o Bling, e não deve mesmo — a
-- busca do nome tem de morrer dentro do nosso banco.
create table if not exists public.vessel_vendedores_bling (
  bling_vendedor_id bigint primary key,
  nome              text not null,
  chave             text not null,          -- o nome sem acento e sem maiúscula
  loja_id           bigint,
  situacao          text,                   -- A ativo | I inativo | E excluído
  atualizado_em     timestamptz not null default now()
);

create index if not exists vessel_vendedores_bling_chave_idx
  on public.vessel_vendedores_bling (chave);

alter table public.vessel_vendedores_bling enable row level security;

comment on table public.vessel_vendedores_bling is
  'Copia da lista de vendedores do Bling, trazida pelo robo. Serve para a Client '
  'Advisor se reconhecer no gerador de cartao. RLS ligada e SEM politica: so as '
  'funcoes security definer entram.';

-- ── O fio, na ficha da Client Advisor ──────────────────────────────────────
alter table public.vessel_client_advisors
  add column if not exists bling_vendedor_id  bigint,
  add column if not exists vendedor_ligado_em timestamptz,
  -- Quem olhou a lista e não se achou nela. Sem esta marca, a pergunta
  -- voltaria a cada aparelho novo, para sempre.
  add column if not exists vendedor_dispensado_em timestamptz;

-- ⚠️ UM VENDEDOR PARA UMA CLIENT ADVISOR, e a trava é no índice, não na boa
-- vontade da função. Dois códigos apontando para o mesmo vendedor fariam a
-- mesma venda ser contada duas vezes, uma para cada uma.
create unique index if not exists vessel_client_advisors_vendedor_idx
  on public.vessel_client_advisors (bling_vendedor_id)
  where bling_vendedor_id is not null;

comment on column public.vessel_client_advisors.bling_vendedor_id is
  'O vendedor do Bling que E esta Client Advisor. Confirmado por ela mesma, uma vez.';

/**
 * Quem PODE ser esta pessoa, na lista do Bling.
 *
 * ⚠️ TETO DE TRÊS LETRAS E CINCO RESPOSTAS. Esta função responde à chave
 * anônima (o gerador é uma página pública), e sem teto ela viraria uma porta
 * para baixar a lista de funcionários letra por letra. Com o teto, ela só
 * confirma um palpite que quem digitou já tinha.
 */
create or replace function public.vessel_vendedores_parecidos(p_nome text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object('id', bling_vendedor_id, 'nome', nome)
                           order by ordem, nome), '[]'::json)
    from (
      select v.bling_vendedor_id, v.nome,
             -- Ativo primeiro: quem trabalha hoje é o palpite mais provável.
             case when v.situacao = 'A' then 0 else 1 end as ordem
        from public.vessel_vendedores_bling v
       where length(public.vessel_chave_do_nome(p_nome)) >= 3
         -- Começa com o que foi digitado, OU tem uma PALAVRA que começa com
         -- isso. "Kariny" acha "Kariny Stefany Ezidio dos Santos"; "Godoy" acha
         -- "Thaina Mikaela de Godoy Pimenta". Pedaço no meio de palavra não
         -- acha nada — senão "ana" traria meia loja.
         and (v.chave like public.vessel_chave_do_nome(p_nome) || '%'
              or v.chave like '% ' || public.vessel_chave_do_nome(p_nome) || '%')
         -- Vendedor excluído no Bling não é oferecido: ninguém se liga a uma
         -- ficha que a loja já apagou.
         and coalesce(v.situacao, 'A') <> 'E'
         -- Já é de outra Client Advisor? Então não é desta.
         and not exists (select 1 from public.vessel_client_advisors c
                          where c.bling_vendedor_id = v.bling_vendedor_id)
       limit 5) as parecidos;
$$;

/**
 * A confirmação: "sim, sou eu". Amarra o código ao vendedor.
 *
 * ⚠️ SÓ AMARRA UMA VEZ. Trocar o vendedor de um código depois reescreveria o
 * passado em silêncio — vendas já atribuídas a uma pessoa passariam a ser de
 * outra, sem nada na tela mudando. Correção de engano é serviço de quem cuida
 * do banco, de propósito.
 */
create or replace function public.vessel_ligar_vendedor(
  p_codigo text, p_vendedor_id bigint default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ca    public.vessel_client_advisors%rowtype;
  v_nome  text;
begin
  select * into v_ca from public.vessel_client_advisors
   where codigo = upper(trim(coalesce(p_codigo, '')));
  if v_ca.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_conheco_esse_codigo');
  end if;

  -- Nulo = "não me achei na lista". Marca, para não perguntar de novo.
  if p_vendedor_id is null then
    update public.vessel_client_advisors
       set vendedor_dispensado_em = now() where id = v_ca.id;
    return json_build_object('ok', true, 'situacao', 'dispensado');
  end if;

  if v_ca.bling_vendedor_id is not null then
    return json_build_object('ok', v_ca.bling_vendedor_id = p_vendedor_id,
      'situacao', case when v_ca.bling_vendedor_id = p_vendedor_id
                       then 'ja_era_esse' else 'ja_ligado_a_outro' end);
  end if;

  select nome into v_nome from public.vessel_vendedores_bling
   where bling_vendedor_id = p_vendedor_id;
  if v_nome is null then
    return json_build_object('ok', false, 'situacao', 'vendedor_desconhecido');
  end if;

  -- ⚠️ O índice único já barra, mas barrar aqui devolve FRASE em vez de
  -- derrubar a transação com erro de banco na cara de quem está usando.
  if exists (select 1 from public.vessel_client_advisors
              where bling_vendedor_id = p_vendedor_id) then
    return json_build_object('ok', false, 'situacao', 'vendedor_ja_e_de_outra');
  end if;

  update public.vessel_client_advisors
     set bling_vendedor_id = p_vendedor_id, vendedor_ligado_em = now(),
         vendedor_dispensado_em = null
   where id = v_ca.id;

  return json_build_object('ok', true, 'situacao', 'ligado', 'nome', v_nome);
end;
$$;

/**
 * `vessel_identificar_client_advisor` passa a responder, junto com o código, o
 * que a tela precisa para fazer a pergunta: se já há fio ligado, quem é; se não
 * há, quem PODE ser.
 *
 * ⚠️ O corpo antigo é o de produção, intocado — a lista que se monta sozinha, o
 * código que nunca muda, o teto de 200 pessoas e a fase de testes. O que entra
 * é só o bloco `vendedor` no fim de cada saída de sucesso.
 */
create or replace function public.vessel_identificar_client_advisor(
  p_nome text, p_loja text default null, p_teste boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chave  text := public.vessel_chave_do_nome(p_nome);
  v_ca     public.vessel_client_advisors%rowtype;
  v_codigo text;
  v_n      int;
  v_vend   json;
begin
  if length(v_chave) < 2 then
    return json_build_object('ok', false, 'erro', 'Escreva o seu nome.');
  end if;

  select * into v_ca from public.vessel_client_advisors where chave = v_chave;

  if v_ca.id is null then
    -- Teto de gente: sem ele, um robô que descubra o endereço criaria
    -- Client Advisors sem fim.
    select count(*) into v_n from public.vessel_client_advisors;
    if v_n >= 200 then
      return json_build_object('ok', false, 'erro', 'Fale com quem cuida do sistema.');
    end if;

    v_codigo := 'CA-' || lpad((v_n + 1)::text, 2, '0');
    insert into public.vessel_client_advisors (codigo, nome, chave, loja, teste)
    values (v_codigo, trim(p_nome), v_chave, nullif(trim(p_loja), ''), coalesce(p_teste, false))
    on conflict (chave) do nothing;
    select * into v_ca from public.vessel_client_advisors where chave = v_chave;
  else
    -- A loja pode mudar (alguém cobrindo outra unidade); o código, não.
    update public.vessel_client_advisors
       set loja = coalesce(nullif(trim(p_loja), ''), loja)
     where id = v_ca.id;
  end if;

  -- O bloco do vendedor, que é a novidade.
  if v_ca.bling_vendedor_id is not null then
    select json_build_object('ligado', json_build_object('id', v.bling_vendedor_id, 'nome', v.nome))
      into v_vend
      from public.vessel_vendedores_bling v
     where v.bling_vendedor_id = v_ca.bling_vendedor_id;
    v_vend := coalesce(v_vend, json_build_object('ligado',
      json_build_object('id', v_ca.bling_vendedor_id, 'nome', v_ca.nome)));
  elsif v_ca.vendedor_dispensado_em is not null then
    -- Ela já olhou a lista e não se achou. Não pergunta de novo.
    v_vend := json_build_object('parecidos', '[]'::json);
  else
    v_vend := json_build_object('parecidos', public.vessel_vendedores_parecidos(p_nome));
  end if;

  return json_build_object('ok', true, 'codigo', v_ca.codigo, 'vendedor', v_vend);
end;
$$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated: no Supabase os
-- dois recebem execute por privilegio PADRAO do schema, que e outra concessao.
-- Buraco ja pago aqui em 16/09/2026.
revoke all on function public.vessel_vendedores_parecidos(text) from public, anon, authenticated;
revoke all on function public.vessel_ligar_vendedor(text, bigint) from public, anon, authenticated;
revoke all on function public.vessel_identificar_client_advisor(text, text, boolean) from public, anon, authenticated;

-- `vessel_vendedores_parecidos` fica FECHADA para a rua: quem a chama e a
-- funcao de identificar, que ja roda como dona. Abrir as duas daria uma porta
-- de busca livre na lista de funcionarios.
grant execute on function public.vessel_ligar_vendedor(text, bigint) to anon, authenticated;
grant execute on function public.vessel_identificar_client_advisor(text, text, boolean) to anon, authenticated;

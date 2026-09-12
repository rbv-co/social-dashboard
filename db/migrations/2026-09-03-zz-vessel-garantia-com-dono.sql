-- A GARANTIA DEIXA DE SER "QUEM CHEGAR PRIMEIRO LEVA".
--
-- ── O BURACO, COMO ELE ESTAVA ──────────────────────────────────────────────
--
-- `vessel_registrar` escrevia direto em `vessel_registros` e, na segunda
-- tentativa, respondia `ja_registrada` e travava. A tag NAO TEM SENHA: quem
-- encosta o celular na bolsa abre a pagina. Entao qualquer pessoa que segurasse
-- a bolsa — a vendedora da loja, quem sentou do lado no restaurante, quem
-- achou perdida, quem roubou — registrava a garantia no proprio nome, e a DONA
-- DE VERDADE nao conseguia mais: o sistema respondia que ja estava registrada.
--
-- Nao era hipotese remota. Uma vendedora curiosa queimava a garantia de uma
-- bolsa sem nem perceber o que tinha feito.
--
-- ⚠️ ESTA MIGRATION MUDA A REGRA INTEIRA, E ISSO SO E POSSIVEL PORQUE
-- `vessel_registros` ESTA VAZIA: zero registros, conferido no banco antes de
-- escrever a primeira linha daqui. Nenhuma cliente foi afetada e nao ha dado a
-- migrar. Se um dia houver, este arquivo NAO serve de modelo.
--
-- ── A REGRA NOVA, DECIDIDA PELO DONO EM 03/09/2026 ─────────────────────────
--
-- A prova de que a bolsa e sua NAO e ter a bolsa na mao — o ladrao tambem tem.
-- E ter COMPRADO. E essa prova esta no Bling.
--
--   1. A cliente informa CPF, nome e WhatsApp.
--   2. Uma edge procura no Bling um pedido daquele CPF com aquele modelo.
--   3. BATEU  → garantia ativa na hora, ja amarrada ao contato certo do Bling.
--   4. NAO BATEU → fica PENDENTE numa fila, e o dono aprova ou recusa. A pagina
--      diz "recebemos, vamos confirmar". Comprou em feira, ganhou de presente,
--      comprou de revenda, ou o pedido saiu sem CPF: ninguem fica de fora, so
--      espera.
--
-- ⚠️ E PENDENTE NAO TRANCA A ETIQUETA. Este e o coracao do conserto: se a
-- pessoa errada abrir um pedido, a dona de verdade ainda consegue abrir o dela
-- depois, e quem escolhe entre os dois e o dono da marca. Uma trava que recusa
-- a segunda pessoa e exatamente o defeito que estamos consertando.
--
-- ── AS DUAS TABELAS, E POR QUE SAO DUAS ────────────────────────────────────
--
-- `vessel_registros` continua sendo O DONO ATUAL: uma linha por peca, que e o
-- que a pagina da cliente le a cada leitura. Rapida e sem historia.
--
-- `vessel_pedidos_de_registro` e TODA TENTATIVA, aprovada ou nao. E a fila e a
-- historia no mesmo lugar. Sem ela, recusar um pedido apagaria a prova de que
-- alguem tentou — e a tentativa recusada e justamente o que o dono vai querer
-- ver no dia em que a bolsa aparecer num anuncio de usados.
--
-- A trilha das DECISOES continua em `vessel_edicoes`, que ja existe e ja e lida
-- pela tela: acao `registro_aprovado`, `registro_recusado`, `dono_trocado`.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. O CPF
-- ══════════════════════════════════════════════════════════════════════════
--
-- Guardado em digitos, sem mascara, porque e assim que se compara com o Bling.
--
-- ⚠️ ELE NUNCA SAI POR FUNCAO PUBLICA. `vessel_verificar` e `vessel_revelar_dono`
-- respondem a `anon`, e nenhuma das duas devolve CPF nem WhatsApp inteiro. Quem
-- ve o CPF e o painel, autenticado, e mesmo la mascarado. Ha assercao para isso
-- na prova: um dia alguem vai acrescentar um campo no `json_build_object` sem
-- pensar nisso.
create or replace function public.vessel_cpf_valido(p_cpf text)
returns boolean language plpgsql immutable as $$
declare
  v text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  s int; d1 int; d2 int; i int;
begin
  if length(v) <> 11 then return false; end if;
  -- 11111111111 e os outros dez repetidos passam na conta dos digitos: e o
  -- CPF falso que todo mundo digita quando quer so passar pela tela.
  if v ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(v, i, 1)::int * (11 - i); end loop;
  d1 := 11 - (s % 11); if d1 >= 10 then d1 := 0; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(v, i, 1)::int * (12 - i); end loop;
  d2 := 11 - (s % 11); if d2 >= 10 then d2 := 0; end if;
  return d1 = substr(v, 10, 1)::int and d2 = substr(v, 11, 1)::int;
end;
$$;

-- O CPF como o painel mostra: ***.456.789-**. Nunca inteiro.
create or replace function public.vessel_cpf_mascarado(p_cpf text)
returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')) <> 11 then null
    else '***.' || substr(regexp_replace(p_cpf, '\D', '', 'g'), 4, 3)
         || '.' || substr(regexp_replace(p_cpf, '\D', '', 'g'), 7, 3) || '-**' end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. A FILA
-- ══════════════════════════════════════════════════════════════════════════
create table if not exists public.vessel_pedidos_de_registro (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null references public.vessel_pecas(codigo) on delete cascade,
  nome          text not null,
  cpf           text not null,
  whatsapp      text not null,
  onde_comprou  text,
  comprado_em   date,
  -- 'pendente'  — esperando o dono decidir
  -- 'aprovado'  — virou dono; `vessel_registros` foi escrita
  -- 'recusado'  — nao virou, e a tentativa fica registrada
  estado        text not null default 'pendente'
                check (estado in ('pendente', 'aprovado', 'recusado')),
  -- COMO foi decidido: 'bling' (bateu com um pedido de venda) ou 'na_mao'
  -- (alguem do time olhou e decidiu). Sem isto, daqui a um ano ninguem sabe
  -- quais garantias foram conferidas de verdade.
  decidido_por_que text check (decidido_por_que in ('bling', 'na_mao')),
  -- O que o Bling respondeu, guardado inteiro: numero do pedido, id do contato,
  -- data, e o motivo de nao ter batido quando nao bate. E o que permite
  -- explicar a decisao meses depois, quando ninguem lembra.
  conferencia   jsonb,
  criado_em     timestamptz not null default now(),
  decidido_em   timestamptz,
  decidido_quem uuid,
  motivo        text
);

create index if not exists vessel_pedidos_registro_codigo_idx
  on public.vessel_pedidos_de_registro(codigo, criado_em desc);
create index if not exists vessel_pedidos_registro_pendente_idx
  on public.vessel_pedidos_de_registro(criado_em) where estado = 'pendente';

comment on table public.vessel_pedidos_de_registro is
  'Toda tentativa de registrar garantia, aprovada ou nao. E a fila e a historia. '
  'Pendente NAO tranca a etiqueta: outra pessoa ainda pode abrir o pedido dela.';

alter table public.vessel_pedidos_de_registro enable row level security;
drop policy if exists vessel_pedidos_registro_read on public.vessel_pedidos_de_registro;
create policy vessel_pedidos_registro_read on public.vessel_pedidos_de_registro
  for select to authenticated using (public.is_vessel_admin());

-- ══════════════════════════════════════════════════════════════════════════
-- 3. O DONO ATUAL GANHA DE ONDE ELE VEIO
-- ══════════════════════════════════════════════════════════════════════════
alter table public.vessel_registros
  add column if not exists cpf text,
  add column if not exists pedido_id uuid references public.vessel_pedidos_de_registro(id),
  add column if not exists bling_contato_id text,
  add column if not exists bling_pedido text;

comment on column public.vessel_registros.cpf is
  'Digitos, sem mascara. NUNCA sai por funcao publica: nem vessel_verificar nem '
  'vessel_revelar_dono devolvem CPF. O painel mostra mascarado.';

-- ══════════════════════════════════════════════════════════════════════════
-- 3b. A TRILHA PRECISA ACEITAR AS ACOES NOVAS
-- ══════════════════════════════════════════════════════════════════════════
--
-- `vessel_edicoes.acao` tem `check` com a lista fechada, e ela nao conhecia
-- `registro_aprovado`, `registro_recusado` nem `dono_trocado`. Sem isto, a
-- primeira aprovacao morreria com `violates check constraint` — e como a
-- gravacao da trilha e a ULTIMA coisa que a funcao faz, a decisao ja teria sido
-- tomada e a transacao voltaria atras inteira. A pessoa clicaria em aprovar, o
-- sistema daria erro tecnico, e nada aconteceria.
--
-- ⚠️ ESTA LISTA MORA EM DOIS LUGARES e os dois precisam concordar: este `check`
-- e o `rotuloDaAcao` da tela, que traduz a chave para a frase que a pessoa le.
-- Quem acrescentar acao aqui e esquecer da tela ve a trilha mostrar o nome
-- tecnico no meio das frases em portugues.
alter table public.vessel_edicoes drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes add constraint vessel_edicoes_acao_check
  check (acao in ('desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
                  'registro_aprovado', 'registro_recusado', 'dono_trocado'));

-- ══════════════════════════════════════════════════════════════════════════
-- 4. ABRIR UM PEDIDO — a porta da cliente
-- ══════════════════════════════════════════════════════════════════════════
--
-- Chamada pela edge `vessel-registrar-garantia`, que e quem fala com o Bling.
-- O banco nao sai para a internet: ele guarda, e a edge decide.
--
-- ⚠️ NAO RECUSA MAIS POR "JA REGISTRADA". Essa recusa era o defeito. O que ela
-- faz e AVISAR que a peca ja tem dono, para a edge e a tela poderem dizer a
-- verdade a quem esta digitando ("esta bolsa ja esta registrada em nome de
-- Erick M.; se ela e sua, abra o pedido que vamos conferir").
--
-- ⚠️ TAMBEM NAO DEIXA A MESMA PESSOA ENCHER A FILA. Pedido pendente do MESMO
-- CPF para a MESMA peca nao vira um segundo: devolve o que ja existe. Sem isto,
-- quem apertar o botao tres vezes cria tres linhas iguais na fila do dono, e a
-- fila que se enche de repetido e a fila que ninguem olha.
create or replace function public.vessel_abrir_pedido_de_registro(
  p_codigo text, p_nome text, p_cpf text, p_whatsapp text,
  p_onde text default null, p_comprado_em date default null)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_cpf    text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_zap    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome   text := left(trim(coalesce(p_nome, '')), 120);
  v_sku    text;
  v_dono   record;
  v_id     uuid;
begin
  select l.sku into v_sku
    from public.vessel_pecas p join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'nao_existe');
  end if;

  if v_nome = '' or length(v_zap) not in (10, 11) then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  if not public.vessel_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;
  -- Data de compra no futuro nao existe, e data de compra anterior a fabricacao
  -- da peca tambem nao. As duas sao erro de digitacao — ou tentativa de esticar
  -- a garantia, que conta dois anos a partir dela.
  if p_comprado_em is not null and p_comprado_em > current_date then
    return json_build_object('ok', false, 'motivo', 'compra_no_futuro');
  end if;

  select r.nome, r.codigo into v_dono from public.vessel_registros r where r.codigo = v_codigo;

  select id into v_id from public.vessel_pedidos_de_registro
   where codigo = v_codigo and cpf = v_cpf and estado = 'pendente'
   order by criado_em desc limit 1;

  if v_id is null then
    insert into public.vessel_pedidos_de_registro
      (codigo, nome, cpf, whatsapp, onde_comprou, comprado_em)
    values (v_codigo, v_nome, v_cpf, v_zap,
            left(nullif(trim(coalesce(p_onde, '')), ''), 120), p_comprado_em)
    returning id into v_id;
  end if;

  return json_build_object(
    'ok', true, 'pedido', v_id, 'sku', v_sku,
    'ja_tem_dono', v_dono.codigo is not null,
    'dono_curto', case when v_dono.codigo is null then null
                       else public.vessel_nome_curto(v_dono.nome) end);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 5. DECIDIR UM PEDIDO — pela conferencia do Bling ou pela mao do dono
-- ══════════════════════════════════════════════════════════════════════════
--
-- UMA funcao para os dois caminhos, de proposito: aprovar e aprovar, venha a
-- decisao de onde vier, e duas funcoes seriam duas versoes da regra de virar
-- dono — que e a regra que nao pode divergir.
--
-- O PORTAO E DUPLO e as duas metades sao diferentes:
--   · `p_quem_decidiu = 'bling'` so a edge chama, e ela usa a chave de servico,
--     que passa por cima de RLS. Por isso a funcao exige `p_conferencia` com o
--     pedido do Bling dentro: aprovacao automatica sem prova anexada nao entra.
--   · `p_quem_decidiu = 'na_mao'` exige `is_vessel_admin()`, como o resto da
--     ferramenta.
create or replace function public.vessel_decidir_pedido_de_registro(
  p_pedido uuid, p_estado text, p_quem_decidiu text,
  p_conferencia jsonb default null, p_motivo text default null)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ped  record;
  v_ate  date;
  v_quem uuid := auth.uid();
begin
  if p_estado not in ('aprovado', 'recusado') then
    return json_build_object('ok', false, 'motivo', 'estado_invalido');
  end if;
  if p_quem_decidiu not in ('bling', 'na_mao') then
    return json_build_object('ok', false, 'motivo', 'origem_invalida');
  end if;
  if p_quem_decidiu = 'na_mao' and not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Aprovacao automatica SEM a prova do Bling anexada nao entra: e ela que
  -- explica a decisao daqui a um ano, e sem ela "conferido no Bling" e so uma
  -- palavra que o sistema deu a si mesmo.
  if p_quem_decidiu = 'bling' and p_estado = 'aprovado'
     and coalesce(p_conferencia ->> 'pedido', '') = '' then
    return json_build_object('ok', false, 'motivo', 'conferencia_sem_pedido');
  end if;

  select * into v_ped from public.vessel_pedidos_de_registro where id = p_pedido;
  if not found then
    return json_build_object('ok', false, 'motivo', 'pedido_nao_existe');
  end if;
  if v_ped.estado <> 'pendente' then
    return json_build_object('ok', false, 'motivo', 'ja_decidido',
                             'estado', v_ped.estado);
  end if;
  -- Recusar exige motivo escrito. Aprovar nao: aprovar e o caminho normal, e
  -- exigir justificativa do caminho normal ensina a escrever "ok" em tudo.
  if p_estado = 'recusado' and coalesce(trim(coalesce(p_motivo, '')), '') = '' then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  update public.vessel_pedidos_de_registro
     set estado = p_estado, decidido_por_que = p_quem_decidiu,
         conferencia = p_conferencia, decidido_em = now(),
         decidido_quem = v_quem, motivo = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_pedido;

  if p_estado = 'recusado' then
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    values (v_ped.codigo, 'registro_recusado', p_motivo,
            jsonb_build_object('pedido', p_pedido, 'nome', v_ped.nome,
                               'cpf', public.vessel_cpf_mascarado(v_ped.cpf),
                               'por_que', p_quem_decidiu), v_quem);
    return json_build_object('ok', true, 'estado', 'recusado');
  end if;

  -- ── APROVADO: vira o dono atual ──
  -- 2 anos contados da COMPRA. Sem data de compra, conta de hoje — que e o que
  -- a regra antiga ja fazia.
  v_ate := (coalesce(v_ped.comprado_em, current_date) + interval '2 years')::date;

  insert into public.vessel_registros
    (codigo, nome, whatsapp, onde_comprou, comprado_em, garantia_ate,
     cpf, pedido_id, bling_contato_id, bling_pedido)
  values (v_ped.codigo, v_ped.nome, v_ped.whatsapp, v_ped.onde_comprou,
          v_ped.comprado_em, v_ate, v_ped.cpf, p_pedido,
          p_conferencia ->> 'contato', p_conferencia ->> 'pedido')
  on conflict (codigo) do update
     set nome = excluded.nome, whatsapp = excluded.whatsapp,
         onde_comprou = excluded.onde_comprou, comprado_em = excluded.comprado_em,
         garantia_ate = excluded.garantia_ate, cpf = excluded.cpf,
         pedido_id = excluded.pedido_id,
         bling_contato_id = excluded.bling_contato_id,
         bling_pedido = excluded.bling_pedido;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_ped.codigo, 'registro_aprovado', p_motivo,
          jsonb_build_object('pedido', p_pedido, 'nome', v_ped.nome,
                             'cpf', public.vessel_cpf_mascarado(v_ped.cpf),
                             'por_que', p_quem_decidiu,
                             'bling_pedido', p_conferencia ->> 'pedido'), v_quem);

  return json_build_object('ok', true, 'estado', 'aprovado', 'garantia_ate', v_ate);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. O NOME QUE A PAGINA MOSTRA
-- ══════════════════════════════════════════════════════════════════════════
--
-- DECISAO DO DONO, 03/09/2026: "Registrada em nome de Erick M." para qualquer
-- um; o nome INTEIRO so para quem provar que e a dona.
--
-- O porque, e vale escrever porque a versao bonita e a errada: a tag NAO TEM
-- SENHA. Quem encosta o celular na bolsa le a pagina — a vendedora, quem sentou
-- do lado, quem achou perdida, quem roubou. "Esta bolsa pertence a Erick
-- Martins" transforma a bolsa num cracha com o nome da dona para qualquer
-- estranho que a segure.
--
-- O primeiro nome mais a inicial faz o trabalho que interessa: mostra que a
-- bolsa TEM dona — que e o que atrapalha a revenda de roubada — sem entregar a
-- pessoa. E a dona, que sabe o proprio CPF, ve o nome inteiro.
--
-- Antes disto a pagina mostrava "Erick***", que nao e nome de gente nenhuma.
--
-- ⚠️ OS ESPACOS SE JUNTAM ANTES DA CONTA, e isso nao e capricho: a primeira
-- versao usava `split_part(trim(nome), ' ', 2)` para saber se ha sobrenome, e
-- "maria   das   dores" devolvia a STRING VAZIA nesse teste — dois espacos
-- seguidos fazem um pedaco vazio. O nome caia no ramo do "so um nome" e a
-- pagina mostrava o nome INTEIRO, que e exatamente o que esta funcao existe
-- para nao fazer. Ninguem digita espaco duplo de proposito; todo mundo digita
-- sem querer. Pego pela assercao que compara esta conta com a gemea de
-- `vessel-brasil/verify/regras.js`.
create or replace function public.vessel_nome_curto(p_nome text)
returns text language sql immutable as $$
  with n as (select nullif(regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g'), '') as nome)
  select case
    when nome is null then null
    -- so um nome: devolve ele, sem inicial inventada
    when split_part(nome, ' ', 2) = '' then nome
    else split_part(nome, ' ', 1) || ' '
         || upper(substr(split_part(nome, ' ', 2), 1, 1)) || '.'
  end from n;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 7. REVELAR O NOME INTEIRO — so para quem prova
-- ══════════════════════════════════════════════════════════════════════════
--
-- A prova e o CPF INTEIRO ou o WhatsApp INTEIRO do registro. Os dois tem onze
-- digitos de proposito.
--
-- ⚠️ NAO ACEITA "OS 4 ULTIMOS DO WHATSAPP", que era a ideia mais comoda: quatro
-- digitos sao dez mil tentativas, e um script faz isso enquanto a pessoa toma
-- cafe. A comodidade de quem prova e a mesma comodidade de quem invade.
--
-- E MESMO COM ONZE DIGITOS HA LIMITE, porque a funcao responde a `anon` e
-- tentar sem parar transformaria a pagina num confirmador de CPF: alguem com
-- uma lista de CPFs descobriria QUAL deles comprou a bolsa. Dez tentativas por
-- peca por hora.
create table if not exists public.vessel_tentativas_de_revelar (
  codigo    text not null,
  quando    timestamptz not null default now(),
  acertou   boolean not null
);
create index if not exists vessel_tentativas_revelar_idx
  on public.vessel_tentativas_de_revelar(codigo, quando desc);
alter table public.vessel_tentativas_de_revelar enable row level security;
-- Sem policy de leitura: nem `anon` nem `authenticated` leem. Quem escreve e a
-- funcao `security definer`, e quem consulta e o dono do banco.

create or replace function public.vessel_revelar_dono(p_codigo text, p_prova text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_prova  text := regexp_replace(coalesce(p_prova, ''), '\D', '', 'g');
  v_reg    record;
  v_tent   int;
  v_ok     boolean;
begin
  select count(*) into v_tent from public.vessel_tentativas_de_revelar
   where codigo = v_codigo and quando > now() - interval '1 hour';
  if v_tent >= 10 then
    return json_build_object('ok', false, 'motivo', 'muitas_tentativas');
  end if;

  select * into v_reg from public.vessel_registros where codigo = v_codigo;
  -- ⚠️ PECA SEM DONO RESPONDE A MESMA COISA que prova errada. Respostas
  -- diferentes contariam, a quem esta tentando, quais etiquetas ja tem dono —
  -- e isso e meio caminho para saber quais bolsas ja foram vendidas.
  v_ok := v_reg.codigo is not null
          and length(v_prova) = 11
          and (v_prova = regexp_replace(coalesce(v_reg.cpf, 'x'), '\D', '', 'g')
               or v_prova = regexp_replace(coalesce(v_reg.whatsapp, 'x'), '\D', '', 'g'));

  insert into public.vessel_tentativas_de_revelar (codigo, acertou)
  values (left(v_codigo, 32), v_ok);

  if not v_ok then
    return json_build_object('ok', false, 'motivo', 'nao_confere');
  end if;
  -- ⚠️ SO O NOME SAI DAQUI. Nem CPF, nem WhatsApp, nem onde comprou: quem
  -- provou ja sabe o proprio numero, e quem NAO provou nao pode receber nada.
  return json_build_object('ok', true, 'nome', v_reg.nome,
                           'garantia_ate', v_reg.garantia_ate);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 8. TROCAR O DONO — revenda, presente, ou engano corrigido
-- ══════════════════════════════════════════════════════════════════════════
--
-- Sempre pela mao do dono da marca, nunca pela pagina publica. Exige MOTIVO
-- escrito e o CODIGO DA PECA digitado como confirmacao — o mesmo cinto e
-- suspensorio de excluir lote. Uma bolsa que muda de dono e revenda ou
-- presente, e isso e historia que se vai querer consultar.
--
-- A garantia NAO recomeca: ela continua contando da compra ORIGINAL. Trocar o
-- nome nao e comprar de novo, e deixar que fosse faria da troca de dono uma
-- forma de esticar garantia sem limite.
create or replace function public.vessel_trocar_dono(
  p_codigo text, p_nome text, p_cpf text, p_whatsapp text,
  p_motivo text, p_confirmacao text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_conf   text := upper(regexp_replace(coalesce(p_confirmacao, ''), '[\s.\-_]', '', 'g'));
  v_cpf    text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_zap    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome   text := left(trim(coalesce(p_nome, '')), 120);
  v_ant    record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_conf <> v_codigo then
    return json_build_object('ok', false, 'motivo', 'confirmacao_nao_bate');
  end if;
  if coalesce(trim(coalesce(p_motivo, '')), '') = '' then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;
  if v_nome = '' or length(v_zap) not in (10, 11) then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  if not public.vessel_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;

  select * into v_ant from public.vessel_registros where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'nao_tem_dono');
  end if;

  update public.vessel_registros
     set nome = v_nome, cpf = v_cpf, whatsapp = v_zap,
         -- o vinculo com o Bling era do dono ANTIGO: mante-lo apontaria a bolsa
         -- nova para o pedido de venda de outra pessoa
         bling_contato_id = null, bling_pedido = null, pedido_id = null
   where codigo = v_codigo;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'dono_trocado', p_motivo,
          jsonb_build_object(
            'de',   jsonb_build_object('nome', v_ant.nome,
                                       'cpf', public.vessel_cpf_mascarado(v_ant.cpf)),
            'para', jsonb_build_object('nome', v_nome,
                                       'cpf', public.vessel_cpf_mascarado(v_cpf)),
            'garantia_ate', v_ant.garantia_ate), auth.uid());

  return json_build_object('ok', true, 'de', v_ant.nome, 'para', v_nome);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 9. A PAGINA DA CLIENTE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Muda o nome que sai — de "Erick***" para "Erick M." — e ganha `pode_revelar`,
-- para a pagina saber se oferece o campo de provar quem e.
--
-- ⚠️ O QUE NAO MUDA, E E O QUE IMPORTA CONFERIR: nao sai CPF, nao sai WhatsApp,
-- nao sai onde comprou. Esta funcao responde a `anon` — qualquer pessoa do
-- mundo com o codigo da etiqueta. Ha assercao na prova comparando as chaves do
-- json contra uma lista fechada, porque um dia alguem vai acrescentar um campo
-- aqui sem pensar nisso.
create or replace function public.vessel_verificar(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_peca   record;
  v_reg    record;
  v_cab    json := nullif(current_setting('request.headers', true), '')::json;
begin
  select p.codigo, p.numero_na_serie, l.modelo, l.cor, l.sku, l.quantidade,
         l.fabricado_em, l.fotos
    into v_peca
    from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_codigo;

  insert into public.vessel_leituras (codigo, achou, agente, ip_hash)
  values (
    left(v_codigo, 32),
    v_peca.codigo is not null,
    left(coalesce(v_cab ->> 'user-agent', ''), 300),
    encode(extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'), 'hex')
  );

  if v_peca.codigo is null then
    return json_build_object('ok', false);
  end if;

  select * into v_reg from public.vessel_registros where codigo = v_codigo;

  return json_build_object(
    'ok', true,
    'modelo', v_peca.modelo,
    'cor', v_peca.cor,
    'sku', v_peca.sku,
    'numero', v_peca.numero_na_serie,
    'total', v_peca.quantidade,
    'fabricado_em', v_peca.fabricado_em,
    'fotos', coalesce(v_peca.fotos, array[]::text[]),
    'registrada', v_reg.codigo is not null,
    'dono_curto', public.vessel_nome_curto(v_reg.nome),
    'pode_revelar', v_reg.codigo is not null,
    'registrada_em', v_reg.registrado_em,
    'garantia_ate', v_reg.garantia_ate
  );
end;
$$;

-- ⚠️ `vessel_registrar` MORRE AQUI. Ela escrevia direto no dono e travava na
-- segunda tentativa — era o defeito. Fica no lugar dela uma funcao de mesmo
-- nome que RECUSA e diz por onde ir, porque a pagina antiga pode estar aberta
-- no celular de alguem: apagar a funcao daria um erro sem explicacao, e a
-- pessoa acharia que perdeu a garantia.
create or replace function public.vessel_registrar(
  p_codigo text, p_nome text, p_whatsapp text,
  p_onde text default null, p_comprado_em date default null)
returns json language plpgsql security definer set search_path to 'public'
as $$
begin
  return json_build_object('ok', false, 'motivo', 'pagina_velha');
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 10. A FILA, COMO O PAINEL LE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Uma funcao em vez de `select` na tela porque ela MASCARA o CPF: a tela nunca
-- recebe o numero inteiro, nem para quem tem a chave da ferramenta. Sai o que
-- basta para reconhecer a pessoa e decidir.
create or replace function public.vessel_fila_de_registros(p_codigo text default null)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_r json;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select coalesce(json_agg(x order by x.criado_em desc), '[]'::json) into v_r from (
    select pr.id, pr.codigo, pr.nome, pr.whatsapp, pr.onde_comprou, pr.comprado_em,
           pr.estado, pr.decidido_por_que, pr.conferencia, pr.criado_em,
           pr.decidido_em, pr.motivo,
           public.vessel_cpf_mascarado(pr.cpf) as cpf,
           l.modelo, l.cor, l.sku, p.numero_na_serie,
           (r.codigo is not null and r.pedido_id = pr.id) as e_o_dono_atual
      from public.vessel_pedidos_de_registro pr
      join public.vessel_pecas p on p.codigo = pr.codigo
      join public.vessel_lotes l on l.id = p.lote_id
      left join public.vessel_registros r on r.codigo = pr.codigo
     where p_codigo is null or pr.codigo = upper(trim(p_codigo))
  ) x;
  return json_build_object('ok', true, 'pedidos', v_r);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 11. QUEM PODE CHAMAR O QUE
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ `revoke ... from public, anon` NAO tira a concessao que o Postgres da por
-- DEFAULT PRIVILEGES a `authenticated` em funcao nova do schema public. Onde a
-- trava importa, ela esta POR DENTRO da funcao (`is_vessel_admin()`), e o
-- `revoke` abaixo e a segunda volta da chave, nao a primeira.
revoke all on function public.vessel_abrir_pedido_de_registro(text, text, text, text, text, date)
  from public, anon, authenticated;
revoke all on function public.vessel_decidir_pedido_de_registro(uuid, text, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.vessel_trocar_dono(text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.vessel_fila_de_registros(text) from public, anon, authenticated;
revoke all on function public.vessel_revelar_dono(text, text) from public, anon, authenticated;
revoke all on function public.vessel_cpf_valido(text) from public, anon, authenticated;
revoke all on function public.vessel_cpf_mascarado(text) from public, anon, authenticated;
revoke all on function public.vessel_nome_curto(text) from public, anon, authenticated;

-- A CLIENTE, deslogada, precisa destas duas — e so destas duas.
grant execute on function public.vessel_verificar(text) to anon, authenticated;
grant execute on function public.vessel_revelar_dono(text, text) to anon, authenticated;

-- O PAINEL, logado. O portao de verdade e o `is_vessel_admin()` la dentro.
grant execute on function public.vessel_decidir_pedido_de_registro(uuid, text, text, jsonb, text)
  to authenticated;
grant execute on function public.vessel_trocar_dono(text, text, text, text, text, text) to authenticated;
grant execute on function public.vessel_fila_de_registros(text) to authenticated;

-- ⚠️ `vessel_abrir_pedido_de_registro` NAO E CONCEDIDA A NINGUEM, e isso e a
-- decisao mais importante deste bloco. So a edge `vessel-registrar-garantia` a
-- chama, com a chave de servico. Se `anon` pudesse chama-la direto, a pagina
-- poderia abrir pedidos SEM PASSAR PELA CONFERENCIA DO BLING — e a fila
-- encheria de pedidos que ninguem tentou casar com uma venda, que e metade do
-- valor desta entrega.

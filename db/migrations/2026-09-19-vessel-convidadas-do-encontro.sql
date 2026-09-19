-- QUEM FOI, no Private Edit: as convidadas de um encontro, uma a uma.
--
-- O dado JÁ EXISTE. `vessel_conta_das_private_edits` já lê `vessel_atendimentos`
-- por `evento_codigo` para contar quem respondeu, quem disse sim, quem confirmou
-- e quem compareceu. Esta função devolve as LINHAS em vez do número — é a mesma
-- leitura, com outro recorte.
--
-- ⚠️ É DADO PESSOAL: nome e telefone de cliente. Por isso ela fica atrás de
-- `is_vessel_atendimentos()` — exatamente a mesma permissão que já protege os
-- números deste mesmo encontro na mesma tela — e o `grant` é só para
-- `authenticated`, NUNCA para `anon`. A página pública do convite não pode nem
-- chegar perto: o próprio módulo 07 proíbe com todas as letras ("sem lista
-- pública de convidadas").
--
-- ⚠️ É LEITURA, ENTÃO É A TRAVA DE VER. `is_vessel_atendimentos_editar()` aqui
-- esconderia a lista de quem tem permissão legítima de olhar o encontro.
--
-- ⚠️ SÓ QUEM NÃO É `teste` — o MESMO filtro das contas
-- (`not coalesce(t.teste, false)`). Senão o número do topo e a lista de baixo
-- discordam NA MESMA TELA, e a pessoa não tem como saber qual dos dois mente.
--
-- ⚠️ O `codigo` QUE CHEGA É NORMALIZADO IGUALZINHO AO DAS IRMÃS —
-- `upper(nullif(trim(coalesce(p_codigo, '')), ''))`, mesma expressão e mesma
-- ordem de `vessel_private_edit_encerrar`, `_editar`, `_apagar` e `_arquivar`
-- (ver `db/migrations/2026-09-19-vessel-private-edit-mexer.sql`). É cópia
-- deliberada, para as cinco não poderem divergir: as quatro ações e este "ver
-- quem foi" moram lado a lado no MESMO bloco da tela. E o valor normalizado
-- vale para a função INTEIRA — a busca do encontro E o filtro das convidadas.
-- Um só desses dois lugares lendo `p_codigo` cru já abre a fresta: a janela de
-- venda sairia de um encontro e a lista de outro.
create or replace function public.vessel_convidadas_do_encontro(
  p_codigo text,
  -- ⚠️ A JANELA DE VENDA ENTRA POR PARÂMETRO PORQUE O `comprou` DEPENDE DELA.
  -- Ver o bloco grande sobre `comprou` lá embaixo.
  --
  -- ⚠️⚠️ O PADRÃO É 14 DE PROPÓSITO: é EXATAMENTE o padrão da irmã
  -- `vessel_conta_das_private_edits(p_dias int default 14, ...)`. Não é
  -- coincidência e não pode ser mexido de um lado só.
  --
  -- A receita do topo e a coluna "Comprou" da lista respondem à MESMA pergunta
  -- sobre o MESMO encontro, lado a lado na mesma tela. Se os dois padrões
  -- fossem diferentes, bastaria quem chama esquecer de passar a janela para UMA
  -- das duas — e a tela mostraria um número medido com uma régua e uma coluna
  -- medida com outra, sem erro nenhum para denunciar. Com o mesmo padrão, o
  -- esquecimento ainda dá o mesmo resultado nos dois.
  --
  -- ⚠️ E quando a tela PASSA a janela, tem de passar o MESMO número para as
  -- duas. O padrão igual tira a armadilha do caminho de quem esquece; ele não
  -- conserta quem manda dois números diferentes de propósito.
  p_dias int default 14
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSÃO E MESMA ORDEM das irmãs que mexem no encontro.
  v_codigo   text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ `greatest(coalesce(...), 0)` copiado de `vessel_conta_das_private_edits`:
  -- quem manda `p_dias: null` de fora NÃO cai no padrão do parâmetro, cai em
  -- NULL — e `between x and NULL` não devolve linha nenhuma, calado. Janela
  -- negativa também não existe.
  --
  -- ⚠️ E O 14 AQUI É O MESMO 14 DO PARÂMETRO, que é o mesmo da irmã que conta.
  -- Mexer num e esquecer do outro faria `p_dias: null` medir uma janela e
  -- `p_dias` omitido medir outra, na mesma função.
  v_dias     int := greatest(coalesce(p_dias, 14), 0);
  v_quando   timestamptz;
  v_resposta json;
begin
  -- ⚠️ A PERMISSÃO É CONFERIDA AQUI DENTRO: `security definer` roda como dono
  -- da função, então sem esta linha qualquer pessoa logada no iamundi leria
  -- nome e telefone das clientes, por cima do RLS de `vessel_pessoas`.
  --
  -- ⚠️ LISTA VAZIA, NÃO ERRO. A irmã que conta levanta 42501 porque ela é a
  -- tela inteira; esta aqui é um botão dentro de um bloco que já está na tela,
  -- e um erro vermelho no meio de um encontro que a pessoa está enxergando
  -- diria "o sistema quebrou" quando a verdade é "isto aqui não é para você".
  if not public.is_vessel_atendimentos() then
    return '[]'::json;
  end if;

  -- ⚠️ O ENCONTRO É BUSCADO SEM FILTRAR `teste` NEM `arquivada`, de propósito.
  -- Quem pergunta "quem foi neste encontro" já está com o encontro na frente —
  -- inclusive um arquivado, que a tela mostra quando pedem
  -- `p_incluir_arquivadas`. Filtrar aqui devolveria lista vazia para um bloco
  -- visível, que é o jeito mais confuso possível de dizer "não".
  --
  -- ⚠️ E É DAQUI QUE SAI A ÂNCORA DA JANELA DE VENDA. Sem o `quando` do
  -- encontro não há como dizer o que é "comprou por causa dele".
  select e.quando into v_quando
    from public.vessel_private_edits e
   where e.codigo = v_codigo;

  if not found then
    return '[]'::json;
  end if;

  -- ⚠️ A ORDEM SAI DA COLUNA, NÃO DO TEXTO DO JSON. Ordenar por
  -- `linha ->> 'respondeu_em'` compararia STRINGS de data — que o Postgres
  -- imprime no fuso da SESSÃO de quem chamou, com o deslocamento colado no
  -- fim. Basta duas sessões diferentes para a mesma lista sair em ordens
  -- diferentes, sem erro nenhum. Quem sabe qual instante veio antes é o banco.
  select coalesce(json_agg(linha order by ordem), '[]'::json)
    into v_resposta
    from (
      select json_build_object(
        'nome',        pe.nome,
        'telefone',    pe.telefone,
        'rsvp',        t.rsvp,
        'status',      t.status,
        -- "Respondeu em" é o instante em que a linha do atendimento nasceu —
        -- que, num Private Edit, é o RSVP da convidada no convite.
        'respondeu_em', t.criado_em,
        'presenca_em', t.presenca_em,
        -- ⚠️⚠️ `comprou` TEM DE SER A MESMA REGRA DA RECEITA DO TOPO, e não
        -- "comprou alguma vez na vida".
        --
        -- Não existe no dado NENHUM campo dizendo "esta compra veio daquele
        -- encontro" — o que existe é a mesma cliente comprando PERTO dele. Por
        -- isso a receita de `vessel_conta_das_private_edits` só soma um pedido
        -- quando as DUAS coisas valem (ver
        -- `db/migrations/2026-09-18-vessel-private-edit.sql`, bloco 5):
        --   · a convidada COMPARECEU de verdade (`t.status = 'realizado'`), e
        --   · o pedido caiu DENTRO da janela de venda, no fuso de São Paulo.
        --
        -- Escrever aqui um `exists` sobre `vessel_pedidos` sem essas duas
        -- condições poria "Comprou: Sim" ao lado de uma receita de R$ 0,00 —
        -- porque a compra de dois anos atrás, ou a da convidada que não
        -- apareceu, não entra na receita. A tela se contradiria sozinha, e
        -- quem lesse não teria como saber qual metade está certa.
        --
        -- As duas condições abaixo são as mesmas do `where` daquela soma. O
        -- `exists` de lá ainda passa por `vessel_atendimentos` para achar a
        -- pessoa; aqui a pessoa já É a linha `t` — que já vem filtrada pelo
        -- encontro e por `not teste` — então sobra o `status` e a janela.
        'comprou', (
          t.status = 'realizado'
          and exists (
            select 1 from public.vessel_pedidos p
             where p.pessoa_id = t.pessoa_id
               and p.data_do_pedido
                     between (v_quando at time zone 'America/Sao_Paulo')::date
                         and (v_quando at time zone 'America/Sao_Paulo')::date + v_dias))
      ) as linha,
      t.criado_em as ordem
      from public.vessel_atendimentos t
      join public.vessel_pessoas pe on pe.id = t.pessoa_id
     where t.evento_codigo = v_codigo
       -- ⚠️ O MESMO FILTRO DAS CONTAS. Ver o cabeçalho.
       and not coalesce(t.teste, false)
    ) as linhas;

  return v_resposta;
end;
$function$;

-- ⚠️ AS DUAS LINHAS: `revoke ... from public` NÃO fecha `authenticated`, e uma
-- função nova nasce ABERTA para `public` — o que inclui `anon`, que é quem abre
-- a página do convite. Aqui isso publicaria nome e telefone de cliente na
-- internet.
revoke all on function public.vessel_convidadas_do_encontro(text, integer) from public, anon, authenticated;
grant execute on function public.vessel_convidadas_do_encontro(text, integer) to authenticated;

comment on function public.vessel_convidadas_do_encontro(text, integer) is
  'As convidadas de um Private Edit, uma por linha: nome, telefone, rsvp, '
  'status, respondeu_em, presenca_em e comprou. DADO PESSOAL — atras de '
  'is_vessel_atendimentos() e so para authenticated. `comprou` usa a MESMA '
  'regra da receita de vessel_conta_das_private_edits: compareceu E comprou '
  'dentro da janela de p_dias, contada do dia do encontro no fuso de Sao '
  'Paulo. O padrao de p_dias e 14, o MESMO da irma que conta, para que quem '
  'esquecer de passar a janela a uma das duas ainda receba as duas medidas '
  'com a mesma regua. Passando, passar o MESMO numero para as duas.';

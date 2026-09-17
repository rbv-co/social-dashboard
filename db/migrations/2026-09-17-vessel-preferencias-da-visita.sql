-- AS PREFERÊNCIAS DA VISITA — o segundo formulário da LP.
--
-- Pedido do dono (17/09/2026): quem clica em "Agendar uma visita" responde,
-- antes do agradecimento, o dia e a hora de preferência, que tipo de peça
-- procura, para que ocasião, se quer o Personal Atelier, se vem acompanhada e
-- se há algo específico a preparar.
--
-- ⚠️ AS COLUNAS MORAM NA LINHA DA PESSOA, e não numa tabela separada. É uma
-- ficha por lead, e a Client Advisor lê essa ficha ao lado do contato dela, na
-- MESMA linha da planilha espelho. Uma tabela à parte obrigaria a juntar duas
-- planilhas à mão para responder "quem é essa pessoa que quer vir quinta-feira".
--
-- ⚠️ A POLÍTICA É SEGUNDA A QUINTA, DAS 11H ÀS 17H. Ela está escrita duas vezes
-- de propósito: aqui e em `vessel-brasil/regras-da-visita.mjs`. A da página é
-- GENTILEZA (avisa no idioma dela, sem viagem de rede); a daqui é a TRAVA —
-- quem manda um POST na mão não passa pela tela. Mudar a política pede as duas.

alter table public.vessel_lista_espera
  add column if not exists visita_data          date,
  add column if not exists visita_hora          text,
  add column if not exists visita_bolsa         text,
  add column if not exists visita_ocasiao       text,
  add column if not exists visita_atelier       boolean,
  add column if not exists visita_acompanhantes int,
  add column if not exists visita_pedido        text,
  add column if not exists visita_detalhes_em   timestamptz;

comment on column public.vessel_lista_espera.visita_data is
  'Dia de preferencia para o private appointment. Segunda a quinta (a trava esta na funcao).';
comment on column public.vessel_lista_espera.visita_hora is
  'Hora de preferencia, HH:MM, de meia em meia hora entre 11:00 e 17:00.';
comment on column public.vessel_lista_espera.visita_acompanhantes is
  'Quantas pessoas vem ALEM dela. 0 = vem sozinha; nulo = nao respondeu. Sao coisas diferentes.';
comment on column public.vessel_lista_espera.visita_atelier is
  'Marcou interesse no Personal Atelier (peca sob medida no atelie).';

-- A lista da Client Advisor: "quem quer vir, e quando". Só quem respondeu entra.
create index if not exists vessel_lista_espera_visita_idx
  on public.vessel_lista_espera (visita_data, visita_hora)
  where visita_data is not null;

/**
 * AS PREFERÊNCIAS, NA MESMA ESCRITA QUE MARCA O OBJETIVO.
 *
 * ⚠️ POR QUE ELA GRAVA O OBJETIVO TAMBÉM, em vez de a página chamar
 * `vessel_marcar_objetivo` antes e esta função depois: a senha é de USO ÚNICO —
 * marcar o objetivo a queima (`senha_hash = null`). Duas chamadas em sequência
 * fariam a segunda chegar com uma senha que já não abre nada, e as respostas se
 * perderiam em silêncio, porque UPDATE que não acha linha não dá erro.
 *
 * ⚠️ AS TRAVAS MORAM AQUI, e não em CHECK de coluna. Já aconteceu neste projeto
 * de um CHECK derrubar a transação INTEIRA quando chegou um valor que ninguém
 * previu. Aqui o valor estranho é uma resposta tratada, não um erro 500.
 */
create or replace function public.vessel_detalhar_visita(
  p_senha         text,
  p_data          date,
  p_hora          text,
  p_bolsa         text    default null,
  p_ocasiao       text    default null,
  p_atelier       boolean default false,
  p_acompanhantes int     default null,
  p_pedido        text    default null,
  p_loja          text    default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash  text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  -- ⚠️ A DATA DA CASA, não a do servidor. O banco roda em UTC: depois das 21h
  -- de Brasília `current_date` já virou o dia seguinte, e uma visita marcada
  -- para amanhã seria recusada como "passada" — à noite, e só à noite.
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_loja  text;
  v_id    bigint;
begin
  if p_data is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;
  -- `isodow`: segunda = 1 … domingo = 7. A política é segunda a quinta.
  if extract(isodow from p_data) not between 1 and 4 then
    return json_build_object('ok', false, 'situacao', 'dia_fechado');
  end if;
  -- Nunca hoje nem ontem: a visita é PREPARADA antes (seleção de peças e
  -- Client Advisor dedicada), e preparar leva pelo menos um dia.
  if p_data <= v_hoje then
    return json_build_object('ok', false, 'situacao', 'data_passada');
  end if;
  if p_data > v_hoje + 120 then
    return json_build_object('ok', false, 'situacao', 'data_longe');
  end if;

  -- 11:00, 11:30, … 16:30, 17:00 — treze horários, e só eles.
  if coalesce(p_hora, '') !~ '^(1[1-6]:(00|30)|17:00)$' then
    return json_build_object('ok', false, 'situacao', 'hora_fora');
  end if;

  -- Vazio é "não respondeu" e passa; valor fora da lista é recusado. Responder
  -- é opcional; INVENTAR resposta não é.
  if nullif(trim(coalesce(p_bolsa, '')), '') is not null
     and p_bolsa not in ('hand-bag', 'shoulder-bag', 'east-west', 'toda-colecao') then
    return json_build_object('ok', false, 'situacao', 'bolsa_invalida');
  end if;
  if nullif(trim(coalesce(p_ocasiao, '')), '') is not null
     and p_ocasiao not in ('dia-a-dia', 'trabalho', 'viagem', 'noite', 'presente') then
    return json_build_object('ok', false, 'situacao', 'ocasiao_invalida');
  end if;
  if p_acompanhantes is not null and (p_acompanhantes < 0 or p_acompanhantes > 6) then
    return json_build_object('ok', false, 'situacao', 'acompanhantes_invalido');
  end if;
  if length(trim(coalesce(p_pedido, ''))) > 400 then
    return json_build_object('ok', false, 'situacao', 'pedido_longo');
  end if;

  -- A loja segue o mesmo padrão de `vessel_marcar_objetivo`: o banco resolve
  -- quando a tela não manda. Não cravar loja no código da tela — duas lojas
  -- fecharam em 2026.
  v_loja := coalesce(nullif(trim(p_loja), ''), 'iguatemi');
  if v_loja not in ('tivoli', 'iguatemi') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;

  -- A senha vale por 2 horas, como na irmã.
  update public.vessel_lista_espera
     set objetivo             = 'visita',
         loja                 = v_loja,
         visita_data          = p_data,
         visita_hora          = p_hora,
         visita_bolsa         = nullif(trim(coalesce(p_bolsa, '')), ''),
         visita_ocasiao       = nullif(trim(coalesce(p_ocasiao, '')), ''),
         visita_atelier       = coalesce(p_atelier, false),
         visita_acompanhantes = p_acompanhantes,
         visita_pedido        = nullif(trim(coalesce(p_pedido, '')), ''),
         visita_detalhes_em   = now(),
         -- USO ÚNICO: some assim que usada.
         senha_hash           = null,
         -- O espelho precisa rodar de novo para levar as preferências adiante.
         planilha_em          = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  -- ⚠️ UPDATE QUE NÃO ACHA LINHA NÃO DÁ ERRO: devolve zero linhas, calado. Sem
  -- esta checagem, senha errada ou vencida responderia "deu certo", e a página
  -- mostraria o agradecimento por cima de nada.
  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;

  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

-- ⚠️ `revoke ... from public` NÃO fecha `anon` nem `authenticated`: no Supabase
-- os dois papéis recebem execute por privilégio PADRÃO do schema, que é outra
-- concessão. Já custou um buraco neste projeto em 16/09/2026. Por isso os três
-- vêm escritos, e só então o `anon` (a página pública) é reaberto — de novo
-- como a irmã `vessel_marcar_objetivo`, que também deixa `authenticated` fora:
-- nenhuma sessão autenticada tem necessidade desta porta.
revoke all on function public.vessel_detalhar_visita(text, date, text, text, text, boolean, int, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_detalhar_visita(text, date, text, text, text, boolean, int, text, text)
  to anon;

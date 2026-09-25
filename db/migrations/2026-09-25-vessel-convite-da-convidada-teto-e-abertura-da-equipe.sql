-- O CONVITE INDIVIDUAL DO PRIVATE EDIT: TETO DE RESPOSTAS E ABERTURA DA EQUIPE
-- QUE NÃO CONTA.
--
-- Pedido do dono (pacote de pequenos consertos, 25/09/2026), sobre as portas
-- públicas do convite de UMA convidada (`/pe/<encontro>/<convidada>`, de
-- `2026-09-22-vessel-t11-bases-do-stylist-circle.sql`):
--
-- (a) `vessel_rsvp_da_convidada` ganha TETO: 10 respostas por convidada por
--     hora e 10 por endereço (hash do IP) por hora. Passou, responde o mesmo
--     "recebido" e não grava. As tentativas moram em `vessel_rsvp_tentativas`
--     (nova, fechada: só a função escreve e lê; ninguém de fora, nem a Central).
--     A MESMA assinatura: a página do site não muda.
--
-- (b) `vessel_convite_da_convidada` não conta a abertura feita pela equipe.
--     O QUE SE ACHOU: a página do site chama esta função SEMPRE com a chave
--     anônima (nunca com a sessão de alguém), e a Central NÃO chama esta
--     função nem abre o link — ela só monta a mensagem. A abertura "da equipe"
--     é alguém da equipe clicando no link à mão (conferir antes de mandar,
--     ou tocar no link da conversa). Nenhuma regra só do banco enxerga isso.
--     A REGRA ESCOLHIDA: um parâmetro novo, `p_equipe` (padrão `false`, quem
--     não manda continua contando como hoje), que a página preenche quando o
--     endereço traz `?equipe=1` — o marcador que o botão "Ver o convite dela"
--     do cartão, na Central, põe no link. E, de brinde, se um dia a chamada
--     vier com a sessão de alguém da Central, também não conta.
--     ⚠️ A assinatura MUDA (2 → 3 parâmetros): a de 2 é apagada ANTES, senão o
--     site (que manda `p_chave` e `p_convidada` por nome) cairia em "não sei
--     qual das duas escolher". Os grants são refeitos iguais aos de hoje
--     (anon, authenticated, service_role).
--     ⚠️ Até o site repassar `p_equipe` (uma linha em
--     `vessel-brasil/private-edit/index.html`), tudo conta como hoje.

create table if not exists public.vessel_rsvp_tentativas (
  id             bigserial primary key,
  atendimento_id bigint not null references public.vessel_atendimentos(id) on delete cascade,
  ip_hash        text,
  momento        timestamptz not null default now(),
  teste          boolean not null default false
);
create index if not exists vessel_rsvp_tentativas_atendimento_idx on public.vessel_rsvp_tentativas (atendimento_id, momento);
create index if not exists vessel_rsvp_tentativas_ip_idx on public.vessel_rsvp_tentativas (ip_hash, momento);
-- FECHADA: RLS ligada e sem política nenhuma, e sem grant para anon nem
-- authenticated — a leitura de fora é RECUSADA (42501), não uma lista vazia.
-- Só `vessel_rsvp_da_convidada` (security definer) mexe nela.
alter table public.vessel_rsvp_tentativas enable row level security;
revoke all on table public.vessel_rsvp_tentativas from public, anon, authenticated;
revoke all on sequence public.vessel_rsvp_tentativas_id_seq from public, anon, authenticated;

create or replace function public.vessel_rsvp_da_convidada(p_chave text, p_convidada text, p_resposta text, p_aceite_marketing boolean DEFAULT false, p_aceite_versao text DEFAULT NULL::text, p_armadilha text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t   record;
  v_ip  text := public.vessel_hash_de_origem();
begin
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  if p_resposta is null or p_resposta not in ('sim', 'falar-com-equipe') then
    return json_build_object('ok', false, 'situacao', 'resposta_invalida');
  end if;
  select t.id, t.pessoa_id, t.teste into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''))
     and e.ativa and not coalesce(e.arquivada, false)
     and e.status not in ('cancelado', 'nao_realizado', 'realizado');
  if not found then return json_build_object('ok', false, 'situacao', 'convite_invalido'); end if;

  -- ⚠️ 25/09/2026: O TETO DE TENTATIVAS, no estilo das portas públicas da
  -- Beauty Session: passou de 10 respostas na última hora para ESTA convidada,
  -- ou de 10 vindas do mesmo endereço (o hash do IP), responde o mesmo
  -- "recebido" de sempre e NÃO grava nada — quem apanha não pode saber. Um
  -- robô com o link não reescreve a resposta dela sem fim, nem enche
  -- `vessel_consentimentos`. Só conta tentativa com convite válido: link
  -- errado já volta `convite_invalido` sem gravar.
  if (select count(*) from public.vessel_rsvp_tentativas
       where atendimento_id = v_t.id and momento > now() - interval '1 hour') >= 10
     or (select count(*) from public.vessel_rsvp_tentativas
          where ip_hash = v_ip and momento > now() - interval '1 hour') >= 10 then
    return json_build_object('ok', true, 'situacao', 'recebido');
  end if;
  insert into public.vessel_rsvp_tentativas (atendimento_id, ip_hash, teste)
  values (v_t.id, v_ip, coalesce(v_t.teste, false));

  update public.vessel_atendimentos set rsvp = p_resposta, atualizado_em = now() where id = v_t.id;

  -- A permissão de atendimento, como no RSVP geral — uma por hora no máximo,
  -- para quem aperta o botão três vezes não virar três aceites.
  -- ⚠️ `momento`, NÃO `criado_em`: `vessel_consentimentos` não tem
  -- `criado_em` (conferido no banco antes de escrever esta linha).
  if not exists (select 1 from public.vessel_consentimentos
                  where pessoa_id = v_t.pessoa_id and finalidade = 'atendimento'
                    and fonte = 'private-edit' and momento > now() - interval '1 hour') then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'atendimento', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  if coalesce(p_aceite_marketing, false) then
    insert into public.vessel_consentimentos (pessoa_id, finalidade, canal, versao, fonte, teste)
    values (v_t.pessoa_id, 'marketing', 'whatsapp', nullif(trim(coalesce(p_aceite_versao, '')), ''),
            'private-edit', v_t.teste);
  end if;
  return json_build_object('ok', true, 'situacao', 'recebido');
end;
$function$;

drop function if exists public.vessel_convite_da_convidada(text, text);

create function public.vessel_convite_da_convidada(p_chave text, p_convidada text, p_equipe boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ `json`, NÃO `jsonb`, ENQUANTO NADA MUDA: `jsonb` reordena as chaves (não
  -- guarda a ordem de inserção), e quem compara a resposta pelo texto (a
  -- página, ou a prova) veria uma diferença que não existe. Só vira `jsonb`
  -- no ponto em que de fato se mescla, mais abaixo.
  v_geral json;
  v_t record;
begin
  if exists (select 1 from public.vessel_private_edits e
              where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
                and (coalesce(e.arquivada, false)
                     or e.status in ('cancelado', 'nao_realizado', 'realizado'))) then
    return json_build_object('ok', false, 'situacao', 'nao_encontrado');
  end if;
  v_geral := public.vessel_convite_da_private_edit(p_chave);
  if coalesce((v_geral ->> 'ok')::boolean, false) is not true then return v_geral; end if;
  select t.id, t.rsvp, pe.nome into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
    join public.vessel_pessoas pe on pe.id = t.pessoa_id
   where e.chave = upper(nullif(trim(coalesce(p_chave, '')), ''))
     and t.chave_convite = upper(nullif(trim(coalesce(p_convidada, '')), ''));
  if not found then return v_geral; end if;
  -- ⚠️ 25/09/2026: ABERTURA DA EQUIPE NÃO CONTA. Duas portas para dizer "sou
  -- da equipe": a página abriu com o marcador da Central (`?equipe=1` no link
  -- "Ver o convite dela" do cartão, que a página repassa em `p_equipe`), ou a
  -- chamada veio com a sessão de alguém da Central (Atendimentos). A resposta
  -- é a MESMA — a equipe vê exatamente o que a convidada vê —, só o contador
  -- e o "abriu em" não se mexem. O marcador não é segredo nem trava: quem o
  -- escrevesse à mão só deixaria de contar a própria abertura.
  if not (coalesce(p_equipe, false)
          or (auth.uid() is not null and public.is_vessel_atendimentos())) then
    update public.vessel_atendimentos
       set convite_aberto_em = coalesce(convite_aberto_em, now()),
           convite_aberturas = convite_aberturas + 1
     where id = v_t.id;
  end if;
  return (v_geral::jsonb || jsonb_build_object(
    'primeiro_nome', split_part(trim(v_t.nome), ' ', 1),
    'resposta', v_t.rsvp))::json;
end;
$function$;

revoke all on function public.vessel_convite_da_convidada(text, text, boolean) from public;
grant execute on function public.vessel_convite_da_convidada(text, text, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

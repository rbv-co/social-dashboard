-- 053 — ARQUIVAR O QUE JÁ ACABOU DE VERDADE (21/09/2026)
--
-- O dono, olhando a lista de reservas: "não consigo limpar as reservas que já
-- foram". Medido no dia: de 14 reservas, 7 estavam `usada` e 4 `aprovada`
-- vencidas — 11 sem como sair da lista, nunca. Só as 2 revogadas podiam.
--
-- ⚠️ POR QUE ESTA MIGRATION EXISTE, E É A LIÇÃO DELA: de manhã eu liberei
-- `usada` no CÓDIGO DA TELA (`historico-de-reservas.js`) e dei por encerrado,
-- porque o comentário de lá dizia que a trava de verdade estava no gatilho.
-- Eu li o comentário e NÃO li o gatilho. O botão "Arquivar" passou a aparecer
-- na reserva usada e o banco continuaria recusando — tela que promete e banco
-- que nega é pior que botão nenhum. A guarda de verdade é esta função aqui.
--
-- O que muda:
--   * `usada` passa a poder ser arquivada. É o fim NORMAL de uma reserva: o
--     carro saiu, rodou e voltou.
--   * `aprovada` VENCIDA e que nunca virou viagem também. Ela não foi usada e
--     não foi encerrada por ninguém — o carro simplesmente não saiu, e o prazo
--     passou. Sem isto ela fica na lista para sempre, porque não existe (e o
--     dono não pediu) um caminho de "encerrar como não usada".
--   * `pendente` continua NUNCA, e por escrito: um pedido por decidir que some
--     da fila de aprovação é o pior destino possível para ele.
--   * `aprovada` AINDA VÁLIDA continua não podendo — arquivar a reserva que
--     está segurando um carro esconderia justamente o que precisa estar à
--     vista. (É o caso do Caio com o KWID RVU6B06 até 30/09.)
--
-- Desarquivar segue livre para quem pode aprovar: só o arquivar tem regra.

create or replace function public.frota_checar_arquivamento()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  venceu boolean;
begin
  if new.arquivada_em is not distinct from old.arquivada_em then
    return new;
  end if;

  if not public.pode_aprovar_frota() then
    raise exception 'Você não pode arquivar reserva de veículo. Peça a quem aprova.'
      using errcode = 'check_violation';
  end if;

  if new.arquivada_em is not null then
    -- Sem hora de devolução não dá pra dizer que venceu; trata-se como ainda
    -- valendo, que é a resposta que mantém o pedido à vista.
    venceu := new.devolucao_prevista is not null
              and new.devolucao_prevista < now()
              and new.uso_id is null;

    if new.situacao not in ('recusada', 'cancelada', 'revogada', 'usada')
       and not (new.situacao = 'aprovada' and venceu) then
      raise exception
        'Só reserva encerrada ou vencida pode ser arquivada. Esta está %, e pedido em aberto não some da lista.',
        new.situacao
        using errcode = 'check_violation';
    end if;
    new.arquivada_por := auth.uid();
  else
    new.arquivada_por := null;
  end if;

  return new;
end;
$function$;

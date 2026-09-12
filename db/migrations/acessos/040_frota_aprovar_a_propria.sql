-- Frota D24: quem administra a Frota aprova a própria requisição.
--
-- POR QUE ESTA MIGRATION EXISTE, e por que ela não estava prevista:
-- o desenho da fase afirmava que esta mudança era só de tela, porque
-- `is_frota_admin()` já libera `for all` em `frota_requisicoes`. **Estava
-- errado.** A RLS permite a escrita, mas o GATILHO
-- `trg_frota_checar_decisao` (migration 023) a rejeita — e diz na cara:
-- "Esta requisição é sua. Quem aprova é a outra pessoa". Sem esta migration, a
-- tela mostraria o botão de aprovar e o clique falharia com a mensagem da regra
-- velha, que é pior que não ter botão. Achado pela revisão da Fase D-1.
--
-- A REGRA QUE SAI, e o que o dono aceitou perder: até 12/08/2026 ninguém
-- decidia a própria requisição, para a aprovação ser um segundo par de olhos —
-- e o comentário da 023 dizia que superadmin não era exceção. Na prática, com
-- dois aprovadores e a maior parte dos pedidos saindo do próprio dono, a regra
-- não produzia revisão: produzia requisição parada. Duas ficaram travadas desde
-- 11/08 sem saída nenhuma pela tela. O dono derrubou a regra, ciente disso, e
-- escolheu que a aprovação da própria não ganha marca visual diferente.
--
-- O QUE NÃO SAI, e é o que faz isto continuar auditável:
--   1. `pode_aprovar_frota()` continua obrigatório. Quem não tem a chave
--      'frota.aprovar' (nem é superadmin) continua barrado — a mudança é sobre
--      QUEM pode aprovar a própria, não sobre quem pode aprovar.
--   2. `decidida_por` e `decidida_em` continuam sendo gravados pelo gatilho.
--      O rastro de quem decidiu segue no banco; o que o dono dispensou foi o
--      aviso na tela, não o registro.
--
-- Espelha exatamente o que `podeDecidir()` em requisicoes.js passou a fazer:
-- tem permissão E está pendente. Duas respostas diferentes pra mesma pergunta
-- é o defeito que esta central já pagou caro em outras ferramentas.

create or replace function public.frota_checar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.situacao is distinct from old.situacao
     and new.situacao in ('aprovada','recusada') then

    if not public.pode_aprovar_frota() then
      raise exception 'Você não tem permissão para aprovar requisições de veículo.'
        using errcode = 'check_violation';
    end if;

    -- A busca por `minha_pessoa` saiu junto com a regra: ela só existia para
    -- descobrir se o solicitante era quem estava decidindo. Sem a regra, é uma
    -- consulta a `acessos_pessoas`+`profiles` a cada decisão, sem uso nenhum.

    new.decidida_por := auth.uid();
    new.decidida_em := now();
  end if;
  return new;
end $$;

-- O gatilho em si não muda (mesmo nome, mesma tabela, mesmo BEFORE UPDATE);
-- `create or replace function` já basta. Recriado por garantia, porque a 023
-- também o recria e as duas migrations precisam poder rodar em qualquer ordem
-- num banco novo.
drop trigger if exists trg_frota_checar_decisao on public.frota_requisicoes;
create trigger trg_frota_checar_decisao
  before update on public.frota_requisicoes
  for each row execute function public.frota_checar_decisao();

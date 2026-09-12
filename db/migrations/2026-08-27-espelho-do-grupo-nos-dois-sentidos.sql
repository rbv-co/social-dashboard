-- O ESPELHO DO GRUPO DO CANAL PASSA A VALER NOS DOIS SENTIDOS.
--
-- POR QUE EXISTE (medido na produção em 27/08/2026):
--
-- Em 21/08 o grupo do canal ganhou identidade própria: a tabela `canais_grupos`
-- e a coluna `bling_lojas.grupo_id`. A migration foi aplicada no banco, e o
-- gatilho `trg_espelhar_grupo_do_canal` nasceu com ela para manter o texto
-- antigo (`bling_lojas.grupo`) de acordo com o apontamento novo.
--
-- Só que o gatilho escuta `UPDATE OF grupo_id` e copia numa direção só:
--
--     grupo_id  ──►  grupo (texto)
--
-- E A TELA QUE ESTÁ NO AR ESCREVE O TEXTO. A seção "Canais de venda" do Config
-- de Admin é de 20/08, anterior ao `grupo_id`, e faz `PATCH bling_lojas` com
-- `{ grupo: 'Varejo' }`. Esse caminho não passa pelo gatilho: o texto muda e o
-- `grupo_id` fica apontando para onde apontava antes.
--
-- O CÓDIGO QUE LERIA `grupo_id` NUNCA SUBIU (as tarefas de tela do plano de
-- 21/08 não foram feitas), então ninguém percebeu ainda. Medido hoje: os 14
-- canais ainda estão de acordo, porque ninguém trocou grupo nenhum desde a
-- migration. É sorte de calendário, não garantia — a primeira troca pela tela
-- parte os dois em silêncio.
--
-- Permissão que se perde em silêncio é a pior classe de defeito deste sistema,
-- e a spec de 21/08 nomeou exatamente este risco antes de ele existir:
--   "Alguém troca o grupo de 3 dos 8 canais. O balde se parte em dois. A
--    supervisora do Varejo perde 3 lojas — sem erro, sem aviso, e sem ninguém
--    ficar sabendo."
--
-- ESTA MIGRATION NÃO MUDA NENHUMA REGRA DE ACESSO. Ela só faz as duas colunas
-- que descrevem A MESMA COISA pararem de poder discordar, venha a escrita de
-- onde vier. Enquanto a tela nova não existe, a velha passa a gravar certo.
--
-- ⚠️ QUEM COPIAR ESTE GATILHO COPIA A DECISÃO DE PRECEDÊNCIA:
-- se a mesma linha mudar `grupo_id` E `grupo` no mesmo UPDATE, quem manda é o
-- `grupo_id`. Ele é o apontamento explícito — alguém escolheu uma linha, não
-- digitou um nome. Sem uma precedência declarada, o resultado dependeria da
-- ordem dos campos no `UPDATE`, que é o tipo de coisa que ninguém consegue
-- depurar seis meses depois.

create or replace function public.espelhar_grupo_do_canal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_texto text;
  v_id    uuid;
  v_nome  text;
begin
  -- ── SENTIDO 1: o apontamento manda no texto (o que já valia desde 21/08) ──
  if (tg_op = 'INSERT'  and new.grupo_id is not null)
  or (tg_op = 'UPDATE'  and new.grupo_id is distinct from old.grupo_id) then
    new.grupo := (select g.nome from public.canais_grupos g where g.id = new.grupo_id);
    return new;
  end if;

  -- ── SENTIDO 2: o texto passa a achar (ou criar) o apontamento ──
  if (tg_op = 'INSERT' and new.grupo is not null)
  or (tg_op = 'UPDATE' and new.grupo is distinct from old.grupo) then

    v_texto := nullif(btrim(coalesce(new.grupo, '')), '');

    -- Apagar o texto é dizer "este canal não tem grupo". O apontamento vai
    -- junto: deixá-lo para trás recriaria a divergência que isto veio fechar.
    if v_texto is null then
      new.grupo    := null;
      new.grupo_id := null;
      return new;
    end if;

    -- Mesma normalização do índice único (`canais_grupos_nome_unico`) e do
    -- `mesmoGrupo()` no JavaScript: "Varejo", "varejo" e "Varejo " são um só.
    select g.id, g.nome into v_id, v_nome
      from public.canais_grupos g
     where lower(btrim(g.nome)) = lower(v_texto)
     limit 1;

    -- Grupo que ainda não existe NASCE AQUI, e isso é de propósito: a tela no ar
    -- tem a opção "+ novo grupo…", que só sabe escrever texto. Recusar criaria
    -- um canal com texto e sem apontamento — de novo duas verdades. A decisão de
    -- 20/08 ("grupo novo é digitação na tela, não evento de engenharia")
    -- continua valendo; ela só passa a produzir a linha também.
    if v_id is null then
      insert into public.canais_grupos (nome)
      values (v_texto)
      on conflict do nothing
      returning id, nome into v_id, v_nome;

      -- `on conflict do nothing` não devolve linha quando outra transação
      -- ganhou a corrida. Ler de novo é o que evita gravar `grupo_id` nulo
      -- num canal cujo grupo existe.
      if v_id is null then
        select g.id, g.nome into v_id, v_nome
          from public.canais_grupos g
         where lower(btrim(g.nome)) = lower(v_texto)
         limit 1;
      end if;
    end if;

    new.grupo_id := v_id;
    -- O texto volta canônico: quem digitou "varejo" fica com "Varejo", igual ao
    -- que o outro sentido gravaria. Duas grafias do mesmo grupo na tela fazem
    -- quem lê achar que são dois.
    new.grupo := coalesce(v_nome, v_texto);
  end if;

  return new;
end;
$$;

-- O gatilho precisa escutar as DUAS colunas. Antes ele escutava só `grupo_id`,
-- que é exatamente por isso que a escrita da tela passava batido.
drop trigger if exists trg_espelhar_grupo_do_canal on public.bling_lojas;
create trigger trg_espelhar_grupo_do_canal
  before insert or update of grupo_id, grupo on public.bling_lojas
  for each row execute function public.espelhar_grupo_do_canal();

-- CONSERTAR O QUE JÁ ESTIVER TORTO. Hoje não há nada torto (medido: 14 de 14 de
-- acordo), mas esta migration precisa ser correta quando rodar num banco que
-- não é o de hoje — um clone, um restore, ou a produção daqui a um mês.
-- Só toca em linha que TEM texto e NÃO tem apontamento; canal sem grupo
-- nenhum continua sem grupo nenhum.
insert into public.canais_grupos (nome)
select distinct btrim(l.grupo)
  from public.bling_lojas l
 where l.grupo_id is null
   and nullif(btrim(coalesce(l.grupo, '')), '') is not null
   and not exists (
     select 1 from public.canais_grupos g
      where lower(btrim(g.nome)) = lower(btrim(l.grupo)))
on conflict do nothing;

update public.bling_lojas l
   set grupo_id = g.id,
       grupo    = g.nome
  from public.canais_grupos g
 where l.grupo_id is null
   and nullif(btrim(coalesce(l.grupo, '')), '') is not null
   and lower(btrim(g.nome)) = lower(btrim(l.grupo));

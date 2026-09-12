-- A VIGIA DOS ROBÔS PARA DE MENTIR
--
-- O QUE O DONO VIA (19/08/2026): abrindo o painel, o aviso vermelho no topo
-- dizia "⚠ Robô sem rodar direito — coletar-dados — Nunca funcionou desde que
-- passamos a medir." Era falso. Medido no mesmo minuto: o coletar-dados rodou
-- 32 vezes nas últimas 24 horas, com ZERO falhas, e o último sucesso tinha
-- meia hora.
--
-- A CAUSA, e ela tem duas metades.
--
-- 1) O `robos_execucoes.robo` guarda o nome COMPLETO da rodada, com horário e
--    perfil: 'coletar-dados-18h · Vessel'. A view de 31/07 casava o robô
--    esperado com esses nomes por prefixo (`like x.robo || '%'`), com a
--    intenção — escrita no comentário — de que "'coletar-dados' cobre as 4
--    rodadas". Só que o agrupamento acontecia ANTES do casamento: o CTE
--    agrupava por nome completo, e aí o LEFT JOIN casava o robô esperado com
--    cada um dos 33 grupos. Resultado: `robos_saude` devolvia 33 linhas de
--    'coletar-dados', não uma. A tela lê essa lista e mostra uma por uma.
--
-- 2) Uma dessas 33 era um FÓSSIL: 'coletar-dados-18h', sem o nome do perfil —
--    o formato antigo, de 31/07/2026, o dia em que a medição começou. Um único
--    disparo, que falhou, e nunca mais. Como aquele nome nunca teve um sucesso,
--    a regra dizia "nunca deu certo" — e essa linha, sozinha, virava o alarme.
--
-- Ou seja: o painel acusava um robô morto que na verdade era um NOME morto, e
-- o robô de verdade estava trabalhando o tempo todo, ali do lado, 32 vezes.
--
-- POR QUE ISSO É PIOR DO QUE UM AVISO ERRADO: a própria migration de 31/07 diz
-- que esta vigia existe porque o painel do cron mente ("succeeded" mesmo quando
-- a função devolve erro). Uma vigia que aponta problema onde não há ensina a
-- pessoa a ignorar o vermelho — e no dia em que o coletar-dados parar de
-- verdade, o token da Meta vence em silêncio e para tudo.
--
-- ── O CUIDADO QUE QUASE ME ESCAPOU ──────────────────────────────────────────
-- A correção óbvia (agrupar por robô esperado e pegar o max() de todos) apaga o
-- alarme falso e cria um silêncio novo: com 8 perfis rodando, bastaria UM deles
-- dar certo para o robô inteiro aparecer como "ok" — e um perfil que parasse de
-- coletar ficaria invisível para sempre.
--
-- Por isso a view passa a raciocinar por VARIANTE (cada perfil × horário), e:
--   • uma variante está VIVA se disparou nas últimas 72 horas. O nome de
--     formato antigo simplesmente se aposenta sozinho — sem ninguém precisar
--     apagar registro histórico, que é prova de uma falha que aconteceu mesmo;
--   • a situação do robô é a da PIOR variante viva. Um perfil parado acusa,
--     mesmo com os outros sete trabalhando;
--   • se NENHUMA variante deu sinal em 72h, o robô inteiro parou — aí vale o
--     histórico completo, e o ATRASADO aparece como antes;
--   • a coluna nova `quem_falhou` diz QUAIS perfis estão com problema, para a
--     tela poder escrever o nome em vez de acusar o robô inteiro.

create or replace view public.robos_saude as
with casadas as (
  -- cada disparo, já casado com o robô esperado que ele representa
  select x.robo as esperado, x.critico, x.horas_sem_sucesso_ate, x.porque,
         e.robo as variante, e.disparado_em, e.ok
    from public.robos_esperados x
    join public.robos_execucoes e on e.robo like x.robo || '%'
),
por_variante as (
  select esperado, variante, horas_sem_sucesso_ate,
         max(disparado_em) filter (where ok) as ultimo_sucesso,
         max(disparado_em)                   as ultimo_disparo,
         count(*) filter (where ok is false and disparado_em > now() - interval '24 hours') as falhas_24h,
         count(*) filter (where disparado_em > now() - interval '24 hours')                 as disparos_24h
    from casadas
   group by esperado, variante, horas_sem_sucesso_ate
),
resumo as (
  select
    esperado,
    count(*) filter (where ultimo_disparo > now() - interval '72 hours') as vivas,
    -- o pior sucesso ENTRE AS VIVAS: é ele que decide se o robô está em dia
    min(ultimo_sucesso) filter (where ultimo_disparo > now() - interval '72 hours') as sucesso_da_pior_viva,
    -- variante viva que nunca deu certo é caso à parte: não tem "último sucesso"
    -- para comparar, e some no min() acima se não for contada aqui
    count(*) filter (where ultimo_disparo > now() - interval '72 hours' and ultimo_sucesso is null) as vivas_sem_sucesso,
    -- o histórico inteiro, usado só quando não há nenhuma variante viva
    max(ultimo_sucesso) as sucesso_no_historico,
    max(ultimo_disparo) as disparo_no_historico,
    sum(falhas_24h)   as falhas_24h,
    sum(disparos_24h) as disparos_24h,
    array_agg(variante order by variante) filter (
      where ultimo_disparo > now() - interval '72 hours'
        and (ultimo_sucesso is null
             or ultimo_sucesso < now() - make_interval(hours => horas_sem_sucesso_ate))
    ) as quem_falhou
  from por_variante
  group by esperado
)
select
  x.robo,
  x.critico,
  -- o que a tela mostra como "a última vez que funcionou": com variantes vivas,
  -- é a da pior delas (a que está mais para trás); sem nenhuma viva, o histórico
  coalesce(r.sucesso_da_pior_viva, r.sucesso_no_historico) as ultimo_sucesso,
  r.disparo_no_historico as ultimo_disparo,
  -- o ::bigint não é enfeite: `count` devolve bigint e `sum` devolve numeric, e
  -- `create or replace view` recusa mudar o tipo de uma coluna que já existe
  coalesce(r.falhas_24h, 0)::bigint   as falhas_24h,
  coalesce(r.disparos_24h, 0)::bigint as disparos_24h,
  x.horas_sem_sucesso_ate,
  case
    when r.disparo_no_historico is null                       then 'sem registro ainda'
    -- nada deu sinal em 72h: o robô inteiro parou, vale o histórico
    when coalesce(r.vivas, 0) = 0 then
      case
        when r.sucesso_no_historico is null                                                     then 'nunca deu certo'
        when r.sucesso_no_historico < now() - make_interval(hours => x.horas_sem_sucesso_ate)   then 'ATRASADO'
        else 'ok'
      end
    when r.vivas_sem_sucesso > 0                                                                then 'nunca deu certo'
    when r.sucesso_da_pior_viva < now() - make_interval(hours => x.horas_sem_sucesso_ate)       then 'ATRASADO'
    else 'ok'
  end as situacao,
  x.porque,
  -- COLUNAS NOVAS ENTRAM NO FIM, sempre: `create or replace view` só aceita
  -- acrescentar depois da última, nunca no meio das que já existem.
  -- quais rodadas estão com problema (perfil × horário). Nulo = tudo em dia.
  r.quem_falhou,
  coalesce(r.vivas, 0)::bigint as variantes_vivas
from public.robos_esperados x
left join resumo r on r.esperado = x.robo
order by x.critico desc, x.robo;

comment on view public.robos_saude is
  'Situacao de cada robo, UMA linha por robo. ATRASADO = a pior rodada viva '
  '(perfil x horario) passou do tempo maximo sem um sucesso. Rodada que nao da '
  'sinal ha mais de 72h se aposenta: nome antigo nao vira alarme eterno.';

-- OBRIGATÓRIO, e o motivo está na migration de 31/07: sem isto a view roda com
-- a permissão do dono (postgres) e passa por cima do RLS das tabelas de baixo.
-- `create or replace view` NÃO preserva esta propriedade sozinho — conferir
-- depois de aplicar, não confiar.
alter view public.robos_saude set (security_invoker = true);

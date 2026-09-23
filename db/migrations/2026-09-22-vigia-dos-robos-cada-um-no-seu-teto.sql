-- O VIGIA DOS ROBÔS PARA DE MENTIR (DE NOVO): CADA VARIANTE NO SEU TETO
--
-- O QUE O DONO VIA (22/09/2026): o "Log de caroços" trazia, na aba Robôs, a
-- linha "olhar hoje · meta-hora · ATRASADO — parou em meta-hora-retentativa-00h
-- (teto de 4h)". Era falso. Medido no mesmo minuto: o `meta-hora` respondeu
-- 200 em TODAS as rodadas do dia, das 09h05 às 22h05, de hora em hora.
--
-- ── A CAUSA ─────────────────────────────────────────────────────────────────
--
-- `robos_saude` casa robô esperado com execução por PREFIXO
-- (`e.robo like x.robo || '%'`), e isso é de propósito: é assim que o robô
-- 'coletar-dados' cobre as rodadas 'coletar-dados-07h · Vessel' e companhia,
-- que não têm ficha própria em `robos_esperados`.
--
-- Só que em 21/09 a repescagem ganhou ficha PRÓPRIA — 'meta-hora-retentativa-00h',
-- com teto de 24h, justamente porque ela roda UMA VEZ POR DIA e o teto de 4h do
-- pai a condenava toda manhã. A ficha entrou, e não resolveu: o prefixo
-- 'meta-hora' continua casando com 'meta-hora-retentativa-00h', então a
-- repescagem passou a ser julgada DUAS VEZES — sob o próprio nome, com 24h
-- (onde aparece "ok"), e dentro do pai, com 4h (onde aparece "ATRASADO").
--
-- ⚠️ E O PAI USA O `min()` DO ÚLTIMO SUCESSO ENTRE AS VARIANTES VIVAS, de
-- propósito, para que um perfil parado não se esconda atrás de outro que rodou.
-- Com a repescagem dentro dele, esse `min()` é sempre o sucesso da meia-noite —
-- e depois das 4h30 da manhã, todo santo dia, o pai aparecia atrasado.
--
-- É a TERCEIRA vez que este vigia mente (31/07 e 19/08 foram as outras duas), e
-- as três pelo mesmo motivo de fundo: o casamento por prefixo é generoso demais
-- e engole o que não é dele. Alarme que sempre mente ensina a pessoa a ignorar
-- a aba — e no dia em que o robô parar de verdade, ninguém olha.
--
-- ── O CONSERTO ──────────────────────────────────────────────────────────────
--
-- Cada execução passa a ser atribuída a UM único robô esperado: o de prefixo
-- MAIS LONGO que a alcança. 'meta-hora-retentativa-00h' casa com os dois nomes,
-- o mais longo é o dela, e ela responde pelo teto de 24h da ficha dela. O
-- 'meta-hora' seco continua casando só com ele mesmo, e segue cobrado nas 4h.
--
-- ⚠️ POR QUE "MAIS LONGO" E NÃO "TEM FICHA PRÓPRIA": dão no mesmo hoje, mas o
-- mais longo continua valendo quando um dia existir ficha em três níveis. E,
-- principalmente, ele NÃO quebra o caso que o prefixo existe para servir:
-- 'coletar-dados-07h · Vessel' não tem ficha nenhuma, então o prefixo mais
-- longo que a alcança continua sendo 'coletar-dados', e nada muda ali.
--
-- ── A PROVA, FEITA ANTES DE APLICAR ─────────────────────────────────────────
--
-- Rodando a view nova como consulta, contra os dados reais, os 14 robôs:
--   • 13 ficam EXATAMENTE como estavam;
--   • 'meta-hora' sai de ATRASADO para ok — o alarme falso, e só ele.
--
-- E a prova por mutação, que é a que importa (view que só apaga alarme é view
-- cega), simulando execuções:
--   • 'meta-hora' sem sucesso há 6h  → ATRASADO  (o teto de 4h ainda morde)
--   • só a repescagem parada há 30h  → a REPESCAGEM vai a ATRASADO sozinha,
--                                       e o pai continua ok
-- Ou seja: o vigia deixou de mentir sem deixar de vigiar.

create or replace view public.robos_saude as
 WITH casadas AS (
         SELECT x_1.robo AS esperado,
            x_1.critico,
            x_1.horas_sem_sucesso_ate,
            x_1.porque,
            e.robo AS variante,
            e.disparado_em,
            e.ok
           FROM robos_esperados x_1
             JOIN robos_execucoes e ON e.robo ~~ (x_1.robo || '%'::text)
             -- ⚠️ A LINHA NOVA (22/09/2026): a execução pertence ao robô
             -- esperado de prefixo MAIS LONGO que a alcança, e só a ele.
             -- Sem isto, variante com ficha própria é julgada duas vezes: uma
             -- pelo teto dela e outra pelo teto do pai, e o pai sempre perde.
            AND x_1.robo = (SELECT o.robo FROM robos_esperados o
                             WHERE e.robo ~~ (o.robo || '%'::text)
                             ORDER BY length(o.robo) DESC
                             LIMIT 1)
        ), por_variante AS (
         SELECT casadas.esperado,
            casadas.variante,
            casadas.horas_sem_sucesso_ate,
            max(casadas.disparado_em) FILTER (WHERE casadas.ok) AS ultimo_sucesso,
            max(casadas.disparado_em) AS ultimo_disparo,
            count(*) FILTER (WHERE casadas.ok IS FALSE AND casadas.disparado_em > (now() - '24:00:00'::interval)) AS falhas_24h,
            count(*) FILTER (WHERE casadas.disparado_em > (now() - '24:00:00'::interval)) AS disparos_24h
           FROM casadas
          GROUP BY casadas.esperado, casadas.variante, casadas.horas_sem_sucesso_ate
        ), resumo AS (
         SELECT por_variante.esperado,
            count(*) FILTER (WHERE por_variante.ultimo_disparo > (now() - '72:00:00'::interval)) AS vivas,
            min(por_variante.ultimo_sucesso) FILTER (WHERE por_variante.ultimo_disparo > (now() - '72:00:00'::interval)) AS sucesso_da_pior_viva,
            count(*) FILTER (WHERE por_variante.ultimo_disparo > (now() - '72:00:00'::interval) AND por_variante.ultimo_sucesso IS NULL) AS vivas_sem_sucesso,
            max(por_variante.ultimo_sucesso) AS sucesso_no_historico,
            max(por_variante.ultimo_disparo) AS disparo_no_historico,
            sum(por_variante.falhas_24h) AS falhas_24h,
            sum(por_variante.disparos_24h) AS disparos_24h,
            array_agg(por_variante.variante ORDER BY por_variante.variante) FILTER (WHERE por_variante.ultimo_disparo > (now() - '72:00:00'::interval) AND (por_variante.ultimo_sucesso IS NULL OR por_variante.ultimo_sucesso < (now() - make_interval(hours => por_variante.horas_sem_sucesso_ate)))) AS quem_falhou
           FROM por_variante
          GROUP BY por_variante.esperado
        )
 SELECT x.robo,
    x.critico,
    COALESCE(r.sucesso_da_pior_viva, r.sucesso_no_historico) AS ultimo_sucesso,
    r.disparo_no_historico AS ultimo_disparo,
    COALESCE(r.falhas_24h, 0::numeric)::bigint AS falhas_24h,
    COALESCE(r.disparos_24h, 0::numeric)::bigint AS disparos_24h,
    x.horas_sem_sucesso_ate,
        CASE
            WHEN r.disparo_no_historico IS NULL THEN 'sem registro ainda'::text
            WHEN COALESCE(r.vivas, 0::bigint) = 0 THEN
            CASE
                WHEN r.sucesso_no_historico IS NULL THEN 'nunca deu certo'::text
                WHEN r.sucesso_no_historico < (now() - make_interval(hours => x.horas_sem_sucesso_ate)) THEN 'ATRASADO'::text
                ELSE 'ok'::text
            END
            WHEN r.vivas_sem_sucesso > 0 THEN 'nunca deu certo'::text
            WHEN r.sucesso_da_pior_viva < (now() - make_interval(hours => x.horas_sem_sucesso_ate)) THEN 'ATRASADO'::text
            ELSE 'ok'::text
        END AS situacao,
    x.porque,
    r.quem_falhou,
    COALESCE(r.vivas, 0::bigint) AS variantes_vivas
   FROM robos_esperados x
     LEFT JOIN resumo r ON r.esperado = x.robo
  ORDER BY x.critico DESC, x.robo;

comment on view public.robos_saude is
  'Saude dos robos, uma linha por robo esperado. Cada execucao pertence ao robo '
  'esperado de prefixo MAIS LONGO que a alcanca (22/09/2026) — sem isso, variante '
  'com ficha propria e julgada tambem pelo teto do pai e o pai mente todo dia.';

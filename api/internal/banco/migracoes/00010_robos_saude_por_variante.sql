-- +goose Up
-- robos_saude (07-2 da revisão de 10/2026): agrega por VARIANTE antes de casar com o robô esperado. A versão de
-- 2026-09-22 juntava cada ficha a todas as execuções por prefixo e só depois agrupava: com 130 mil execuções
-- levava 774 ms; agregando primeiro (uma passada por robos_execucoes) leva 23-28 ms. Mesma saída: colunas, tipos
-- e linhas idênticos (conferido com EXCEPT nos dois sentidos numa cópia de produção, e de novo em Go pelo teste
-- desta migration), por isso `create or replace` basta e o comment, as permissões e quem depende da view ficam.
--
-- A view e as tabelas vêm do dump do Supabase (DDL em db/migrations/2026-07-31 e 2026-09-22): num banco sem
-- elas (testes, instalação nova) a migration não faz nada, e por isso não cria nenhuma.
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_saude') is null or to_regclass('robos_esperados') is null or to_regclass('robos_execucoes') is null then
    return;
  end if;
  create or replace view robos_saude as
   with por_variante as (
     select x.robo as esperado, x.horas_sem_sucesso_ate, v.variante,
            v.ultimo_sucesso, v.ultimo_disparo, v.falhas_24h, v.disparos_24h
       from robos_esperados x
       join (
         select e.robo as variante,
                max(e.disparado_em) filter (where e.ok) as ultimo_sucesso,
                max(e.disparado_em) as ultimo_disparo,
                count(*) filter (where e.ok is false and e.disparado_em > now() - interval '24 hours') as falhas_24h,
                count(*) filter (where e.disparado_em > now() - interval '24 hours') as disparos_24h
           from robos_execucoes e group by e.robo
       ) v on v.variante like x.robo || '%'
        and x.robo = (select o.robo from robos_esperados o where v.variante like o.robo || '%' order by length(o.robo) desc limit 1)
   ), resumo as (
     select p.esperado,
            count(*) filter (where p.ultimo_disparo > now() - interval '72 hours') as vivas,
            min(p.ultimo_sucesso) filter (where p.ultimo_disparo > now() - interval '72 hours') as sucesso_da_pior_viva,
            count(*) filter (where p.ultimo_disparo > now() - interval '72 hours' and p.ultimo_sucesso is null) as vivas_sem_sucesso,
            max(p.ultimo_sucesso) as sucesso_no_historico,
            max(p.ultimo_disparo) as disparo_no_historico,
            sum(p.falhas_24h) as falhas_24h,
            sum(p.disparos_24h) as disparos_24h,
            array_agg(p.variante order by p.variante) filter (where p.ultimo_disparo > now() - interval '72 hours'
               and (p.ultimo_sucesso is null or p.ultimo_sucesso < now() - make_interval(hours => p.horas_sem_sucesso_ate))) as quem_falhou
       from por_variante p group by p.esperado
   )
   select x.robo, x.critico,
          coalesce(r.sucesso_da_pior_viva, r.sucesso_no_historico) as ultimo_sucesso,
          r.disparo_no_historico as ultimo_disparo,
          coalesce(r.falhas_24h, 0)::bigint as falhas_24h,
          coalesce(r.disparos_24h, 0)::bigint as disparos_24h,
          x.horas_sem_sucesso_ate,
          case when r.disparo_no_historico is null then 'sem registro ainda'
               when coalesce(r.vivas, 0) = 0 then case when r.sucesso_no_historico is null then 'nunca deu certo'
                    when r.sucesso_no_historico < now() - make_interval(hours => x.horas_sem_sucesso_ate) then 'ATRASADO' else 'ok' end
               when r.vivas_sem_sucesso > 0 then 'nunca deu certo'
               when r.sucesso_da_pior_viva < now() - make_interval(hours => x.horas_sem_sucesso_ate) then 'ATRASADO'
               else 'ok' end as situacao,
          x.porque, r.quem_falhou, coalesce(r.vivas, 0) as variantes_vivas
     from robos_esperados x left join resumo r on r.esperado = x.robo
    order by x.critico desc, x.robo;
end
$$;
-- +goose StatementEnd

-- +goose Down
-- Volta ao texto de 2026-09-22 (junta por prefixo e agrupa depois). Mesma guarda do Up.
-- +goose StatementBegin
do $$
begin
  if to_regclass('robos_saude') is null or to_regclass('robos_esperados') is null or to_regclass('robos_execucoes') is null then
    return;
  end if;
  create or replace view robos_saude as
   with casadas as (
     select x.robo as esperado, x.critico, x.horas_sem_sucesso_ate, x.porque,
            e.robo as variante, e.disparado_em, e.ok
       from robos_esperados x
       join robos_execucoes e on e.robo like x.robo || '%'
        and x.robo = (select o.robo from robos_esperados o where e.robo like o.robo || '%' order by length(o.robo) desc limit 1)
   ), por_variante as (
     select c.esperado, c.variante, c.horas_sem_sucesso_ate,
            max(c.disparado_em) filter (where c.ok) as ultimo_sucesso,
            max(c.disparado_em) as ultimo_disparo,
            count(*) filter (where c.ok is false and c.disparado_em > now() - interval '24 hours') as falhas_24h,
            count(*) filter (where c.disparado_em > now() - interval '24 hours') as disparos_24h
       from casadas c group by c.esperado, c.variante, c.horas_sem_sucesso_ate
   ), resumo as (
     select p.esperado,
            count(*) filter (where p.ultimo_disparo > now() - interval '72 hours') as vivas,
            min(p.ultimo_sucesso) filter (where p.ultimo_disparo > now() - interval '72 hours') as sucesso_da_pior_viva,
            count(*) filter (where p.ultimo_disparo > now() - interval '72 hours' and p.ultimo_sucesso is null) as vivas_sem_sucesso,
            max(p.ultimo_sucesso) as sucesso_no_historico,
            max(p.ultimo_disparo) as disparo_no_historico,
            sum(p.falhas_24h) as falhas_24h,
            sum(p.disparos_24h) as disparos_24h,
            array_agg(p.variante order by p.variante) filter (where p.ultimo_disparo > now() - interval '72 hours'
               and (p.ultimo_sucesso is null or p.ultimo_sucesso < now() - make_interval(hours => p.horas_sem_sucesso_ate))) as quem_falhou
       from por_variante p group by p.esperado
   )
   select x.robo, x.critico,
          coalesce(r.sucesso_da_pior_viva, r.sucesso_no_historico) as ultimo_sucesso,
          r.disparo_no_historico as ultimo_disparo,
          coalesce(r.falhas_24h, 0::numeric)::bigint as falhas_24h,
          coalesce(r.disparos_24h, 0::numeric)::bigint as disparos_24h,
          x.horas_sem_sucesso_ate,
          case when r.disparo_no_historico is null then 'sem registro ainda'
               when coalesce(r.vivas, 0::bigint) = 0 then case when r.sucesso_no_historico is null then 'nunca deu certo'
                    when r.sucesso_no_historico < now() - make_interval(hours => x.horas_sem_sucesso_ate) then 'ATRASADO' else 'ok' end
               when r.vivas_sem_sucesso > 0 then 'nunca deu certo'
               when r.sucesso_da_pior_viva < now() - make_interval(hours => x.horas_sem_sucesso_ate) then 'ATRASADO'
               else 'ok' end as situacao,
          x.porque, r.quem_falhou, coalesce(r.vivas, 0::bigint) as variantes_vivas
     from robos_esperados x left join resumo r on r.esperado = x.robo
    order by x.critico desc, x.robo;
end
$$;
-- +goose StatementEnd

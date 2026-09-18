-- O CERTIFICADO DE VERDADE PASSA A MOSTRAR O NOME COMPLETO DA DONA
--
-- Decisão do dono, 18/09/2026: o certificado real (vesselbrasil.com.br/verify,
-- 157 etiquetas vendidas) mostra o NOME COMPLETO da dona, sem abreviar — como
-- a página de teste /verify/novo já faz.
--
-- Até aqui `dono_nome` só vinha em peça de LOTE DE TESTE
-- (2026-09-18-vessel-verificar-nome-completo-no-teste.sql). Para peça de
-- verdade vinha nulo, e a página caía no nome curto ("Breno V.").
--
-- O QUE MUDA — SÓ ISTO: `dono_nome` passa a vir sempre que `dono_curto` vem,
-- pelo MESMO portão. O portão do nome curto é um só: a peça estar registrada
-- e o nome registrado não estar em branco (`vessel_nome_curto` devolve nulo
-- para nome vazio). Não existe outra trava sobre o nome: `pode_revelar` é só
-- um aviso para a página ("registrada = sim") e nunca escondeu o `dono_curto`.
-- Por isso a condição abaixo é literalmente "o nome curto existe?".
--
-- O QUE NÃO MUDA: nenhuma outra chave, nenhuma gravação (o insert em
-- `vessel_leituras` é o mesmo), a assinatura, o `security definer`. As
-- permissões ficam como estão — `create or replace` não mexe nelas (conferido
-- no banco em 18/09/2026: anon, authenticated, service_role e postgres com
-- EXECUTE). Nada de grant/revoke aqui, de propósito.
--
-- ⚠️ O QUE ISSO ABRE: qualquer pessoa com o código de uma etiqueta (o código
-- que o celular lê no NFC) passa a ver o nome completo da dona, pela chave
-- anônima que está no HTML público de /verify. Foi decidido assim pelo dono.
--
-- ⚠️ O NOME TEM "zzz-" DE PROPÓSITO: 2026-09-18-zz-vessel-garantia-pelo-
-- material.sql também redefine `vessel_verificar`. Em ordem alfabética "zz-"
-- vem antes de "zzz-" (o hífen é menor que a letra), então este arquivo roda
-- DEPOIS e não é apagado por ela.
--
-- Definição de partida: a que estava NO BANCO em 18/09/2026, lida com
-- pg_get_functiondef — igual à da migration zz-garantia-pelo-material.

create or replace function public.vessel_verificar(p_codigo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_peca   record;
  v_reg    record;
  v_cab    json := nullif(current_setting('request.headers', true), '')::json;
begin
  select p.codigo, p.numero_na_serie, l.modelo, l.cor, l.sku, l.quantidade,
         l.fabricado_em, l.fotos, l.teste, l.material
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
    'teste', coalesce(v_peca.teste, false),
    'registrada', v_reg.codigo is not null,
    'dono_curto', public.vessel_nome_curto(v_reg.nome),
    -- Nome completo para TODA peça, pelo mesmo portão do nome curto (decisão
    -- do dono, 18/09/2026 — ver o cabeçalho deste arquivo).
    'dono_nome', case when public.vessel_nome_curto(v_reg.nome) is not null then v_reg.nome else null end,
    'pode_revelar', v_reg.codigo is not null,
    'registrada_em', v_reg.registrado_em,
    'garantia_ate', v_reg.garantia_ate,
    -- Regra de 18/09/2026. Nulo quando o lote ainda não tem material.
    'material', v_peca.material,
    'garantia_meses', public.vessel_meses_de_garantia(v_peca.material)
  );
end;
$$;

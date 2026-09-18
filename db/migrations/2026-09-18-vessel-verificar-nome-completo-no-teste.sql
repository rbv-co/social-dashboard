-- Pedido do dono (17/09/2026): mostrar o nome completo da dona na peça, sem
-- abreviar. Hoje a pagina usa `dados.dono_curto`, porque vessel_verificar so
-- devolvia o nome abreviado ("Breno V.", via vessel_nome_curto).
--
-- DECISAO SOBRE O ALCANCE (do dono, registrada aqui): o nome completo passa a
-- sair SO para peca de LOTE DE TESTE (vessel_lotes.teste = true). Para peca
-- de verdade, vessel_verificar continua devolvendo so o curto — senao os
-- nomes completos das clientes das 157 bolsas ja vendidas ficariam
-- consultaveis pela chave anonima que esta no HTML publico de /verify,
-- antes mesmo de o layout novo ir para o certificado real (isso e Fase 2,
-- ainda nao decidida/feita).
--
-- O CONSERTO: acrescenta a chave `dono_nome` no json de retorno — o nome
-- completo (v_reg.nome) quando a peca e de lote de teste, e null quando nao
-- e. `dono_curto` continua exatamente como estava, para toda peca; a pagina
-- e quem decide usar `dono_nome || dono_curto`. Nenhuma chave existente
-- muda, nenhuma gravacao muda (o insert em vessel_leituras continua
-- identico).
--
-- FASE 2 (nao feita aqui): quando o layout novo for para o certificado real
-- das 157 bolsas, decidir se/como o nome completo tambem aparece la — com a
-- mesma cautela sobre a chave anonima no HTML publico.
--
-- Definicao ATUAL extraida da migration 2026-09-18-vessel-verificar-diz-se-
-- e-teste.sql (a mais recente aplicada antes deste ajuste). Muda so isso.

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
         l.fabricado_em, l.fotos, l.teste
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
    -- Nome completo SO em peca de lote de teste (vessel_lotes.teste) — ver
    -- decisao de alcance no cabecalho desta migration. Peca de verdade
    -- continua vindo com dono_nome = null, e a pagina cai para dono_curto.
    'dono_nome', case when coalesce(v_peca.teste, false) then v_reg.nome else null end,
    'pode_revelar', v_reg.codigo is not null,
    'registrada_em', v_reg.registrado_em,
    'garantia_ate', v_reg.garantia_ate
  );
end;
$$;

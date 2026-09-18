-- A pagina /verify/novo decide se mostra o botao "Register your Vessel" pela
-- funcao ehPecaDeTeste(sku), que so reconhece SKU comecando com "TESTE-". O
-- lote de teste real usa o SKU verdadeiro SS1088-Mostarda (decisao para o
-- casamento com a compra do dono no Bling funcionar) e e marcado como teste
-- NO BANCO (vessel_lotes.teste = true, coluna de 2026-09-17-vessel-lote-de-
-- teste.sql). Resultado: a pagina nunca reconhece a peca como teste, o botao
-- nasce hidden e nunca aparece.
--
-- O CONSERTO: quem sabe se a peca e de teste e o BANCO, nao o nome do SKU.
-- vessel_verificar (a mesma consulta publica usada pelas 157 etiquetas) passa
-- a devolver tambem 'teste', lido de vessel_lotes.teste. Nao muda nenhuma
-- chave existente, nenhuma gravacao (o insert em vessel_leituras continua
-- identico) e nenhum outro comportamento — so acrescenta o campo novo no
-- json de retorno. Peca fora do lote de teste continua vindo com
-- 'teste' = false, porque teste e not null default false.
--
-- Definicao ATUAL extraida do banco em
-- .superpowers/sdd/2026-09-17-registered-pieces-contas-fase-1/vessel-verificar-no-ar.sql
-- antes deste ajuste.

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
    'pode_revelar', v_reg.codigo is not null,
    'registrada_em', v_reg.registrado_em,
    'garantia_ate', v_reg.garantia_ate
  );
end;
$$;

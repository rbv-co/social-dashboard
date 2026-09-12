-- CORREÇÃO (code review, 12/09/2026): duas falhas de validação em
-- `vessel_marcar_objetivo`, achadas junto porque são a mesma função.
--
-- 1) `p_objetivo not in ('visita', 'ecommerce')` dá NULL (nem verdadeiro nem
--    falso) quando `p_objetivo` é NULL — o `if` simplesmente pula. Chamar a
--    função com objetivo nulo passava direto pelo guard, gravava a linha com
--    objetivo/loja nulos, QUEIMAVA a senha de uso único (`senha_hash = null`)
--    e ainda respondia `ok:true` — a escolha da pessoa se perdia e a senha não
--    podia ser tentada de novo.
--
-- 2) `p_loja` nunca era validado contra o domínio documentado (`tivoli` |
--    `iguatemi`, comentário original da coluna) — só `p_objetivo` tinha
--    trava. Mesmo espírito da trava de objetivo: sem CHECK na coluna (CHECK
--    derruba a transação inteira), a regra mora na função.
create or replace function public.vessel_marcar_objetivo(
  p_senha    text,
  p_objetivo text,
  p_loja     text default null
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_hash text := encode(extensions.digest(coalesce(p_senha, ''), 'sha256'), 'hex');
  v_loja text;
  v_id   bigint;
begin
  -- ⚠️ A TRAVA MORA AQUI, e não num CHECK da coluna. CHECK derruba a transação
  -- inteira quando chega um valor novo; aqui o valor novo é uma linha a mais.
  -- `is null` explícito: sem ele, `not in` com NULL nunca é verdadeiro e o
  -- guard é pulado (achado de code review, 12/09/2026).
  if p_objetivo is null or p_objetivo not in ('visita', 'ecommerce') then
    return json_build_object('ok', false, 'situacao', 'objetivo_invalido');
  end if;

  -- Mesma trava, mesmo motivo, agora pra loja — só importa quando o
  -- objetivo é visita (ecommerce sempre grava loja nula, ver o UPDATE).
  v_loja := coalesce(nullif(trim(p_loja), ''), 'iguatemi');
  if p_objetivo = 'visita' and v_loja not in ('tivoli', 'iguatemi') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;

  -- A senha vale por 2 horas. Sem prazo, uma senha vazada abriria a linha para
  -- sempre; com prazo, a janela é a da própria visita à página.
  update public.vessel_lista_espera
     set objetivo   = p_objetivo,
         loja       = case when p_objetivo = 'visita' then v_loja else null end,
         -- USO ÚNICO: some assim que usada.
         senha_hash = null,
         -- O espelho precisa rodar de novo para levar o objetivo adiante.
         planilha_em = null
   where senha_hash = v_hash
     and senha_em > now() - interval '2 hours'
  returning id into v_id;

  -- ⚠️ UPDATE QUE NÃO ACHA LINHA NÃO DÁ ERRO: devolve zero linhas, calado. Sem
  -- esta checagem, senha errada ou vencida responderia "deu certo".
  if v_id is null then
    return json_build_object('ok', false, 'situacao', 'senha_invalida');
  end if;

  return json_build_object('ok', true, 'situacao', 'registrado');
end;
$function$;

-- `create or replace` preserva o revoke/grant já feitos na migration original
-- (2026-09-11-vessel-lista-objetivo-e-loja.sql) — mesma assinatura
-- (text, text, text), nada a refazer aqui.

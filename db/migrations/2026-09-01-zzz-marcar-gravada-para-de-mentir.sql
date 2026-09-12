-- `vessel_marcar_gravada` DIZIA SUCESSO SEM OLHAR SE MUDOU ALGUMA LINHA.
--
-- ⚠️ `zzz` para rodar depois da `zz` do mesmo dia (o runner é alfabético).
--
-- O corpo era:
--     update public.vessel_pecas set gravada_em = now()
--      where codigo = ... and gravada_em is null;
--     return json_build_object('ok', true);
--
-- Nenhum `get diagnostics`, nenhum `found`. Peça que não existe, peça já
-- gravada, ou linha barrada pela trava: TODAS respondiam igual ao sucesso.
--
-- POR QUE ISSO É GRAVE NUMA GRAVAÇÃO EM SÉRIE: a tela avança, a etiqueta ficou
-- gravada e o sistema não registrou. As duas peças são idênticas por fora —
-- ninguém separa depois qual foi. É a cicatriz que este projeto já tem escrita
-- em `feedback_update_sem_erro_zero_linhas`, agora dentro do selo.
--
-- Achado em 01/09/2026 pelo motor do gravador de mesa, que se protegeu lendo a
-- peça de volta antes de confirmar. O painel continuava acreditando no `ok`.
--
-- AS TRÊS RESPOSTAS, e a do meio é a que exige cuidado:
--   ok:true                      → marcou agora (uma linha mudou)
--   ok:true,  ja_estava:true     → já estava gravada. NÃO é erro: marcar duas
--                                  vezes a mesma peça é o que acontece quando
--                                  a pessoa toca de novo por dúvida, e falhar
--                                  aí ensinaria a ignorar o aviso.
--   ok:false, motivo:'peca_nao_existe' → o código não existe. ISTO é erro, e
--                                  era exatamente o que se escondia: código
--                                  errado marcado como gravado, em silêncio.
create or replace function public.vessel_marcar_gravada(p_codigo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_existe boolean;
  v_mudou  int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select exists(select 1 from public.vessel_pecas where codigo = v_codigo) into v_existe;
  if not v_existe then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;

  update public.vessel_pecas
     set gravada_em = now()
   where codigo = v_codigo and gravada_em is null;
  get diagnostics v_mudou = row_count;

  -- Zero linhas COM a peça existindo só pode ser uma coisa: ela já estava
  -- gravada. Não se inventa erro para isso.
  return json_build_object('ok', true, 'ja_estava', v_mudou = 0);
end;
$$;

-- As DUAS travas, como toda função desta base. `revoke ... from public, anon`
-- não tira a concessão que o Postgres dá por default a `authenticated`.
revoke all on function public.vessel_marcar_gravada(text) from public, anon, authenticated;
grant execute on function public.vessel_marcar_gravada(text) to authenticated;

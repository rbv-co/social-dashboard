-- IMEI / Nº de série do bem. Pedido do dono em 13/08/2026: "um campo de
-- IMEI/Serial ID para melhor identificar o dispositivo".
--
-- UM CAMPO SÓ para os dois números, decidido com ele: celular tem IMEI, notebook
-- tem número de série, e a maioria dos 349 bens (cadeira, mesa, TV) não tem
-- nenhum dos dois. Dois campos deixariam um sempre vazio.
--
-- SEM unique: o mesmo aparelho pode ser recadastrado por engano e uma trava dura
-- impediria a correção; e serial de fabricante repete entre fabricantes
-- diferentes. Quem confere é a pessoa, olhando a busca.
alter table public.patrimonio_bens
  add column if not exists numero_serie text;

comment on column public.patrimonio_bens.numero_serie is
  'IMEI (celular) ou número de série (notebook, TV). Nulo = não informado.';

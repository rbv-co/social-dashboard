-- O "É VOCÊ? VER O NOME COMPLETO" SAIU DA PÁGINA em 05/09/2026, a pedido do dono.
--
-- Tirar o botão não bastava: `vessel_revelar_dono` continuava concedida a `anon`,
-- e ela devolve o NOME INTEIRO de uma cliente para quem acertar o CPF ou o
-- WhatsApp dela. Sem tela nenhuma chamando, a função virava porta sem maçaneta
-- do lado de fora — mas aberta para quem soubesse o endereço.
--
-- ⚠️ A FUNÇÃO NÃO É APAGADA, de propósito: se o dono quiser o recurso de volta,
-- é uma linha de `grant`, e não reescrever a regra (que tem limite de tentativas
-- e a conferência por CPF/WhatsApp). Apagar seria jogar fora o trabalho.
revoke execute on function public.vessel_revelar_dono(text, text) from anon;
revoke execute on function public.vessel_revelar_dono(text, text) from authenticated;

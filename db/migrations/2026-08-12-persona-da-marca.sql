-- A PERSONA DA MARCA passa a morar no sistema, por conta de anúncios
--
-- POR QUÊ (pedido do dono, 12/08/2026): "trazer persona da marca na IA, para
-- sugerir otimização de público que faça sentido, hoje vc sugere idades que não
-- casam com a marca".
--
-- A causa é direta e foi medida no prompt: `sugerir-publico-ia` recebia da tela
-- apenas `marca: <nome da conta>` e escrevia no pedido uma única linha, "A marca
-- é: Vessel". O modelo não tinha como saber para quem a marca vende, então a
-- faixa de idade saía do que os números da conta sugerem — e número de conta diz
-- quem CLICOU, não para quem a marca quer vender.
--
-- POR QUE EM `accounts` E NÃO EM `fabrica_marcas`: a sugestão de público roda no
-- Gestor de Tráfego, que trabalha com as 5 contas de anúncios. `fabrica_marcas`
-- tem UMA linha (La Vessel) e serve à Fábrica. Guardar ali deixaria 4 contas de
-- fora justamente na tela que usa o dado.
--
-- POR QUE NÃO LER DO ZOHO: a persona hoje vive num documento na pasta do Vessel
-- no WorkDrive. Amarrar o prompt a um arquivo de nuvem faz a sugestão depender de
-- um caminho que ninguém versiona e que quebra em silêncio quando alguém renomeia
-- a pasta. Aqui ela é editável na tela, por conta, e a IA lê do banco.

alter table public.accounts
  add column if not exists persona text;

comment on column public.accounts.persona is
  'Quem a marca atende, nas palavras do dono: publico, faixa etaria real, o que essa pessoa procura e o que NAO combina. Entra no pedido da IA de sugestao de publico como verdade sobre a marca -- tem precedencia sobre o que os numeros da conta sugerem.';

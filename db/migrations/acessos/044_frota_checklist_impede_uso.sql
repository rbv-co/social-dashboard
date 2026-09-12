-- O resultado do checklist deixa de ser escolhido a dedo, e passa a sair dos
-- itens conferidos.
--
-- O PEDIDO DO DONO (12/08/2026): "no checklist tem a seção de resultado, essa
-- não pode ser editável pelo motorista, precisa ser automático e ser a resposta
-- de acordo com o checklist — exemplo: tem vazamento, ou pneu com problema,
-- qualquer coisa que impossibilite o uso, mostre 'com ressalvas', ou 'não
-- liberado' caso for algo urgente."
--
-- ISTO DERRUBA A D14, que dizia: "a palavra final continua sendo dela;
-- `resultadoEscolhido` vence assim que ela toca". A regra caiu porque ela
-- permitia o pior desfecho possível: quem confere marcar LIBERADO com vazamento
-- embaixo do carro — e a ficha assinada registraria isso como verdade. Numa
-- ferramenta cujo histórico serve pra responder por multa e por acidente, deixar
-- o resultado na mão de quem tem pressa é deixar a prova na mão de quem ela
-- protege.
--
-- ESTA COLUNA é o que separa "com ressalvas" de "não liberado". Ela é do DONO,
-- não do código: por isso mora em tabela e é editável na aba Plano, no mesmo
-- lugar onde ele já mantém a lista do checklist e os limiares de revisão.
alter table public.frota_checklist_itens
  add column if not exists impede_uso boolean not null default false;

comment on column public.frota_checklist_itens.impede_uso is
  'Item que, marcado como problema, deixa o carro NÃO LIBERADO. Falso = com ressalvas.';

-- OS QUATRO ESCOLHIDOS PELO DONO, entre três listas apresentadas: os que
-- impedem o carro de rodar ou de parar.
--
-- O QUE FICOU DE FORA e ele decidiu ciente: faróis e luzes de freio queimados
-- são perigo real à noite, e ficam como simples ressalva. Está registrado aqui
-- pra ninguém "corrigir" isso caladamente — se mudar, muda por decisão dele, na
-- tela.
update public.frota_checklist_itens set impede_uso = true
 where item in (
   'Vazamentos sob o veículo',
   'Estado geral dos pneus',
   'Freio de estacionamento',
   'Nível do fluido de freio'
 );

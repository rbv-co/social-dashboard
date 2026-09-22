# Frota — Abastecimento

Complemento dos desenhos de 2026-08-04 (`2026-08-04-frota-design.md`) e
2026-08-05 (checklist do motorista), que continuam valendo. Este documento cobre
o **registro de abastecimento pelo motorista** e o que ele destrava.

Pedido do dono, 21/09/2026, verbatim:

> "adicione um botão para o motorista, uma freature nova de abastecimento onde
> ele colocar quanto colocou, se o tanque ficou cheio, 3/4, 1/2, 1/4, com qts km
> abasteceu, e ai vc vai sincronizando tudo os dados ok?"

## De onde veio

**A medição de 21/09/2026, antes de escrever qualquer linha:**

| O que eu medi | Quanto |
|---|---|
| Registros de abastecimento na central | **nenhum — a tabela não existe** |
| Viagens registradas (`frota_uso`) | 25 |
| Delas, com o nível do tanque informado | **7** |
| Fichas de checklist | 44 |
| Revisões lançadas | 99 |
| Carros ativos | 12 |

Hoje o tanque só é perguntado **na devolução**, e 18 das 25 viagens voltaram sem
resposta. Litro e dinheiro não existem em lugar nenhum da Frota.

**O que isso mantém parado.** A **F5 — custo por quilômetro rodado** está na fila
desde 2026-08-04 e nunca saiu, sempre pelo mesmo motivo: não há de onde tirar o
custo. Quilometragem a Frota já tem de quatro fontes diferentes; o que falta é o
outro lado da conta. O abastecimento é esse lado.

## Decisões

### D35 — Dois números, não um: reais E litros

O cupom da bomba traz os dois, e cada um responde uma pergunta diferente:

- **reais** → quanto o carro custa por km rodado, e o gasto do mês;
- **litros** → quantos km o carro faz por litro, e **quando ele começa a beber
  mais que ele mesmo**, que é como aparece defeito mecânico e desvio de
  combustível.

Escolha do dono com as três opções na mão (só R$, só litros, os dois). Um campo a
mais na bomba, e a tela paga isso de volta na hora: assim que os dois estão
preenchidos ela mostra **"R$ 6,05 o litro"**, que é o número que a pessoa confere
contra o cupom antes de salvar. Erro de digitação aparece ali, não no relatório
três semanas depois.

### D36 — O consumo se mede de um tanque CHEIO ao próximo tanque CHEIO

É por isso que perguntar o nível não é detalhe de tela, é o que faz a conta
existir. Quem coloca R$ 100 no meio da semana não sabe quanto tinha no tanque
antes nem depois — e dividir km por litros aí dá um número errado com cara de
certo.

**A regra:** só entram na conta de consumo os trechos que **começam e terminam em
"ficou cheio"**. Entre dois cheios, todos os litros colocados no meio somam, e a
distância é a diferença de quilometragem. Abastecimento parcial **não é
descartado** — ele conta no dinheiro, no histórico e no tanque atual; só não
fecha um trecho de consumo sozinho.

**Consequência dita na tela:** enquanto não houver dois "cheio" no mesmo carro, o
app responde *"ainda não dá para calcular o consumo deste carro"* — e não um
número chutado. Vale a regra da casa: campo sem resposta mostra travessão, nunca
um zero.

Os níveis são os **cinco que a Frota já usa** (`NIVEIS_TANQUE`): Reserva · 1/4 ·
2/4 · 3/4 · Cheio. O dono citou quatro; usar a escala que já existe evita duas
escalas para a mesma coisa na mesma ferramenta — e "Reserva depois de abastecer"
é raro, mas acontece com quem põe R$ 20 para chegar no posto certo.

### D37 — Qual combustível entrou, com o do carro já preenchido

Um KWID flex abastecido com etanol numa vez e gasolina na outra **parece um carro
que piorou 30%**. Sem esta coluna, o alerta de "está bebendo mais" viraria alarme
falso na primeira troca — e alarme falso ensina a ignorar o alerta de verdade.

Vem preenchido com o `combustivel` do próprio veículo; só quem troca precisa
tocar no campo. **O consumo se compara sempre dentro do mesmo combustível.**

### D38 — Abre no carro que está com a pessoa

Mesmo molde do checklist (D21b): o botão já abre no carro que ela tem na mão —
dono fixo, viagem aberta ou reserva aprovada, na mesma ordem de precedência que
`veiculosParaConferir` já usa. Quem administra a Frota escolhe qualquer carro da
lista, para lançar o cupom de quem não usa o app.

⚠️ **Dito por escrito, porque é consequência aceita:** a RLS das irmãs
(`frota_checklist`, `frota_manutencoes`) libera ler e escrever para qualquer um
com a permissão `frota` — não por carro. A tabela nova segue o mesmo padrão, e
portanto **a restrição "só no meu carro" é da tela, não do banco.** Quem souber
mexer no navegador consegue lançar no carro de outro. Isso já vale para o
checklist desde agosto; o que esta linha faz é não deixar ninguém achar que há
uma tranca onde não há.

### D39 — Número que não fecha AVISA; só um barra

Mesmo molde de `problemasDaDevolucao`, que já existe e é testado:

| Situação | O que acontece |
|---|---|
| Quilometragem **menor** que a maior já conhecida do carro | **barra** — é dedo errado, e o odômetro só anda para frente |
| Sem quilometragem, sem litros, sem valor ou sem nível | **barra** — são os quatro que fazem o registro valer alguma coisa |
| Litros **acima do tanque do carro** | avisa, deixa salvar |
| Preço por litro fora do pé (menos de R$ 1 ou mais de R$ 15) | avisa, deixa salvar |
| Consumo do trecho fora do pé (menos de 3 ou mais de 30 km/l) | avisa, deixa salvar |

Avisar e deixar salvar é decisão velha da casa: um sistema que recusa o registro
do que aconteceu de verdade ensina a pessoa a não registrar. Os pés são frouxos
de propósito — eles pegam o dedo errado (R$ 6.500 em vez de R$ 65), não a
variação normal.

### D40 — O que se sincroniza, e por quê

O dono pediu "vai sincronizando tudo os dados". São três costuras, todas para
dentro do que já existe — **nenhuma tela nova além do próprio abastecimento**:

1. **A quinta fonte de quilometragem.** `estadoDoVeiculo` já escolhe o MAIOR km
   entre quatro fontes (última devolução, saída de quem está na rua, hodômetro do
   checklist, km da manutenção). O abastecimento entra como a quinta, pela mesma
   regra do maior. Efeito colateral bom e de graça: **as revisões por km ficam
   certas sozinhas** — quem abastece toda semana passa a alimentar o alerta de
   troca de óleo sem digitar nada em lugar nenhum.
2. **O nível do tanque atual.** Hoje sai do último uso, e 18 de 25 vêm vazios.
   Passa a sair do registro **mais recente entre os dois** — abastecimento ou
   devolução. Quem abasteceu hoje sabe mais sobre o tanque do que quem devolveu
   na semana passada.
3. **O custo por km (F5) deixa de estar bloqueado.** Não entra nesta entrega —
   entra a fonte de dados dela. Dito aqui para ninguém achar que a F5 saiu junto.

## O que fica de fora, e por quê

- **Foto do cupom.** Pedido do dono: *"quero funcional, não carregado"*. É peso,
  armazenamento e um passo a mais na bomba. Se um dia precisar de comprovante,
  entra depois — a coluna de observação segura o número da nota enquanto isso.
- **Aviso automático (push).** Nenhuma chave nova de notificação. O quadro da
  Gestão mostra o que falta, como já faz com o checklist.
- **Relatório de custo por km (F5).** Ver D40, item 3.
- **Preço médio do posto, comparação entre postos.** Ninguém pediu.

## O banco

Tabela nova `frota_abastecimentos`, no molde das irmãs:

| Coluna | Tipo | Por quê |
|---|---|---|
| `id` | uuid pk | |
| `veiculo_id` | uuid → `frota_veiculos` | |
| `pessoa_id` | uuid → `acessos_pessoas`, nulo | quem abasteceu; SET NULL como nas irmãs |
| `pessoa_nome` | text | o nome fica mesmo se a pessoa sair — igual `frota_uso` |
| `abastecido_em` | timestamptz, not null | |
| `km` | int, not null | a quinta fonte de quilometragem |
| `litros` | numeric(7,3), not null | a bomba dá três casas |
| `total_centavos` | int, not null | dinheiro em centavos, como no resto da central |
| `tanque_depois` | smallint 0..4, not null | a escala da casa (0 = Reserva, 4 = Cheio) |
| `combustivel` | text, not null | D37 |
| `posto` | text, nulo | opcional |
| `observacao` | text, nulo | |
| `criado_em` / `criado_por` | timestamptz / uuid | igual às irmãs |

**Travas no banco, não só na tela:** `km > 0`, `litros > 0`, `total_centavos > 0`,
`tanque_depois between 0 and 4`. RLS `is_frota_admin()` para ler e escrever, igual
a `frota_checklist` e `frota_manutencoes` — conferido contra as duas antes de
escrever.

Índice por `(veiculo_id, abastecido_em desc)`: toda leitura desta tabela é "os
abastecimentos deste carro, do mais novo para o mais velho".

## O código

**Lógica pura, em arquivo próprio e testado** (`src/ferramentas/frota/abastecimentos.js`):

- `precoPorLitro(totalCentavos, litros)` — o número que a tela mostra na hora;
- `problemasDoAbastecimento({...})` — D39, devolve `{ barra: [], avisa: [] }`;
- `trechosDeConsumo(abastecimentos)` — os pares cheio→cheio, com km rodados,
  litros e km/l de cada um;
- `consumoDoVeiculo(abastecimentos)` — o km/l mais recente e a média, **por
  combustível**, ou nulo quando ainda não há dois cheios;
- `ultimoKmDeAbastecimento(abastecimentos, veiculoId)` — a quinta fonte, no molde
  exato de `ultimoKmDeRevisao`;
- `tanqueMaisRecente(abastecimentos, usos, veiculoId)` — D40 item 2.

**O que muda no que já existe:**

- `estado-do-veiculo.js`: `estadoDoVeiculo` passa a receber os abastecimentos
  como quinto argumento **opcional** — mesmo molde do `revisoes` opcional que já
  está lá, pela mesma razão (a Edge não tem a lista à mão);
- `botoes-rapidos.js`: o botão novo do motorista, com o estado embaixo;
- `tela-de-frota.vue`: o cartão do abastecimento na aba Motorista e o histórico
  na ficha do veículo.

## Como se prova

1. **Testes da lógica pura** — os seis pontos acima, com o caso real da frota: um
   carro com dois cheios e um parcial no meio, e um carro com um cheio só (que
   tem de responder "ainda não dá para calcular").
2. **A trava do banco, medida contra o banco**, dentro de transação desfeita:
   `km` negativo, `tanque_depois = 9` e `litros = 0` têm de ser recusados pelo
   próprio Postgres, não só pela tela.
3. **Prova de tela** no laboratório de fotos, a 375px e 1440px, claro e escuro,
   com as respostas do banco trocadas dentro do navegador: o botão, o formulário,
   o "R$ 6,05 o litro" aparecendo, e a mensagem de quando não dá para calcular o
   consumo.
4. **Nada é publicado antes de o dono ver a foto** — regra dele, de hoje.

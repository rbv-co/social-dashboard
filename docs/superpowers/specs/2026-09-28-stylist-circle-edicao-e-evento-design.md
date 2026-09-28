# Stylist Circle — a Edição passa a SER o evento

Data: 28/09/2026 · Aprovado em conversa pelo dono (brainstorm, caminho A)
Substitui, na parte de edição, o desenho de `2026-09-25-comercial-vessel-praca-e-edicao-design.md`.

## Por que

O dono achou vago o que é "edição": a de 25/09 era uma rodada da praça com
janela de datas, a abertura puxava a praça inteira (30 stylists, 20 nunca
contatadas) e a tela do Private Edit rotulava encontros pela DATA enquanto o
placar (PR #270) contava pela TURMA — as duas telas se contradiziam.

## O que o dono decidiu (palavras dele resumidas nas respostas do brainstorm)

1. O placar de uma edição responde primeiro: **"o evento deu certo?"**.
2. A base é o **funil do evento**: convidadas → confirmaram → presentes →
   agendaram → fizeram → repetiram; a meta do Growth Plan (≥50% das
   presentes com Private Edit agendado) é sobre as PRESENTES.
3. O placar **nunca fecha**: todo Private Edit futuro das stylists do evento
   continua somando.
4. Stylist em dois eventos: os Private Edits dela contam **no evento em que
   ela esteve presente pela 1ª vez** — nada conta duas vezes.
5. Caminho A: a edição É o evento (não uma camada de rodada + eventos).
6. **Indisponível na data** (pedido do dono, 28/09): "quando movo ela pra
   saída tem a justificativa de indisponível na data, e quando abrir outra
   turma/edição ela já volta."
7. Antes de produção, a **demo** (vessel-demonstracao.vercel.app) é publicada
   com o fluxo novo e o dono aprova.

## Parte 1 — o que é a edição, como se entra e avança

- **Edição = um evento de uma praça**: `praca_id`, `numero`, **data do
  evento** (`comeca_em`; Edição 1 Campinas = 2026-10-15, The Stylist Preview,
  Growth Plan `PRE-20261015-CPS`). `termina_em` deixa de ser usada (fica nula;
  a tela não pede mais). Situações: `planejada` (não aceita convidada) →
  `aberta` (aceita) → `encerrada` (para de aceitar; placar segue somando).
- **Abrir NÃO puxa mais a praça inteira.** `vessel_edicao_abrir` só muda a
  situação.
- **Entrar na turma**: quando a stylist é movida para a etapa **Convidado**
  (ou qualquer etapa depois dela na ordem, se pular) e a praça dela tem
  edição `aberta`, ela ganha a linha em `vessel_stylist_na_edicao`
  automaticamente. Botão **Incluir** na tela de Edições para exceções.
  Sem edição aberta na praça: fica sem edição até alguém incluir.
- **Avançar**: `vessel_stylist_na_edicao` ganha `convidada_em`,
  `confirmou_em`, `presente_em` (timestamptz). Preenchidas pelo MESMO
  movimento de etapa que a Ionara já faz no quadro: Convidado → `convidada_em`;
  Confirmado → `confirmou_em`; Presença → `presente_em`. Vale para a linha da
  edição ABERTA da praça da stylist; se ela não tem linha numa edição aberta,
  nada é marcado. Uma marca nunca é apagada por movimento posterior (voltar de
  etapa não desmarca presença).
- **Dois eventos**: uma linha por edição (o `unique (stylist_id, edicao_id)`
  já existe).
- **Tirar**: botão **Tirar** só enquanto a linha não tem `presente_em`
  (engano de inclusão). Apaga a linha.
- A lógica de `saiu_em`/`etapa_ao_sair`/`vessel_stylist_sincronizar_edicao`
  (mudança de praça tirando da edição) **sai**: a turma é de quem foi
  convidada ao evento, e mudar de praça depois não muda de qual evento ela
  veio. Colunas ficam (sem uso) para não quebrar leitura antiga; a função de
  sincronizar deixa de mexer em turma.

### Indisponível na data — sai e volta na próxima edição

- `vessel_stylist_motivos_de_saida` ganha a coluna
  `volta_na_proxima_edicao boolean not null default false` e o motivo novo
  **"Indisponível na data"** (na saída Desclassificado) com ela `true`.
- Mover para a saída com um motivo `volta_na_proxima_edicao` marca, na linha
  dela na edição ABERTA da praça, `indisponivel_em` (timestamptz). Sem linha
  em edição aberta: nada é marcado, mas ela volta do mesmo jeito (abaixo).
- **Voltar**: quando `vessel_edicao_abrir` abre uma edição de uma praça, toda
  stylist ativa dessa praça que está numa saída com o ÚLTIMO motivo
  `volta_na_proxima_edicao` é movida para a etapa **Convidado** (pelo mesmo
  movimento de etapa, registrado no histórico com a nota "Voltou: indisponível
  na Edição N") e ganha a linha na turma nova com `convidada_em` = agora.
  (Suposição anotada: volta em Convidado; se o dono preferir Conversa, troca-se
  a etapa de destino, nada mais.)
- Ficha: "Voltou: indisponível na Edição 1 · Campinas".

## Parte 2 — placar e atribuição

- **Evento de origem da stylist** = a edição com o MENOR `presente_em` dela
  (desempate por `edicao_id`). Função única `vessel_evento_de_origem(stylist_id)`
  — usada pelo placar, pela etiqueta do Private Edit e pela ficha (regra num
  lugar só, nunca copiada).
- **Placar da edição**, sobre a turma (linhas da edição, sem `teste`, `ativa`):
  1. convidadas = linhas;
  2. confirmaram = `confirmou_em` não nulo **ou** `presente_em` não nulo;
  3. presentes = `presente_em` não nulo;
  4. agendaram = presentes cujo evento de origem é ESTA edição e têm algum
     Private Edit com status ≠ `em_planejamento`, em qualquer data/praça;
  5. fizeram = idem com 1º encontro `realizado`;
  6. repetiram = idem com 2º `realizado`.
  Cada passo: número + % sobre o anterior. Meta: agendaram/presentes ≥ 50%
  (verde se bateu, âmbar se não; "—" se presentes = 0, nunca 0%).
- **Clientes convidadas** (bloco `conv` de hoje): os atendimentos dos Private
  Edits que pertencem a esta edição (stylist com origem nesta edição).
- **Indisponíveis na data**: contadas à parte ("indisponíveis na data: N");
  seguem dentro de "convidadas", fora de presentes, e não pesam na meta.
- **"Sem evento"**: Private Edit de stylist sem nenhum `presente_em`. Conta na
  ficha e nos números gerais do Stylist Circle; não entra em placar de edição.
- Receita continua fora (nenhuma venda ligada a pessoa).

## Parte 3 — telas, migração da Edição 1, demo e prova

**Telas**
- Edições: "Nova edição" pede praça + data do evento; botões Abrir / Encerrar
  (aviso "para de aceitar convidadas"); lista da turma com as 3 marcas;
  Incluir / Tirar; placar da Parte 2 no topo.
- Private Edit: etiqueta = evento de origem da stylist ("Edição 1 · Campinas")
  ou "Sem evento". O rótulo "fora de edição" some.
- Ficha da stylist: linha "Veio pelo evento: Edição 1 · Campinas · 15/10"
  (ou "Ainda sem evento").

**Migração da Edição 1 (id 46) já aberta com 30**
- Saem da turma as 20 em "Stylist levantado".
- Ficam as 10 em Convidado ou Confirmado; `convidada_em` / `confirmou_em` =
  data real da 1ª chegada em Convidado / Confirmado em
  `vessel_stylist_etapas_historico` (quem pulou Convidado recebe
  `convidada_em` = a data da chegada em Confirmado).
- Data do evento segue 15/10; Dani (Jundiaí) e Marina (manual) seguem na
  praça Campinas. **Nenhuma stylist muda de etapa.**

**Demo (portão antes de produção)**
- O banco de mentira da demo (`src/demonstracao/`) segue as mesmas regras;
  roteiro ganha a turma do evento com as 3 marcas e o placar novo.
- Publicar a demo (`npm run publicar:demonstracao`), rodar
  `passeio-pelas-ferramentas.mjs`, **mandar o link ao dono e esperar aprovação**
  antes de gravar qualquer coisa em produção.

**Prova**
- Migration nova, só ela, sem o runner, aplicador com ensaio que desfaz
  (padrão `coletor/aplicar-*.mjs`), conta/stylist de prova em savepoint +
  finally.
- Mutações que o aplicador prova REPROVAR: Private Edit contado em dois
  eventos; abrir puxando a praça; presença desmarcada ao voltar de etapa.
  E prova que DEIXA PASSAR: movimento para Convidado com edição aberta cria a
  linha; para Presença marca `presente_em`.
- Antes/depois: contagem por etapa idêntica (55/0/0/5/5/0/0/0 em 28/09),
  Edição 1 com turma de 10, placar lido como o usuário do dono.
- Testes do repo + os da demo passando (as 38 falhas antigas de
  `coletor/lib/interesses.test.mjs` não são deste trabalho).

## Fora do escopo

Receita por evento; Previews de SP/SBO/BSB (ganham edição quando tiverem
data); rotular Private Edit por data em qualquer lugar.

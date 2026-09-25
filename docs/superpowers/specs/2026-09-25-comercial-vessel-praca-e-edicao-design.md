# Comercial Vessel — praça e edição: um painel por praça, um placar por edição

Data: 2026-09-25
Mexe em: `src/ferramentas/comercial-vessel/` (Stylist Circle e Private Edit) + migration
Depende de: T11 (no ar desde 23/09, PRs #208/#237/#240/#248)

Pedido do Breno, 25/09: *"o painel tá ruim… vocês têm que ter uma segregação ali por praça,
um painel por praça. As cidades estão cadastradas todas juntas… eu vi que tem a cidade, mas o
de Piracicaba vai pra qual loja? … E o placar não é mensal, é por edição. Vocês têm que ter a
edição do Style Cycle cadastrada… Pra esse Style Cycle, quantos estão conversados, quantos
prospectados e quantos confirmados. E, primeiro, vocês estão tentando juntar tudo num ponto
só: primeiro um painel só do Style Cycle, depois um do Private Edition e depois o panorama
completo, que é pra olhar se comprou, se não comprou. São três soluções, três etapas bem
distintas."*

---

## 1. A medição que funda este desenho (25/09, banco de produção)

| O que | Medido |
|---|---|
| Stylists (não-teste) | **63** — 27 Campinas, 18 Limeira, 17 Piracicaba, 1 "Limeira / Piracicaba" |
| Com praça e loja | **27 de 63.** As 36 de Limeira e Piracicaba estão sem praça E sem loja |
| Praças que existem | `CPS, SAO, SBO, BSB` — **fixas no código, em 3 cópias**, e **sem Limeira e sem Piracicaba** |
| Onde a praça da stylist mora | `praca_preview` — *preview*, não a praça dela. Não existe coluna `praca` |
| Filtro por praça | **Não existe** em tela nenhuma |
| Placar | Por calendário: Este mês / 30 / 90 / Desde o início (`t11-regras.js:218`) |
| Edição do programa | **Não existe.** ⚠️ `vessel_edicoes` (229 linhas) é o log de alterações, outro assunto |
| Funil hoje | Identificado (61) → Classificação (1) → Prospectado (0) → Convidado (0) → Confirmou Ida (1) → Esteve Presente (0) → saídas Ativada (0) / Desclassificado (0) |
| Volume | 1 prospectada, 0 ativadas, **0 Private Edits, 0 convidadas** |
| Venda ligada a pessoa | **0 de 481 `vessel_pedidos`** |

Duas leituras que mudam o desenho:

1. **A queixa do Breno está escrita no código.** A lista de praças é uma constante repetida em
   `agenda-regras.js:34`, `tela-de-stylist-circle.vue:764` e `tela-de-private-edit.vue:527`. Praça
   nunca foi cadastro; por isso cidade nova não tem para onde ir.
2. **Toda receita do placar é zero por construção**, não por falta de venda: nenhum dos 481
   pedidos está ligado a uma pessoa. Número zero na tela parece fracasso comercial quando é furo
   de base.

## 2. Decisões do dono (25/09)

1. **Edição = rodada POR PRAÇA** ("Limeira · Edição 1"), com começo e fim. Limeira pode estar na
   edição 2 com Campinas na 1. Praça e edição nascem juntas.
2. **Praça é cadastro, com as cidades dela e uma loja de destino** — que pode ser de outra cidade.
   É isso que responde "Piracicaba vai pra qual loja".
3. **Painéis 1 e 2 agora (Style Cycle e Private Edition); o panorama "comprou / não comprou" fica
   CONGELADO.** Enquanto estiver congelado, receita e "comprou" **saem** dos painéis 1 e 2.
4. **Praça · Edição no topo das telas de hoje**, recortando tudo abaixo — não uma tela nova de
   leitura (dois lugares para a mesma verdade viram dois números diferentes).
5. **Stylist que sobra vai para a próxima edição, e a edição encerrada CONGELA** — tabela de
   vínculo com entrada e saída. Placar de edição encerrada nunca muda depois.
6. **Placar: etapas do funil em cima, taxas embaixo.** O número grande é quantas stylists estão
   hoje em cada etapa daquela edição. As três caixas do Breno (conversados / prospectados /
   confirmados) **não são fixadas no código**: o funil já é cadastrado por ele, e o placar
   acompanha a etapa que ele criar.
7. **Limeira e Piracicaba nascem com loja de destino VAZIA**, à vista como pendência na tela, até
   o Breno responder. Um clique no cadastro resolve — sem migration, sem código.

## 3. A base (migration)

- **`vessel_pracas`** — `sigla`, `nome`, `loja_destino` (nula), `ativa`, ordem. Nasce com CPS
  (→ `iguatemi`), SAO, SBO, BSB, **LIM (Limeira)** e **PIR (Piracicaba)**, as duas sem loja.
- **`vessel_praca_cidades`** — cidade achatada (sem acento, sem maiúscula) → praça. Cidade que não
  casar não vira erro: vira pendência visível.
- **`vessel_stylist_circle_edicoes`** — `praca_id`, `numero`, `nome`, `comeca_em`, `termina_em`,
  `situacao` (planejada / aberta / encerrada). ⚠️ **Não usar o nome `vessel_edicoes`** — ocupado.
- **`vessel_stylist_na_edicao`** — `stylist_id`, `edicao_id`, `entrou_em`, `saiu_em`, `etapa_ao_sair`.
  É a tabela que congela a edição encerrada.
- **`vessel_stylists.praca_id`** (a praça de verdade; `praca_preview` passa a ser derivado da
  cidade) e **`vessel_private_edits.praca`** (texto solto) apontando para o cadastro.
- **Migração dos dados**: 27 Campinas → CPS; 18 Limeira → LIM; 17 Piracicaba → PIR; a
  "Limeira / Piracicaba" fica **pendente**, de propósito.

## 4. As telas

**Barra "Praça · Edição" no topo** das duas telas, recortando placar, quadro e listas. Sem praça
escolhida, mostra todas, com o aviso de quantas stylists estão sem praça. Os seletores de período
**saem do placar** (quem manda é a edição) e continuam só nas listas, onde servem.

**Placar da edição** (Stylist Circle): uma caixa por etapa do funil, na ordem cadastrada, com
quantas stylists estão nela hoje. Abaixo, num bloco menor, as taxas da turma que já existem
(ativação, agendamento, realização, comparecimento) — agora da edição, não do mês.

**Private Edit**: a mesma barra, a praça virando cadastro, e **a coluna de receita sai**.
⚠️ Um encontro não guarda edição: ele pertence à edição **daquela praça cuja janela contém o
`quando` do encontro**. Encontro fora de qualquer janela aparece como "fora de edição" — visível,
nunca escondido.

**Arrumação que entra junto** (as telas já têm 66 KB e 57 KB): o placar sai para arquivo próprio.
Sem isso, a próxima mudança no placar encosta na tela inteira.

## 5. O que fica de fora, e o que destrava

- **Painel 3 (panorama comprou / não comprou): congelado por decisão do dono.**
- O que o destrava é **o casamento venda ↔ pessoa** (0 de 481 pedidos). Enquanto não existir,
  qualquer painel de compra nasce mentindo com número certo.
- As funções novas travam **por tela** (`vessel_pode('atendimentos.stylist-circle', …)`), nunca pela família — a `main` trocou isso em 25/09 e há teste-lembrete.
- Nada de movimento automático de etapa: continua valendo a decisão de 24/09 (a etapa só muda
  quando alguém move).

## 6. As provas

1. **Mutação nas contas por edição e por praça** — número certo com filtro errado é o furo
   clássico: o teste tem de reprovar se o recorte for ignorado.
2. **A edição encerrada congela** — mover a stylist para a edição 2 e provar que o placar da
   edição 1 não mudou.
3. **Cidade sem praça vira pendência**, nunca some de uma contagem.
4. **Foto de tela** das duas telas: com praça escolhida, sem praça escolhida e com a pendência à
   vista. Teste verde não prova tela que abre.
5. **Nada de conta de prova em produção**: o aplicador prova dentro de savepoint, com `finally`.

## 7. A DEMO É O PORTÃO (decisão do dono, 25/09)

**Nada vai ao ar antes de o Breno ver na demo.** A demo publica por PASTA
(`npm run publicar:demonstracao` → projeto Vercel `vessel-demonstracao`), não por Git: dá para
mostrar a mudança inteira com a Central intocada, desde que a branch não vá para a main.

- **A migration NÃO é aplicada em produção** nesta fase. O banco real fica como está.
- **O banco de mentira aprende as funções novas** (`src/demonstracao/banco-de-mentira.js`, 1.514
  linhas): praças, cidades, edições, vínculo e placar por edição. ⚠️ Função que ele não conhece
  vira faixa de erro na demo — o que é certo, mas não é o que queremos mostrar.
- **Os dados da demo são o cenário de verdade**: as 4 cidades, as 36 sem praça, Limeira com a
  Edição 1 aberta. É o problema resolvido que tem de aparecer, não dado bonito.
- **Sobem os dois painéis de uma vez** (Style Cycle e Private Edition), numa subida só.
- Depois de publicar: `DEMO=… PLAYWRIGHT=… node src/demonstracao/passeio-pelas-ferramentas.mjs`
  — é a conferência obrigatória de toda publicação da demo.

## 8. Ordem de execução

1. Migration das praças, cidades, edições e vínculo + migração dos dados das 63 stylists
   (**escrita e provada em savepoint; aplicada em produção só depois do aval na demo**).
2. Cadastro de Praças e cadastro de Edições (telas pequenas, no menu do Comercial Vessel).
3. Placar em arquivo próprio + placar por edição.
4. Barra Praça · Edição no Stylist Circle.
5. Barra Praça · Edição no Private Edit + saída da receita.
6. Banco de mentira + dados da demo, publicação da demo e passeio.
7. **Portão: o Breno olha.** Só então migration em produção, merge na main e fotos no ar.

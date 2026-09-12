# Excluir, editar e baixar lotes e peças do Selo Vessel — desenho

**Data:** 30/08/2026
**Projeto 2 de 4** da série do selo (a divisão está no fim)

## O objetivo em uma frase

Deixar o dono corrigir e limpar o que criou, sem que uma bolsa original na mão
de uma cliente vire uma página dizendo "não consta no nosso registro".

## A trava que decide o desenho inteiro

Fui ver o que a página da cliente faz com um código que não existe: mostra
**"não consta no nosso registro de peças. Isso pode ser um erro..."**.

Então **apagar uma peça cuja etiqueta já foi gravada e costurada faz uma bolsa
original parecer falsa** para quem comprou — e não há como desfazer, porque a
etiqueta está dentro da bolsa. É por isso que "excluir" não pode ser um botão só.

## O que foi medido antes de desenhar (30/08/2026)

| | |
|---|---|
| `vessel_lotes` | já tem `fabricado_em date not null default current_date` |
| `vessel_gerar_lote` | já recebe `p_fabricado_em` — **nenhuma migration para a data** |
| A tela | já pede a data ao criar e já mostra na lista |
| A página da cliente | já usa `fabricado_em` |
| Dado real | 1 lote: Mônaco Quartz LV1021, fabricado 01/03/2026, criado 05/08 |
| Peças gravadas | **zero** |
| Padrão das funções | `security definer`, `set search_path to 'public'`, portão `is_vessel_admin()` devolvendo `{ok:false, motivo:'sem_permissao'}`, `revoke ... from public, anon` |

A data de fabricação **já funciona**. O que falta nela é só poder **editar
depois** — e é isso que entra aqui.

## As decisões do dono

**Excluir só o que nunca foi gravado.** Lote sem nenhuma peça gravada some
inteiro; peça não gravada some. Peça gravada **não pode ser excluída**.

**Peça gravada vira BAIXA, com motivo.** Quatro motivos, todos escolhidos pelo
dono: `extraviada`, `defeito`, `devolvida`, `etiqueta_perdida`.

**A baixa se desfaz**, com registro de quem desfez. Uma peça dada como
extraviada pode reaparecer, e um clique errado não pode ser definitivo numa peça
que já está com a cliente.

**A página da cliente NÃO MUDA.** Decisão do dono: a baixa é controle interno.
A peça continua respondendo normalmente — o que importa é que ela não foi
apagada, então ninguém vê "não consta".

**O sinal que se perde volta pelo painel.** Como a página não avisa nada, o dono
não saberia que a bolsa extraviada apareceu. Mas a página **já registra toda
leitura** em `vessel_leituras` — então a aba Alertas ganha "peça baixada foi
lida". Vocês ficam sabendo sem incomodar quem está com a bolsa.

**Editar:** modelo, cor, SKU, data de fabricação, e a quantidade para mais ou
para menos.

## O desenho

### O banco

**Uma tabela nova, `vessel_baixas`** — e não uma coluna em `vessel_pecas`.
Motivo: assim o histórico fica inteiro. Com coluna, baixar de novo depois de
desfazer apagaria a baixa anterior, e some justamente o que interessa numa peça
que já sumiu uma vez.

```
codigo       text     -> vessel_pecas(codigo)
motivo       text     -> extraviada | defeito | devolvida | etiqueta_perdida
baixada_em   timestamptz not null default now()
baixada_por  uuid
desfeita_em  timestamptz
desfeita_por uuid
```

**"Está baixada?" é ter linha com `desfeita_em` nula.** Uma fonte de verdade só.

**RLS ligada e UMA política de SELECT**, igual às outras quatro tabelas do selo —
medido em 30/08/2026, e não é o que a memória do projeto dizia:

```sql
create policy vessel_baixas_read on public.vessel_baixas
  for select to authenticated using (public.is_vessel_admin());
```

⚠️ **Não é "zero política".** Eu tinha escrito isso aqui, copiando o que a
memória do projeto afirmava. Conferi no banco: `vessel_pecas`, `vessel_lotes`,
`vessel_leituras` e `vessel_registros` têm cada uma **uma** política, de SELECT,
para `authenticated`, com `is_vessel_admin()`. É assim que o painel consegue ler
`vessel_pecas` direto. Com zero política, a tabela nova nasceria ilegível para a
tela e o defeito só apareceria na hora de mostrar a baixa.

O que NÃO existe é política de escrita: inserir, alterar e apagar passam só pelas
funções `security definer`. É esse o desenho, e a tabela nova segue ele.

**Cinco funções**, todas no padrão da casa:

| função | recusa quando |
|---|---|
| `vessel_excluir_lote(p_lote uuid)` | **qualquer** peça do lote está gravada |
| `vessel_excluir_peca(p_codigo text)` | a peça está gravada |
| `vessel_editar_lote(p_lote uuid, p_modelo, p_cor, p_sku, p_fabricado_em, p_quantidade)` | a quantidade pedida é menor que o número de peças **gravadas** |
| `vessel_baixar_peca(p_codigo text, p_motivo text)` | motivo fora da lista, ou a peça já está baixada |
| `vessel_desfazer_baixa(p_codigo text)` | a peça não está baixada |

**Baixar vale para QUALQUER peça**, gravada ou não — mas para a não gravada o
certo quase sempre é excluir, e é excluir que a tela oferece nesse caso. Deixar
baixar as duas evita uma recusa que só confundiria.

**`baixada_por` e `desfeita_por` saem de `auth.uid()`** dentro da função, nunca
de parâmetro: parâmetro deixaria quem chama dizer que foi outra pessoa.

**A recusa mora no BANCO, não na tela.** A tela impedir não basta: quem chama a
função direto passaria por cima. Cada recusa devolve `{ok:false, motivo:'...'}`
com um motivo que a tela sabe traduzir para português.

**Editar a quantidade:**
- **para mais** — nascem códigos novos continuando a série, com o mesmo sorteio
  criptográfico do `vessel_gerar_lote`. As peças que já existem não são tocadas.
- **para menos** — saem as peças **não gravadas de maior número na série**. Se o
  que sobraria fosse menos que as já gravadas, recusa e diz **quantas estão
  presas**, em vez de apagar algo que tem etiqueta em bolsa.

### A fila de gravação ignora peça baixada

Consequência que é fácil deixar passar: **peça baixada não pode continuar na
fila de gravação.** Sem isso, a tela mandaria alguém gravar a etiqueta de uma
peça que foi dada como refugo.

Muda em `lotes.js` e `nfc-fila.js`:
- `proximaPorGravar` pula peça baixada;
- `progressoDoLote` não conta peça baixada no total (senão o lote nunca fecha);
- `listaParaGravadorDeMesa` não exporta peça baixada.

### O painel

**Aba Lotes** — cada lote ganha **editar** e **excluir**. O editar abre com os
valores de hoje, inclusive a data de fabricação. Quando não dá para excluir, a
tela **diz por quê e quantas peças estão gravadas** — botão desabilitado calado
faz a pessoa achar que a ferramenta está quebrada.

**Aba Gravar** — a peça da vez ganha **baixar**, com os quatro motivos em
português. Peça baixada mostra o motivo, a data e **desfazer a baixa**.

**Aba Alertas** — ganha "peça baixada foi lida", com o código, o motivo e quando
foi a leitura.

### O que a tela diz, em português de gente

| situação | frase |
|---|---|
| excluir lote com peça gravada | "Não dá para excluir: 7 das 20 etiquetas deste lote já foram gravadas e estão dentro de bolsas. Você pode dar baixa nas peças, uma a uma." |
| excluir peça gravada | "Esta etiqueta já foi gravada e pode estar dentro de uma bolsa. Em vez de excluir, dê baixa nela com o motivo." |
| diminuir abaixo do gravado | "Não dá para deixar em 5: 7 peças já foram gravadas. O mínimo é 7." |
| baixa feita | "Peça 12 baixada como extraviada. Ela sai da fila de gravação e continua respondendo normalmente para a cliente." |

## Como se prova

- As contas puras (a fila que ignora baixada, a tradução dos motivos, as frases
  de recusa) com teste ao lado, no padrão da pasta.
- **A trava do banco provada com `rollback`**: numa transação, tentar excluir um
  lote com peça gravada e conferir que recusa; tentar diminuir abaixo do gravado
  e conferir que recusa. Nunca desarmando a trava para o teste passar — teste que
  precisa desarmar a trava está provando outra coisa.
- **Nunca mexer no dado real do dono.** Hoje existe 1 lote com 5 peças e zero
  gravadas; qualquer prova cria o próprio lote e desfaz por `rollback`.
- A tela medida a 375px nos dois temas, num navegador de verdade.

## O que NÃO entra

A página da cliente (`vessel-brasil/verify/`) — por decisão do dono, ela não
muda. E as fotos automáticas do Bling, que são o Projeto 3.

## A divisão dos projetos da série

| | projeto | estado |
|---|---|---|
| 1 | Gravar as etiquetas + fila de gravação | **no ar** |
| 1b | Passo a passo e guia da primeira vez | **no ar** |
| **2** | **Excluir, editar e baixar** ← este documento | agora |
| 3 | Fotos automáticas do Bling ou da `fotos_por_sku` | depois |
| 4 | Ordem de Produção e PDV, no repositório de produção | depois |

## Pendências do dono, que nenhum código resolve

Continuam as mesmas do Projeto 1: conceder a permissão `autenticidade` a quem
for usar, comprar as etiquetas NTAG213, e fazer o primeiro teste de gravação
numa etiqueta descartável com a trava desligada.

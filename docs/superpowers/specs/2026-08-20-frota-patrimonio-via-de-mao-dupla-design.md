# Frota ↔ Patrimônio · a via de mão dupla, sem cadastrar duas vezes

Desenho de 20/08/2026. Pedido do dono, com as palavras dele:

> *"o cadastro de bens de carros está necessitando duas mão de obra. Se eu
> cadastro o carro pelo patrimônio já é para aparecer em frota, e se eu cadastro
> em frota primeiro já é pra ir pra patrimônio. Em frota adicione um campo para
> colocar o número de patrimônio ao acrescentar um veículo e aí já sincroniza
> tudo nas duas ferramentas."*

E o caso que provocou o pedido, nas palavras dele:

> *"foram cadastrados dois kwids agora, se bobear 3. O primeiro foi pelo
> patrimônio aí não apareceu em frota. O segundo foi pelo frota e aí não linkou
> direto no patrimônio, porque não dava pra pôr número de patrimônio."*

---

## O que foi medido antes de desenhar

Nada aqui é suposição. Tudo saiu do banco de produção em 20/08/2026, em consulta
de leitura.

### Os KWIDs são **dois**, não três — e é exatamente o estrago descrito

| Onde | Criado hoje | O que ficou |
|---|---|---|
| Patrimônio — bem **nº 291** "KWID" | **09:53** | categoria Veículos, marca "KWID", **nenhum carro ligado** |
| Frota — carro "KWID", placa **RVU6B06** | **11:11** | marca "RENAULT ", **sem `bem_id` e sem código** |

Mesmo carro, duas fichas, uma hora e dezoito minutos de intervalo, e **nenhuma
das duas sabe da outra**. É a mão de obra dobrada, medida.

### A ligação já existe nos dois sentidos — mas é toda manual

Não falta ligação; falta ela ser automática. O que já está no ar:

| Lado | Arquivo | O que faz hoje |
|---|---|---|
| Frota | `bens-para-veiculo.js` | `bensLivresParaFrota()` oferece bens de Veículos ainda livres; `patchDoBem()` copia nome/marca/FIPE pra ficha |
| Patrimônio | `ligacao-com-frota.js` | `veiculosParaLigar()` oferece carros ainda sem bem; `patchVeiculoDoBem()` sugere nome/marca |

O vínculo mora numa coluna só: **`frota_veiculos.bem_id`**. Os dois lados sabem
**escrever** nela. O que **nenhum dos dois faz** é *criar a ficha do outro lado*
— e é aí que nasce o segundo cadastro à mão.

### O nó: "número de patrimônio" hoje são **duas** coisas, as duas em uso

| Esquema | Onde mora | Formato | Quantos carros |
|---|---|---|---|
| **Nº de etiqueta** | `patrimonio_bens.numero` | inteiro, 1 a 400 | **2** — o KWID (291) e o Punto (14) |
| **Código interno** | `frota_veiculos.codigo_patrimonial` | texto `RBB-00X` | **9** — RBB-001 a RBB-010, sem o 008 |

O `numero` é o que a **etiqueta impressa carrega** (Code 128, mostrado com 6
dígitos: `000291`) e o que o leitor de código lê — `leitor-de-codigo.js` acha o
bem por `b.numero === numero`. O `RBB-00X` não é lido por leitor nenhum.

⚠️ **E o pulo do gato, medido:** o sistema inteiro tem **362 bens**, dos quais
**353 têm número** (de 1 a 380) e **9 não têm**. Esses 9 sem etiqueta são
**exatamente os 9 carros antigos** — nenhum outro bem da empresa ficou de fora.
Os carros são o único buraco na numeração, porque a Frota os numerou pelo
esquema dela.

Os **10 carros que já estão ligados a um bem**, e o que cada um tem de número:

| Carro | Placa | Código na Frota | Nº de etiqueta |
|---|---|---|---|
| VOLVO XC60 | BDN3A67 | RBB-001 | *(vazio)* |
| FIAT DOBLO | QQT9B68 | RBB-002 | *(vazio)* |
| FIAT BRAVO ESSENCE | OLW4I46 | RBB-003 | *(vazio)* |
| FIAT BRAVO BLACKMOTION | FFK9E60 | RBB-004 | *(vazio)* |
| **FIAT PUNTO** | EDC6H82 | RBB-005 | **14** ← o único |
| HONDA FIT | DUB7D72 | RBB-006 | *(vazio)* |
| FORD FIESTA SEDAN | ERO3G55 | RBB-007 | *(vazio)* |
| VOLVO XC90 | FEF0C13 | RBB-009 | *(vazio)* |
| PORSCHE CAYENNE PHEV | FQW7G77 | RBB-010 | *(vazio)* |
| BMW X1 | DCH1J89 | *(vazio)* | *(vazio)* |

São **9 sem etiqueta** — só o Punto escapou. E o 11º carro, o KWID `RVU6B06`,
não está nesta lista porque **não tem bem nenhum ligado**: é a ficha órfã de
hoje.

**Decisão do dono nesta sessão:** o número que vale é o **Nº da etiqueta**. Carro
passa a ser bem como qualquer outro — mesma sequência, mesma etiqueta, e o
leitor de código passa a achar carro.

### Um defeito de brinde, achado na leitura

`patchDoBem()` (`bens-para-veiculo.js:33`) sugere hoje:

```js
patch.codigo_patrimonial = String(bem.numero).padStart(6, '0')
```

Ou seja, escolher o bem 291 na Frota preenche o código com **`000291`** — um
formato que **não bate com nada em uso**: nem com o `RBB-00X` dos 9 carros, nem
com o que qualquer tela mostra. Sugestão que ninguém pediu e que polui o campo.

### As duas travas técnicas que decidem o que é possível

**1. A placa é obrigatória na Frota, e o Patrimônio não guarda placa.**

`frota_veiculos.placa` é **`NOT NULL`**. E `patrimonio_bens` **não tem coluna de
placa** — conferido também o `detalhes` (jsonb) dos 11 bens de veículo: **todos
`{}`**, e `numero_serie` nulo nos 11. Não há placa escondida em canto nenhum.

Consequência dura: **o caminho Patrimônio → Frota não consegue criar o carro
sozinho.** Falta justamente o que identifica um carro na Frota.

**2. Os portões de permissão são diferentes.**

```sql
is_frota_admin()      -- 'frota' = any(features)  OR  is_superadmin
is_patrimonio_admin() -- role = 'admin'           OR  'patrimonio' = any(features)
```

E na conta real, sobre 22 pessoas:

| | Quantas |
|---|---|
| Têm Frota **e** Patrimônio | 8 |
| Têm **só** Frota | **5** |
| Têm **só** Patrimônio | **2** |

Pra essas **7 pessoas**, a metade automática falharia — e falharia no INSERT,
com a RLS barrando.

### O que já está a nosso favor

| Regra no banco | Por que importa |
|---|---|
| `frota_veiculos_placa_key` **UNIQUE (placa)** | placa é identidade sólida: dá pra achar o carro por ela |
| `patrimonio_bens_numero_key` **UNIQUE (numero)** | etiqueta é identidade sólida: dá pra achar o bem por ela |

"Ligar em vez de duplicar" sai **de graça** — as duas chaves de busca já são
únicas no banco.

### E um buraco achado no caminho

`frota_veiculos.bem_id` **não tem índice único**. Hoje **dois carros podem
apontar pro mesmo bem**, e nada no banco impede. Os dois lados evitam isso por
gentileza no código (`veiculosParaLigar`, `bensLivresParaFrota` filtram os já
usados), mas gentileza de tela não é trava.

Medido agora: **0 casos**. Está limpo — é hora de fechar, antes de existir o
primeiro.

---

## O desenho

### Princípio que manda em tudo: cada dado tem **um** dono

Já é a regra da casa (`project_iamundi_quem_manda_no_dado`): o Patrimônio diz o
que a coisa **é**, a Frota diz como ela é **usada**.

Daí a decisão que evita a próxima dor de cabeça: **a placa NÃO ganha coluna no
bem.** Ela continua morando só em `frota_veiculos.placa`. O Patrimônio pede a
placa no formulário — mas pra **criar o carro**, não pra guardar cópia. Depois,
mostra lendo o carro ligado.

Cópia de dado em duas tabelas é o que envelhece e diverge — e este projeto já
levou esse tiro mais de uma vez.

### Parte 1 — a função que costura os dois lados

Uma função só, com poder próprio (`SECURITY DEFINER`), serve **as duas
direções**:

```
sincronizar_carro_e_bem(
  p_placa, p_nome, p_marca, p_numero_etiqueta, p_valor_centavos, ...
) → { carro_id, bem_id, o_que_fiz }
```

**O portão.** Passa quem é admin **da Frota OU do Patrimônio**. E isso **não
abre o Patrimônio inteiro** pra quem só tem Frota: a função só sabe fazer uma
coisa — criar bem **da categoria Veículos** amarrado àquele carro. Não cria
cadeira, não lê os outros 362 bens, não edita nada que já exista.

**O que ela faz, em ordem:**

1. acha o carro **pela placa** (normalizada: sem espaço, maiúscula) → usa esse;
   se não achar, **cria**
2. acha o bem **pela etiqueta** → usa esse; se não achar, **cria** na categoria
   Veículos
3. amarra `bem_id` no carro
4. devolve os dois ids **e o que fez, em português**, pra tela poder dizer a
   verdade: *"criei o carro e liguei ao bem 291"*, *"os dois já existiam, só
   liguei"*, *"criei os dois"*

**O caso que ela recusa.** Se a placa já pertence ao carro A, a etiqueta já
pertence ao bem B, e o carro A já está amarrado a um bem C — **ela para e
explica**. Não rewira nada calada. Religar ficha errada é pior do que não
ligar: some prova sem ninguém saber.

⚠️ **Um efeito que a tela precisa respeitar:** `patrimonio_bens` tem RLS de
leitura por time (`pode_ver_bem(local_id, pessoa_id)`). Uma pessoa só-Frota vai
**criar** o bem pela função, mas pode **não conseguir lê-lo** depois. Por isso a
função **devolve os ids e a frase** — a tela mostra o que aconteceu a partir da
resposta, sem precisar reler o bem. Reler e não achar viraria *"não criei"* na
cara de quem acabou de criar.

### Parte 2 — a trava que faltava

Índice único parcial em `frota_veiculos.bem_id` (parcial porque `NULL` pode se
repetir: carro sem bem é caso normal). Fecha o buraco dos dois carros no mesmo
bem.

### Parte 3 — o que muda na Frota

**"Acrescentar veículo" ganha o campo `Nº de patrimônio (etiqueta)`.**

- numérico, com o **próximo livre sugerido** — a mesma conta que o Patrimônio já
  faz (`mapaDeNumeros().proximoLivre`, em `numeros-de-etiqueta.js`)
- ⚠️ **e o próximo livre é `5`, não `381`.** A conta preenche **buracos** na
  numeração de 1 a 400, e sobrou vaga lá embaixo. É de propósito (etiqueta é
  adesivo físico, número queimado é desperdício), mas surpreende — a tela diz
  *"próximo livre: 5"* em vez de deixar a pessoa adivinhar de onde saiu.
- salvar passa pela função: **etiqueta que já existe liga, não duplica**

**E morre a sugestão errada.** `patchDoBem()` para de escrever `000291` em
`codigo_patrimonial`. Os `RBB-00X` que já estão lá **ficam** — são código
interno antigo, não se apaga dado do dono. Só param de ganhar companhia num
formato que ninguém usa.

### Parte 4 — o que muda no Patrimônio

**Categoria Veículos → campo `Placa`, obrigatório.** (Decisão do dono: sem placa
não salva bem de veículo.)

- salvar passa pela **mesma função** → o carro nasce na Frota junto
- nos **10 bens que já têm carro**, a placa vem **preenchida sozinha** do carro
  ligado — ninguém digita nada pra editar um bem antigo
- o único que vai pedir digitação é o **bem 291 (o KWID)**, que não tem carro

⚠️ **E é aí que o estrago de hoje se conserta com o próprio mecanismo:** digitar
`RVU6B06` no bem 291 faz a função achar o carro que já existe **pela placa** e
**amarrar os dois**. As duas fichas de hoje viram uma. Sem apagar nada, sem
migration de dado, sem intervenção à mão.

---

## O que fica de fora, e por quê

| O quê | Por quê |
|---|---|
| **Numerar os 9 carros antigos** | É adesivo físico pra colar e conferir no carro, não código. Vai pra lista do dono. |
| **Aposentar o `RBB-00X`** | Enquanto os 9 não tiverem etiqueta, ele é a única identificação que esses carros têm. Aposentar agora seria apagar o que resta. |
| **Placa como coluna do bem** | Cópia que diverge. A placa tem dono: a Frota. |
| **Sincronizar valor, local e empresa** | O pedido é sobre **existir nos dois lados**, não sobre espelhar tudo. Espelhar campo a campo é decidir quem vence em cada conflito — assunto próprio, e maior que este. |

⚠️ **O STATUS SAIU DESTA LISTA no mesmo dia.** Ele estava aqui como "espelhar
tudo é assunto próprio", e o dono trouxe o assunto na mesma sessão: *"quando o
bem for veículo, o status de patrimônio precisa ser igual à frota para
sincronizar informação."* Virou a **migration 051**.

A trava que o assunto escondia: os dois `CHECK` só compartilham **uma** palavra
(`em_manutencao`), então "igual" ao pé da letra é recusado pelo banco. A solução
foi tradução de um pra um, confirmada pelo dono linha a linha — Livre e Fixo
viram `em_uso`, Parado vira `em_estoque`, Fora da frota vira `baixado`.

Quem manda é a **Frota**, e são dois gatilhos: um empurra a mudança, o outro
impede que uma edição no Patrimônio desfaça o espelho em silêncio.

**Decisão do dono sobre a tela:** o campo de status do Patrimônio **continua
editável**, sem travar e sem etiqueta de "vem da Frota". A consequência aceita é
que editá-lo num item de veículo salva e volta sozinho ao valor do carro, sem
aviso.

---

## Como isto vai ser provado

Na ordem, e nenhuma etapa vale sem a anterior:

1. **Teste puro nas regras novas** — que etiqueta repetida **liga** em vez de
   duplicar; que placa repetida **liga**; que o conflito de par cruzado **para**;
   que o próximo livre sai `5` e não `381`.
2. **A função rodada de verdade em SQL, uma vez, dentro de `rollback`** — antes
   de valer pra qualquer tela. Poder executar não é passar pelo `if` de dentro:
   o corpo tem que rodar e o resultado tem que ser lido.
3. **A trava provada** — tentar amarrar dois carros no mesmo bem e ver o banco
   recusar. Trava que não foi vista recusando não está provada.
4. **Os dois cadastros feitos na tela**, com conta real, só criando: um carro
   novo pela Frota com etiqueta, e um bem novo de veículo pelo Patrimônio com
   placa. Teste verde não é tela que abre.
5. **O KWID juntado** — o caso que provocou o pedido, resolvido pela via normal
   da tela, não por SQL na mão.

⚠️ **O que NÃO vai ser feito:** semear, limpar ou mexer em dado real pra testar.
Os KWIDs de hoje são dado de verdade do dono — o que acontece com eles é
juntá-los, nunca apagá-los.

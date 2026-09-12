# O grupo do canal (atacado / varejo) — Peça 1

**Data:** 20/08/2026
**Pedido do dono:** *"nas vendas tem o campo seletor de canais, eu quero uma separação
por canal — exemplo, atacado (opção pra marcar/desmarcar todos) e varejo."*

Esta spec cobre **só a Peça 1**: onde o grupo mora, como se configura, e nada mais.
As outras três estão no fim, com o que cada uma depende daqui.

---

## 1. A decisão, e por que ela não foi óbvia

A primeira leitura foi pôr o rótulo no **time** (`equipes`). A medição derrubou:

| | quantos |
|---|---|
| Canais no Bling (`bling_lojas`) | **14** |
| Canais que têm time | **3** |
| Canais com venda registrada | **3** (os mesmos) |

Os 11 sem time são: Atacado Fábrica, Varejo Fábrica, Loja Hortolândia, Seller
Mercado Livre, Tik Tok Shop, Amazon Seller, Private Label, Institucional, Canal
Direto, Canal Direto 2 e Loja Shopify. Eles **aparecem no seletor hoje**, zerados —
isso foi pedido de propósito em 23/07.

Com o rótulo no time, esses 11 ficariam sem grupo, e tirá-los de lá exigiria
inventar 11 times — sendo que "Private Label" e "Institucional" não são time de
gente nenhuma. O dono confirmou que os 11 **vão vender um dia** e que quer marcá-los
agora, no aplicativo.

**Decisão: o grupo mora no CANAL. O time é atacado ou varejo pelo canal a que já
está amarrado** (`equipes.canal_loja_id`). Não há campo novo na ficha do time, e não
há duas marcações para manter em acordo.

**Grupo é texto, não uma escolha travada no código.** O dono disse "exemplo,
atacado e varejo" — "exemplo" é o aviso de que um terceiro pode aparecer. Se um
grupo novo virasse migration, cairíamos na armadilha que este repositório já evitou
de propósito com as lojas: *"loja nova é rotina do negócio, não evento de
engenharia"* (`2026-08-04-equipes-e-escopo.sql`).

---

## 2. O que muda no banco

```sql
alter table public.bling_lojas
  add column if not exists grupo text;
```

`null` = sem grupo. É o estado inicial dos 14, **de propósito**: não vou adivinhar
o grupo pelo nome do canal. Adivinhar pelo nome é exatamente o defeito que acabou
de ser consertado no estoque, onde uma lista de palavras decidia o que era produto
e o que era insumo — e errava em 213 linhas.

### A política que falta, e que é o defeito silencioso desta peça

`bling_lojas` tem RLS **ligado** e **uma única política**: `authenticated read`
(SELECT). Não existe política de UPDATE.

⚠️ **Sem acrescentar uma, a tela vai "salvar" e não salvar.** O PostgREST responde
**sucesso com zero linhas** quando o RLS barra — não dá erro. É o mesmo defeito que
já custou um dia neste projeto. Então entra junto:

```sql
create policy "superadmin edita o grupo do canal"
  on public.bling_lojas for update
  to authenticated
  using  (coalesce((select is_superadmin from public.profiles where id = auth.uid()), false))
  with check (coalesce((select is_superadmin from public.profiles where id = auth.uid()), false));
```

`using` **e** `with check`: só o `using` é metade da trava — ele decide quais linhas
podem ser alcançadas, não o que pode ser gravado nelas.

E a tela **confere a contagem de linhas afetadas**: se voltar zero, ela diz que não
salvou, em vez de piscar "salvo".

### O que NÃO muda

- Nenhuma coluna existente. Nada é apagado.
- Nada lê `grupo` ainda além da tela de configuração. É fundação.

---

## 3. A tela

Uma seção nova em **Config de Admin**, junto de Times (mesmo portão de superadmin).

```
CANAIS DE VENDA                                    14 canais · 3 sem grupo
─────────────────────────────────────────────────────────────────────────
Atacado Nuvem Shop            [ Atacado  ▾ ]      time: Atacado Nuvem Shop
Loja Dom Pedro                [ Varejo   ▾ ]      time: Dom Pedro
Loja Santa Bárbara d'Oeste    [ Varejo   ▾ ]      time: Tivoli
Atacado Fábrica               [ — sem grupo ▾ ]
Varejo Fábrica                [ — sem grupo ▾ ]
…
```

- O seletor lista os grupos **que já existem** no banco, mais `— sem grupo` e
  **`+ novo grupo…`**, que abre um campo de texto. Sem a opção de criar, a pessoa
  trava na hora em que precisa de um terceiro grupo — é regra do padrão da casa.
- Cada linha mostra o **time amarrado**, quando há. É o que deixa visível que o
  time herda o grupo do canal, sem precisar explicar.
- Salva na hora, por canal. Erro aparece na linha, não num aviso solto.
- Grupo digitado é **normalizado** (espaços das pontas fora; "Atacado" e "atacado"
  são o mesmo grupo) para não nascerem dois grupos que parecem um.

### Onde o grupo aparece já nesta peça

Na ficha do time, **em leitura**: *"Grupo: Varejo (vem do canal Loja Dom Pedro)"*.
Sem isso, a Peça 1 não teria nenhuma prova na tela de que funcionou.

---

## 4. Como se prova

- **Lógica pura, testada sem navegador** (`grupo-do-canal.js`): normalizar o nome
  do grupo, listar os grupos existentes sem repetir, agrupar canais por grupo com
  os sem-grupo num balde próprio, e o de-para canal → time.
- **A trava, provada no banco** com `rollback`: um `update` como superadmin grava;
  como não-superadmin, afeta **zero linhas**. Sem desarmar nada — desarmar a trava
  para testar é testar outra coisa.
- **A tela, medida a 375px e a 1440px**, nos dois temas, pelos quatro critérios do
  `PADRAO-DA-CENTRAL`.
- `npm test` inteiro e `npm run build`.

---

## 5. O que fica de fora, e onde entra

| Peça | O que é | Depende daqui |
|---|---|---|
| 2 | Seletor das dashboards agrupado em Atacado/Varejo, com marcar/desmarcar todos por bloco | lê `bling_lojas.grupo` |
| 3 | Supervisora passa a ver **todo o grupo** dos times onde é supervisora; gerente (`gestor`) e vendedora seguem vendo só a loja delas | lê `bling_lojas.grupo` nas **três** camadas: módulo compartilhado, edge `bling-proxy` e `pode_ver_canal` |
| 4 | Config de Usuários com os cards de time sob cabeçalhos de grupo | lê `bling_lojas.grupo` |

A Peça 3 é a única que mexe em trava, e vai em sessão própria.

**Estoque não entra em nenhuma delas.** `pode_ver_estoque` tem regra própria e mais
apertada ("estar no time não basta"), escrita de propósito. Mudar junto seria embutir
uma decisão que ninguém pediu.

---

## 6. Duas coisas que ficam anotadas

1. **Canal novo no Bling não entra sozinho.** `bling_lojas` foi semeada uma vez em
   21/05/2026 — as 14 linhas têm o mesmo carimbo e nada no repositório escreve nela.
   Um canal criado no Bling hoje não aparece nem no seletor nem nesta tela nova até
   alguém inserir a linha. É anterior a esta peça e continua depois dela; fica escrito
   para não virar "o grupo sumiu".
2. **`anon` tem grant de escrita na tabela** (`arwdDxtm`), e hoje quem segura é o RLS,
   que não dá política nenhuma a `anon`. A política nova é `to authenticated`, então
   não abre nada para `anon` — mas o grant largo continua lá, e é assunto de outra
   rodada.

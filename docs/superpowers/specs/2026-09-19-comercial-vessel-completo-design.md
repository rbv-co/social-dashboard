# Comercial Vessel completo — desenho

**Pedido do dono em 19/09/2026**, com as palavras dele: *"n consigo gerar
appointment card pela central, as ferramentas de beauty, private edit, stylist
circle estão pobres pra mim, entrando nas ferramentas de comercial vessel elas n
pegam a lateral toda da tela, umas voltam direto pra central, outras voltam pras
ferramentas do comercial, sendo que é pra voltar página a página"*.

São **duas entregas**, nesta ordem, decidido por ele:

1. **Esta aqui** — o Comercial Vessel inteiro, com a largura resolvida só nele.
2. **A seguinte** — a varredura de largura pelo resto da Central (~20 telas com
   trava própria). Fica de fora deste documento.

---

## O que foi medido antes de desenhar

| Queixa | O que o código diz |
|---|---|
| Appointment Card não tem porta na Central | Confere. Zero linha dele no iamundi; mora só em `vessel-brasil/geradorappointmentcard/`, **outro repositório** (`rbv-co/vessel-brasil`), que o `.gitignore` do iamundi exclui de propósito. O app Vue **não pode importar** nada de lá. |
| O voltar está bagunçado | Confere. Private Appointment, Beauty Sessions e Funil de Carrinho voltam para `inicio`; Private Edit e Stylist Circle voltam para `comercial-vessel`. As três primeiras nasceram antes do card de família. |
| As telas não pegam a lateral toda | A trava não é das telas: é `.container-app` (`--container-max: 1280px`) e o `62rem` do menu. |
| As ferramentas estão pobres | Beauty Sessions e Private Edit: criar, copiar link, encerrar/reabrir. Stylist Circle: só olhar e copiar. Nenhuma edita, apaga, filtra, ordena, busca ou escolhe período. |

**Achado que muda o custo:** a lista de convidadas **já existe como dado**.
`vessel_conta_das_private_edits` já conta `responderam`, `disseram_sim`,
`confirmadas` e `compareceram` a partir de `vessel_atendimentos` amarrados ao
encontro por `evento_codigo`. Mostrar os nomes é devolver as linhas em vez do
número — não é tabela nova.

---

## 1 · O voltar, página a página

| Tela | Volta hoje | Passa a voltar |
|---|---|---|
| Menu Comercial Vessel | Central | Central *(não muda)* |
| Private Appointment | Central | **Comercial Vessel** |
| Beauty Sessions | Central | **Comercial Vessel** |
| Funil de Carrinho | Central | **Comercial Vessel** |
| Private Edit | Comercial Vessel | *(não muda)* |
| Stylist Circle | Comercial Vessel | *(não muda)* |

O rótulo da barra de topo acompanha: `voltar="Comercial Vessel"`.

⚠️ **É o pai, não o histórico.** Quem abre por link salvo cai direto na tela sem
passar pelo menu; o voltar leva ao lugar onde a tela mora, que é o certo — e não
a uma Central que a pessoa nunca viu nesta sessão.

⚠️ **Nenhum endereço direto muda.** `/beauty-sessions` continua respondendo.

## 2 · A largura, nas seis telas desta família

As seis telas trocam `.container-app` por um container da família:

```css
.cv-largo { width: 100%; padding-inline: clamp(16px, 2.4vw, 40px); }
```

E o menu perde o `max-width: 62rem`, com os cards em grade que preenche:
`repeat(auto-fill, minmax(280px, 1fr))`.

⚠️ **`--container-max` NÃO é tocado nesta entrega.** Ele é global; mudá-lo
reflete em toda a Central no mesmo instante. Isso é a entrega 2, com varredura e
conferência tela por tela a 1920px.

⚠️ **O celular não muda.** O `clamp` desce a 16px, que é o `--gutter` de hoje.
Conferir a 375px continua obrigatório.

## 3 · Editar e apagar

**Beauty Sessions e Private Edit** ganham editar e apagar.

O que se edita:

| Private Edit | Beauty Session |
|---|---|
| dia e hora, local, praça, loja, vagas, anfitriã | dia e hora, loja |

⚠️ **O `codigo` e a `chave` nunca se editam.** O `codigo` é o identificador do
CRM e a `chave` é o que está dentro de todo convite já enviado. Trocar qualquer
um dos dois mata links que já estão circulando.

### A regra do apagar

Três situações, e a tela diz em qual está:

| Situação | O que dá para fazer |
|---|---|
| Ninguém pendurado (zero convidada, zero leitura) | **Apagar de verdade.** É o caso do "criei errado agora". |
| Já tem gente | **Encerrar** (já existe) e **Arquivar** (novo) |

⚠️ **Apagar com gente pendurada deixaria linhas órfãs** em `vessel_atendimentos`
e a receita passaria a somar sobre um encontro que não existe mais.

**Arquivar é diferente de encerrar, e a diferença é nas contas:**

- **Encerrada** = acabou como devia. **Continua contando** no histórico.
- **Arquivada** = não devia estar ali (duplicata, engano com gente já dentro).
  **Sai das contas e sai da lista.** O dado permanece no banco.

⚠️ Sem essa diferença, arquivar uma duplicata deixaria a receita contada duas
vezes — que é o defeito que arquivar existe para resolver.

### Banco

Coluna nova em `vessel_private_edits` e `vessel_beauty_sessions`:

```sql
arquivada boolean not null default false
```

E o filtro entra **pelo mesmo caminho que `teste` já usa** nas funções de conta
(`not coalesce(t.teste, false)` → ganha `and not coalesce(e.arquivada, false)`).
O molde já está pronto; não se inventa um segundo jeito de esconder linha.

Funções novas, todas `security definer`:

| Função | O que faz |
|---|---|
| `vessel_private_edit_editar` | muda os campos editáveis de um encontro |
| `vessel_private_edit_apagar` | apaga **só se** zero atendimento amarrado; senão devolve `tem_gente` |
| `vessel_private_edit_arquivar` | liga/desliga `arquivada` |
| `vessel_beauty_session_editar` | idem, para a sessão |
| `vessel_beauty_session_apagar` | idem, com a mesma trava (zero leitura) |
| `vessel_beauty_session_arquivar` | idem |
| `vessel_private_edit_convidadas` | devolve as linhas de `vessel_atendimentos` do encontro |
| `vessel_stylist_criar` / `_editar` / `_desativar` | o Stylist Circle (parte 5) |

⚠️ **CADA UMA NASCE COM A TRAVA E O GRANT JUNTOS** — `is_vessel_atendimentos()`
por dentro e `grant execute` para `authenticated`, na mesma migration. Em
18/09 `vessel_criar_private_edit` subiu no ar **sem conferência de permissão e
sem grant para ninguém**. Dar o grant sem a tranca é pior: `security definer`
roda como dono e `authenticated` é todo mundo que fez login.

⚠️ **`revoke ... from public` não fecha `authenticated`.** Seguir o molde das
funções irmãs desta mesma família, não escrever do zero.

## 4 · Ordenar, filtrar, buscar, período

Um componente só — `barra-de-lista.vue`, na pasta `comercial-vessel/` — usado
pelas três telas. Mesmo raciocínio do `estilo-comercial.css`: duas cópias do
mesmo controle viram dois controles diferentes no dia em que alguém ajusta um.

A barra monta só os controles que fazem sentido em cada tela — não existe
filtro de loja numa lista de pessoas, nem período numa lista de parceiras.

| Controle | Private Edit | Beauty Sessions | Stylist Circle |
|---|---|---|---|
| Período (7/30/90/tudo) | sim *(hoje é 7 cravado)* | sim | não |
| Busca | código e nome da anfitriã | código e local | nome, cidade e código |
| Situação | todas/abertas/encerradas/arquivadas | idem | todas/ativas/desativadas |
| Loja | sim | sim | não |
| Estágio | não | não | sim |
| Ordem | data ↑↓ | data ↑↓ | nome, aberturas ↑↓ |

⚠️ **O bloco "Todos os encontros juntos" recalcula sobre o que está filtrado, e
diz sobre quantos está falando.** Um total que não acompanha o filtro é a tela
mentindo com número certo.

⚠️ **As regras de `estatistica.js` continuam valendo em cima do filtrado:** toda
taxa com denominador, base zero não é 0%, margem por Wilson, taxa de conjunto
soma numeradores e denominadores. O filtro não pode virar a porta dos fundos por
onde uma taxa pelada volta para a tela.

⚠️ **O período é do banco, o resto é da tela.** `p_dias` já é parâmetro das
funções de conta. Busca, situação, loja e ordem acontecem sobre o que voltou —
e por isso o total tem de ser recalculado na tela, nunca reaproveitado da
resposta.

## 5 · Stylist Circle vira tela de verdade

Cadastrar parceira, corrigir os dados, mudar o estágio e desativar quem saiu.

| Edita | Nunca edita |
|---|---|
| nome, whatsapp, cidade, instagram, atuação, estágio, praça | **`codigo`**, **`origem_canal`**, **`origem_campanha`**, **`origem_utm`** |

⚠️ **O `codigo` é o que vai dentro de todo link de rastreio já colado por aí.**
Mudar quebra os links em circulação e a atribuição das aberturas antigas.

⚠️ **A origem é primeiro toque e não se sobrescreve** — está escrito na própria
tabela, pelo módulo 10. Reescrever faz a atribuição somar o canal duas vezes.

⚠️ **Desativar não apaga.** As aberturas e os atendimentos que ela trouxe
continuam contando no histórico; ela só sai da lista de escolher e do topo da
tela.

## 6 · Quem foi, no Private Edit

Cada encontro abre e mostra as convidadas uma a uma: nome, se respondeu, se
disse sim, se confirmou, se compareceu, e se comprou (com a janela de venda ao
lado, como já é a regra).

⚠️ **Só entra quem não é `teste`** — mesmo filtro das contas, senão o número do
topo e a lista de baixo discordam na mesma tela.

⚠️ **É dado pessoal na tela** (nome e whatsapp). Continua atrás da permissão
`atendimentos`, que é a mesma que já protege as contas desse encontro.

## 7 · A porta do Appointment Card

Um sexto card no menu do Comercial Vessel, que abre
`vesselbrasil.com.br/geradorappointmentcard/` em aba nova.

**Abre vazio, e só.** Decisão do dono em 19/09.

⚠️ **Não é para copiar o gerador para dentro do app.** Seriam 831 linhas de tela
+ o desenho no canvas + o fundo de 377 KB + três fontes + o codificador de QR,
tudo duplicado num segundo repositório — junto com três contas delicadas que
passariam a existir em dose dupla: a arte que é **1,35x** a especificação, o QR
que tem de caber em **43 caracteres**, e a fonte Versatile que tem `:` e `;`
trocados no arquivo.

⚠️ **Não é para embutir em moldura (iframe).** A Vercel manda `frame-ancestors`
e o quadro sai branco, com o erro só no console.

⚠️ **Sem preenchimento automático.** O gerador não lê nada da barra de endereço
hoje, e ensiná-lo a ler exige mexer e publicar o outro repositório. O dono
decidiu não abrir essa pendência.

---

## Permissões

⚠️ **Nenhuma chave nova.** Tudo continua atrás de `atendimentos` (as cinco telas
da Vessel) e `carrinho` (o funil). Uma chave "comercial" nasceria **desmarcada**
para todo mundo e tiraria, no dia da entrega, o acesso de quem já trabalha com
isso.

⚠️ **Editar, apagar e arquivar entram atrás de `atendimentos` → `editar`**, não
de `ver`. Quem só vê continua só vendo. Conferido: o módulo já aceita as duas
ações (`acoes: ['ver','editar']`) e a tela de Private Appointment já usa a
segunda — não é capacidade nova, é usar a que existe.

⚠️ **ACHADO EM 19/09, DEPOIS DO DESENHO: o banco não sabe o que é "editar".**
`is_vessel_atendimentos()` lê `profiles.features`, que é uma lista de chaves
**sem ação** — ela responde igual para quem só vê e para quem mexe. A tela lê
outro modelo, `profiles.permissions`, que é `recurso → [ações]`. São **dois
modelos de permissão que não conversam**.

Consequência se ficasse assim: esconder o botão na tela seria só esconder. A
função de apagar aceitaria a chamada de qualquer um com `atendimentos`, por
fora da tela.

Por isso nasce `is_vessel_atendimentos_editar()`, e ela é **as duas coisas
juntas**:

```sql
select public.is_vessel_atendimentos()          -- o portão de hoje, features
   and (p.is_superadmin or (p.permissions -> 'atendimentos') ? 'editar')
```

⚠️ **Nunca mais frouxa que ver.** Começando pelo portão de hoje, ninguém passa a
editar sem antes poder ver — mesmo que os dois modelos discordem entre si.

⚠️ **O rótulo do módulo na tela de permissões ainda diz "Vessel — Atendimentos"**,
o nome de antes. Passa a dizer **"Vessel — Private Appointment"**, para quem
configura reconhecer o que está marcando. A **chave continua `atendimentos`** —
trocá-la tiraria o acesso de todo mundo de uma vez.

## Como se prova

- **Tela:** as seis telas a **375px** e **1920px**, claro e escuro. Nada cortado,
  sem rolagem lateral, nenhum hex novo. Foto de cada uma.
- **Voltar:** clicar o voltar nas seis e conferir onde cai; e abrir cada endereço
  direto, sem passar pelo menu, e clicar o voltar de novo.
- **Banco:** cada função nova com `.sql` de prova ao lado, no padrão das irmãs
  (`docs/provar-*.sql`) — inclusive a prova de que **sem a permissão a função
  recusa**, e de que apagar com gente pendurada devolve `tem_gente`.
- **Contas:** a suíte de `estatistica.js` continua verde, e ganha caso de filtro:
  o total do conjunto muda quando o filtro muda.
- ⚠️ **ZERO escrita saindo para a produção** durante as provas de tela.

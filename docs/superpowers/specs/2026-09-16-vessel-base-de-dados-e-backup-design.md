# A base de dados da Vessel, e o backup que não existe

> **Estado em 16/09/2026, 21h:** as camadas 1 e 2 e o backup estão CONSTRUÍDOS,
> aplicados e provados. O que falta é a camada 3 (o pedido, pedido a pedido), os
> espelhos das tabelas novas, e o texto das finalidades da política de
> privacidade. Ver a seção 11, no fim.

**16/09/2026** · desenho aprovado em conversa, aguardando revisão do dono.

Este documento desenha duas coisas que andam juntas:

1. **A base de dados de pessoas e atendimentos da Vessel** — o que o Growth
   Plan v3.1 chama de modelo de CRM (módulo 10, tarefa T01, já aprovada no
   gate H06), e que hoje não existe.
2. **Um sistema de cópia de segurança** para o banco inteiro da Central.

A segunda entrou porque, ao medir a primeira, apareceu um buraco maior.

---

## 1. O que existe hoje — medido, não suposto

Medido em 16/09/2026, direto no banco de produção.

| | |
|---|---|
| Tabelas no total | 126 |
| Tamanho do banco | **39 MB** |
| Tabelas da Vessel | 11 — todas sobre a PEÇA (selo, lotes, registros, garantias, leituras) |
| Pessoas cadastradas | **86**, todas em `vessel_lista_espera` |
| Atendimentos | não existe tabela |
| Oportunidades | não existe tabela |
| Origem/atribuição | não existe tabela |
| Permissões (LGPD) | não existe tabela; o aceite mora numa coluna da lista de espera |
| Espelhos | 1 robô, 2 arquivos CSV no Zoho WorkDrive |

### As vendas

`gc_vendas_item` tem 3.502 linhas e **não é** o que parece. A chave dela é
`(mês, canal_loja_id, sku)`: é o **total do mês**, por loja, por modelo.

Não há pedido. Não há cliente. Não há telefone — e não é que a coluna esteja
vazia: ela não existe.

**Consequência:** a corrente de atribuição do plano (T07 → T08 → T09) não
depende, em primeiro lugar, de a Client Advisor preencher a cliente no PDV do
Bling. Mesmo que ela preencha perfeitamente, **o dado não chega ao nosso
banco**. Falta coletar o pedido, e não só o total do mês.

---

## 2. Os dois achados que mudam a prioridade

### 2.1. Não existe backup nenhum

A organização Grupo RBV está no plano **Free** da Supabase. A documentação da
própria Supabase é explícita:

> *"We automatically back up all Pro, Team, and Enterprise Plan projects on a
> daily basis. (…) We recommend that free tier plan projects regularly export
> their data using the Supabase CLI db dump command and maintain off-site
> backups."*
> — <https://supabase.com/docs/guides/platform/backups>

Ou seja: **o banco da Central não tem cópia de segurança automática hoje.**
Não é uma cópia velha; é nenhuma. Se a base for perdida, apagada por engano ou
corrompida, não há de onde voltar.

O que está nessa base, e que não se digita de novo:

- 86 pessoas reais com nome, e-mail e WhatsApp;
- 210 peças e 137 lotes do selo, com número de série gravado dentro de bolsas
  vendidas — e 157 etiquetas NFC no forro apontando para elas;
- garantias com dono, registros, e a trilha de edições;
- 377 bens de patrimônio, 14 veículos, 99 revisões de frota;
- 61 decisões da fila de aprovação de tráfego (append-only, é o histórico).

### 2.2. O espelho NÃO é backup — e isso é de propósito

O robô `vessel-espelhar-lista` grava CSV no WorkDrive, e a cada rodada ele
**compara o arquivo inteiro** com o que deveria estar lá e regrava. Foi
construído assim para cumprir a Política de Privacidade: apagou do banco, some
da planilha em até 15 minutos.

Essa é exatamente a propriedade que **desqualifica** o espelho como backup: uma
perda no banco propaga para o espelho na rodada seguinte.

**Backup e espelho são coisas opostas e precisam dos dois.**

| | espelho | backup |
|---|---|---|
| para quem | pessoa lendo a planilha | máquina restaurando |
| formato | CSV | JSONL (preserva tipo e nulo) |
| quando apaga no banco | some junto (é o objetivo) | **fica**, na cópia daquele dia |
| sobrescreve | sim, toda rodada | nunca; cada dia é uma pasta |

---

## 3. O modelo de segurança

Não vou inventar um modelo: o que já existe neste repositório está certo e é
seguido à risca. Ele nasceu de um problema real — a chave anônima da Supabase
fica **dentro do HTML de uma página pública**, então qualquer pessoa que abra a
LP tem essa chave na mão.

As quatro regras, todas já em produção em `vessel_lista_espera`:

1. **RLS ligada e ZERO política** em toda tabela com dado de pessoa. Não é
   "política restritiva": é nenhuma política. Pela API pública a tabela não
   existe.
2. **Uma única porta, e ela é uma função `security definer`.** A função valida,
   grava e responde `{"ok": true}` — nada além disso. Ela nunca devolve dado.
3. **A porta tem trava contra robô e contra abuso:**
   - campo-armadilha invisível: preenchido, responde sucesso e não grava (o robô
     não descobre que foi barrado);
   - teto por origem por hora: estourado, responde sucesso e não grava;
   - endereço de rede guardado **só como hash**, nunca cru.
4. **Resposta que não vaza existência.** E-mail repetido responde sucesso sem
   dizer que já existia — senão a página vira um verificador de "fulana está na
   base?".

Para **leitura**, a regra é outra: só de dentro da Central, com login, e
atrás de `is_vessel_admin()` — o mesmo portão que já protege `vessel_edicoes`.

### O que NÃO se coleta, por decisão

O módulo 10 do plano é explícito, e o desenho obedece:

- **sem CPF, sem data de nascimento, sem endereço** para simples captação de
  interesse;
- **nada da cliente em endereço de página** — nem nome, nem telefone, nem
  e-mail (é por isso que o QR do Appointment Card carrega só praça, código da
  Client Advisor e o número do convite);
- **não se infere renda** por bairro, profissão ou aparência;
- dado de saúde ou de procedimento de salão **não entra**, nem nas Beauty
  Sessions.

---

## 4. As tabelas

Seis tabelas novas. Todas com `RLS enable` e nenhuma política.

### 4.1. `vessel_pessoas` — quem é

```
id                bigserial primary key
nome              text not null
telefone          text not null        -- só dígitos, com país: 5519999998888
email             text
cidade            text
consultora        text                 -- CA-xx responsável, quando houver
criado_em         timestamptz not null default now()
atualizado_em     timestamptz not null default now()

unique (telefone)
```

**O telefone é a chave do sistema inteiro.** É por ele que o lead da landing
page encontra o contato do Bling, e é ele que o Meta usa (em código
irreversível) para reconhecer a pessoa. Guardado sempre normalizado — só
dígitos, com o código do país — porque um parêntese a mais faz o cruzamento dar
zero **sem erro nenhum**.

A normalização já existe e está testada: `whatsappCanonico`, em
`vessel-brasil/regras-da-lista.mjs`.

### 4.2. `vessel_origens` — de onde ela veio

```
id                bigserial primary key
pessoa_id         bigint not null references vessel_pessoas(id)
momento           timestamptz not null default now()
canal             text not null    -- lp | beauty_session | stylist | appointment_card | organico
campanha_id       text
evento_id         text             -- BS-20260925-CPS-01, PRE-20261015-CPS…
parceiro_id       text
stylist_id        text             -- STY-0001…
criativo_id       text
utm_source        text
utm_medium        text
utm_campaign      text
utm_content       text
utm_term          text
clique_meta       text             -- o _fbc: a etiqueta do clique no anúncio
navegador_meta    text             -- o _fbp
```

**Tabela separada, e só acrescenta — nunca atualiza.** É isto que garante o que
o módulo 10 exige: *"não sobrescrever o first_touch ao receber uma mensagem
nova"*. A primeira origem é simplesmente a linha mais antiga; as demais são as
origens assistentes.

⚠️ `clique_meta` é o campo que, se faltar, mata a atribuição para sempre. Ele só
existe no instante em que a pessoa chega vinda do anúncio. **Ele tem de ser
gravado na T03 (21/09), nove dias antes da T08 — o cronograma trata as duas como
independentes e elas não são.**

### 4.3. `vessel_atendimentos` — a visita

```
id                bigserial primary key
pessoa_id         bigint not null references vessel_pessoas(id)
loja              text not null      -- iguatemi | tivoli | parkshopping
client_advisor    text               -- CA-xx
quando            timestamptz        -- data e hora combinadas
status            text not null      -- solicitado | confirmado | realizado
                                     -- | remarcado | cancelado | no_show
convite_codigo    text unique        -- o código que vai no QR do cartão
origem_registro   text not null      -- appointment_card | lp | manual
presenca_em       timestamptz
criado_em         timestamptz not null default now()
atualizado_em     timestamptz not null default now()
```

Duas coisas que o módulo 16 obriga e o desenho respeita:

- **pedido de horário não é horário reservado.** `solicitado` e `confirmado` são
  estados diferentes, e o formulário da LP cria `solicitado`;
- **remarcar e faltar não destroem o atendimento.** Viram estado, com data — a
  pessoa continua a mesma e o histórico continua legível.

`presenca_em` é a coluna que hoje não existe em lugar nenhum e sem a qual o
show rate (meta de 75% do protocolo) **não tem como ser calculado**. Alguém
precisa marcar que a cliente veio; o sistema só pode oferecer o botão.

### 4.4. `vessel_permissoes` — o que ela autorizou

```
id                bigserial primary key
pessoa_id         bigint not null references vessel_pessoas(id)
finalidade        text not null     -- atendimento | marketing | imagem
canal             text not null     -- whatsapp | email | telefone
texto_versao      text not null     -- a versão do texto que ela leu
situacao          text not null     -- concedida | revogada
momento           timestamptz not null default now()
fonte             text not null     -- de qual página/formulário veio
```

Uma linha por finalidade, porque **permissão de atendimento, de marketing e de
imagem são separadas** (módulo 10). Recusar marketing não pode bloquear o
atendimento que a pessoa pediu — isso é o teste de aceite QA05 do plano.

A versão do texto vai junto: sem ela, não se consegue provar **o que** ela
aceitou.

### 4.5. `vessel_convite_aberturas` — o caderno da T07

```
id                bigserial primary key
momento           timestamptz not null default now()
convite_codigo    text
praca             text              -- CPS | SBO | BSB | SAO
client_advisor    text
via               text              -- qr | texto
ip_hash           text
```

Uma linha por abertura do endereço `/c/<praça>/<ca>/<código>`. É o que transforma
a marcação que já está nos cartões em número.

⚠️ **Sem `pessoa_id`.** Um QR escaneado não é um contato identificado — o módulo
10 diz isso com todas as letras. A ligação com a pessoa existe só por
`vessel_atendimentos.convite_codigo`, e portanto só para convites que saíram de
um atendimento registrado.

### 4.6. `vessel_pedidos` e `vessel_pedido_itens` — a venda, pedido a pedido

⚠️ **CORRIGIDO EM 17/09/2026, MEDINDO O BLING.** Este item dizia que o elo com a
pessoa era o telefone. **Não é: o pedido do Bling NÃO TRAZ telefone**, nem na
lista nem no detalhe. Traz `contato.id`, nome, tipo de pessoa e CPF.

O casamento tem duas escadas, nesta ordem:

1. **`bling_contato_id` — exato.** O robô do espelho já cria a ficha do lead no
   Bling quando ela preenche uma landing page; no dia da venda a loja escolhe
   essa ficha, e o pedido vem com o mesmo id. Sem fuzzy, sem dúvida.
2. **O telefone da FICHA** (`contatos/<id>`), normalizado — para quem comprou
   sem ter passado por nós antes. Ler os **dois** campos: a ficha criada pela
   loja no PDV preenche `telefone`; a criada pelo nosso robô preenche `celular`.
   Ler só um perde metade, e perde calado.

**O que a medição de 90 dias disse** (400 pedidos atendidos):

| | |
|---|---|
| pedidos sem contato nenhum | **0** — a loja registra a cliente, sempre |
| contatos distintos | 341 |
| fichas com telefone aproveitável | **88%** |
| fichas com e-mail | 21% |
| fichas com marca de origem | 0 — nenhuma compradora veio pela lista de espera |

Ou seja: **a corrente tem chão.** O medo de que a loja não preenchesse a cliente
era infundado — ela preenche.

```
vessel_pedidos
  bling_pedido_id (unico), numero, bling_contato_id, contato_nome,
  pessoa_id (nulo quando orfa), casou_por (bling_contato | telefone),
  loja_id, vendedor_id,
  data_do_pedido, data_da_nota, data_da_venda, origem_da_data,
  total_produtos, desconto, outras_despesas,
  total_do_bling, total_corrigido, situacao_id

vessel_pedido_itens
  pedido_id, sku, descricao, quantidade, valor_unitario, desconto

vessel_envios_ao_meta
  pedido_id, evento, event_id (unico com o evento), enviado_em, resposta
```

⚠️ **A data da venda é COPIADA, não recalculada.** `bling_pedido_nota` já traz
`data_da_venda` e `origem_da_data`, escritas pelo robô que roda de hora em hora
— é o número que a Gestão à Vista e os relatórios usam. Derivar o nosso daria um
segundo número, parecido e não igual, e um dia alguém perguntaria por que o
painel da Vessel diz 12 e o comercial diz 14.

⚠️ **O robô NÃO CRIA PESSOA.** Ele só liga o pedido a quem já existe. Trazer as
341 compradoras do Bling para `vessel_pessoas` seria copiar dado de gente de uma
tabela para outra sem ninguém ter decidido isso. Para contar compradoras, o
painel usa `bling_contato_id` distinto — mesma resposta, sem duplicar ninguém.

⚠️ **Venda órfã é um fato a medir, não um erro a esconder.** Entra com
`pessoa_id` nulo, tem índice próprio, e o robô diz quantas foram a cada rodada.

Duas regras do módulo 10 que o desenho carrega: **nunca criar venda por avanço
manual** (só entra pedido que existe no Bling) e **devolução não é compra nova**
(vira ajuste no valor, e para o Meta é evento de ajuste, não um `Purchase` novo).

---

## 5. As portas

Três funções `security definer`, cada uma com uma finalidade só.

| função | quem chama | o que faz | o que devolve |
|---|---|---|---|
| `vessel_pedir_atendimento` | as LPs (T03–T06, SB02, DF02) | cria pessoa se não existir, grava origem, cria atendimento `solicitado`, grava permissões | `{"ok": true}` |
| `vessel_registrar_cartao` | o gerador do Appointment Card | cria pessoa se não existir, cria atendimento `confirmado` com o código do convite | `{"ok": true, "codigo": "…"}` |
| `vessel_abrir_convite` | a página `/sua-visita` | grava uma abertura | `{"ok": true}` |

Todas com armadilha, teto por hora e hash de IP, como a que já está no ar.

**Nenhuma delas lê.** Leitura é só pela Central, autenticada, atrás de
`is_vessel_admin()`.

---

## 6. Os espelhos

O robô que existe ganha companhia, não substituição.

```
vessel-espelhar-lista   (já no ar, cron 15 min)
  lista-de-espera-vessel.csv      ← continua
  garantias-vessel.csv            ← continua
  pessoas-vessel.csv              ← novo
  atendimentos-vessel.csv         ← novo
  convites-abertos-vessel.csv     ← novo
```

Mesma disciplina, que é o que faz a coisa funcionar: **compara o arquivo
inteiro** com o que deveria estar lá, em vez de perguntar "tem linha nova". Sem
isso, apagar alguém do banco deixaria os dados dela na planilha — e a Política
promete apagar em 7 dias.

O Bling continua recebendo o contato, com a marca de origem em `codigo`
(`LP-AAAAMMDD-<id>`), que é o único campo de texto livre que um contato do Bling
tem — `observacoes` ele aceita e **descarta calado**.

**RD Station** entra como um terceiro destino do mesmo robô, quando o dono
decidir. Não antes: integração que ninguém usa é dívida.

---

## 7. O backup

### 7.1. O que é copiado, e com que frequência

Medido: o banco inteiro tem 39 MB.

| camada | o que entra | quando | tamanho |
|---|---|---|---|
| **A — insubstituível** | vessel_*, acessos_*, patrimonio_*, frota_*, equipes*, conteudo_*, gt_*, bling_* (configuração), fabrica_*, perfis e permissões | **todo dia** | ~13 MB |
| **B — histórico de métrica** | snapshots, campaign_insights, account_insights, seguidores | **toda semana** | ~15 MB |
| **C — registro de execução** | robos_execucoes, coletor_log, gestor_log, data_integrity_checks, ia_execucoes | **nunca** | ~10 MB |

A camada C fica de fora de propósito: ela se regenera sozinha e sua perda não
custa nada. A camada B em tese se recoleta da Meta, mas as tabelas por hora com
delta calculado **não se refazem** — por isso ela entra, semanal.

Custo de tráfego: ~390 MB/mês na camada A e ~170 MB/mês na B. O plano Free dá
5 GB/mês. Folgado.

### 7.2. Como é gravado

```
Zoho WorkDrive / Backups da Central /
    2026-09-16/
        vessel_pessoas.jsonl
        vessel_atendimentos.jsonl
        …
        manifesto.json
```

- **JSONL**, uma linha por registro. CSV perde tipo, confunde nulo com texto
  vazio e quebra em texto com vírgula e quebra de linha. Backup tem de voltar
  idêntico.
- **Uma pasta por data. Nunca se sobrescreve.**
- **`manifesto.json`** traz, por tabela: contagem de linhas, tamanho em bytes e
  a soma de verificação SHA-256 do arquivo.

⚠️ O manifesto é o que impede o pior defeito de backup: o arquivo que sobe
truncado ou vazio e ninguém percebe até o dia de restaurar. Se a contagem de
uma tabela cair mais de 10% de um dia para o outro, o robô **falha e avisa** em
vez de gravar.

### 7.3. Por quanto tempo se guarda

- as **30 cópias diárias** mais recentes;
- a cópia do **dia 1º de cada mês**, por 12 meses;
- a limpeza é do próprio robô, e ela **nunca apaga a cópia mais recente**, nem
  que a regra mande.

### 7.4. Como se restaura — e a prova de que dá

`ferramentas/restaurar-copia.mjs`, e ele tem uma trava por construção:

1. lê uma pasta de backup pela data;
2. confere cada arquivo contra o manifesto (soma e contagem);
3. escreve num **schema separado** (`copia_AAAAMMDD`), **nunca** por cima da
   tabela viva;
4. imprime a comparação linha a linha entre a cópia e o que está em produção.

Voltar para produção é passo manual, com o dono decidindo e olhando a
comparação. Restauração automática por cima de dado vivo é como se perde o dado
duas vezes.

**Prova mensal:** dia 1º, depois da cópia, o robô restaura a do dia anterior num
schema temporário, compara as contagens, apaga o schema e registra o resultado
em `robos_execucoes`. **Backup que nunca foi restaurado não é backup — é um
arquivo.**

### 7.5. O que este backup NÃO cobre

- **Arquivos do Storage.** A documentação da Supabase avisa: backup de banco
  guarda só o registro do arquivo, não o arquivo. As fotos do selo já moram no
  repositório do site, não no Storage — mas se algum dia passarem a morar lá,
  isto precisa ser revisto.
- **As Edge Functions.** Elas não estão no banco. Já existe outro problema
  conhecido com elas (quem publica por último vence, e já apagou trabalho no ar
  em 14/09). Fica registrado aqui, mas é outro assunto.
- **Senha de papéis do banco.** Backup lógico não leva.

---

## 8. O que fica de fora, de propósito

- **Oportunidade/pipeline comercial.** O módulo 10 descreve um funil de oito
  estágios. Ele só ganha sentido quando houver quem o mova todo dia, e isso é a
  T02 do Gabriel. Enquanto não houver, seria tabela vazia com cara de sistema.
- **Stylists e Private Edits.** Entram na T06 (25/09), com dado próprio.
- **Painel.** É a T09 (05/10). Este documento entrega o dado, não a tela.
- **RD Station.** Terceiro destino do espelho, quando for decidido.

---

## 9. Decidido pelo dono em 16/09/2026

1. **Texto das três finalidades novas na política de privacidade** — eu escrevo,
   alguém da empresa valida. **Enquanto não subir, o gerador do Appointment Card
   continua sem gravar.** ⚠️ As tabelas e as portas já existem no banco; o que
   falta é a página do cartão passar a chamar `vessel_registrar_cartao`.
2. **A data da venda é a do Bling**, seguindo a regra que a casa já tem: a venda
   entra quando o pedido vira *Atendido*, na **data do pedido** — não na da
   nota. Está em cinco lugares do código e foi medida em agosto.
   ⚠️ **Consequência para o Meta:** pedido concluído muito depois chega fora da
   janela de atribuição e não será creditado. Existe caso real na base (pedido
   de 27/07 concluído em 11/08). Não há conserto do nosso lado — o que há é
   **medir quantos caem fora** e mostrar, em vez de a conta não fechar.
3. **Conta de anúncio: C1 — Vessel Brasil** (`act_1197997517858139`).
   ⚠️ São duas contas no mesmo CNPJ e **as duas se chamam Vessel**; o nome no
   nosso cadastro não é o nome na Meta. A outra é `act_1193360736025748`
   ("C2 - La Vessel").
4. **Plano da Supabase: fica no Free por enquanto.** A cópia que construímos é a
   única linha de defesa, então ela não é opcional.

## 9.1. O buraco de segurança que a prova achou, e o conserto

Ao provar a porta com a chave que está no HTML do site — que é o que qualquer
visitante tem — apareceu isto:

```
POST /rest/v1/rpc/vessel_pessoa_por_telefone
  { "p_nome": "…", "p_telefone": "…" }        → HTTP 200, e GRAVOU.
```

Qualquer pessoa podia criar registros de gente à vontade, pulando a armadilha e
o teto por hora.

**A causa:** `revoke all on function … from public` **não fecha**. No Supabase
os papéis `anon` e `authenticated` recebem execute por privilégio padrão do
schema, que é uma concessão separada da do papel `public`. Só fecha revogando
dos três.

**A segunda lição, e é da prova:** ela dava 404 nessa função e eu li como
"fechada". Era assinatura errada — eu chamava sem os dois argumentos
obrigatórios. Prova que passa por engano é pior que prova nenhuma. Agora ela
chama com argumentos de verdade e só aceita "não é 200".

Consertado em `db/migrations/2026-09-16-vessel-fecha-as-funcoes-internas.sql`.

**Varredura do resto do banco:** 22 funções com poder de dono são alcançáveis
pela chave pública. Sete são portas públicas de propósito (lista de espera,
selo, contador da pré-venda, e as três novas). As outras quinze são ajudantes
das regras de acesso (`pode_ver_*`, `minhas_equipes`, `is_vessel_admin`…) e
**precisam** ser chamáveis: as próprias regras as invocam em nome de quem
consulta, e revogar quebraria as regras. Para quem não está logado elas só
respondem "não". **Nenhum outro buraco.**

## 10. Como se prova que funcionou

Os testes de aceite não precisam ser inventados: o módulo 10 do plano já traz
dezoito, de QA01 a QA18. Os que este desenho tem de passar:

| | |
|---|---|
| QA01 | envio válido cria UMA pessoa e UM atendimento |
| QA02 | clique duplo não duplica |
| QA03 | pessoa que volta preserva a origem inicial |
| QA05 | recusar marketing não bloqueia o atendimento pedido |
| QA06 | descadastro suspende os fluxos |
| QA08 | falha de gravação vira erro visível, nunca sucesso falso |
| QA09 | agendamento solicitado não entra como confirmado |
| QA11 | no-show não vira presença |
| QA17 | nenhuma tela ou endereço público expõe a titular |

E três que são deste desenho:

| | |
|---|---|
| BK01 | a cópia do dia abre, e o manifesto bate linha a linha |
| BK02 | queda de mais de 10% nas linhas de uma tabela FALHA a cópia |
| BK03 | a restauração num schema separado reproduz as contagens da cópia |


---

## 11. O que foi construído em 16/09/2026

### Feito e provado

| | |
|---|---|
| `vessel_pessoas`, `vessel_origens`, `vessel_atendimentos`, `vessel_permissoes`, `vessel_convite_aberturas` | no ar, trava ligada, zero política |
| `vessel_pedir_atendimento`, `vessel_registrar_cartao`, `vessel_abrir_convite` | as três portas, no ar |
| `coletor/provar-porta-de-vessel-pessoas.mjs` | prova pela chave pública; achou e fechou um buraco real |
| `coletor/guardar-copia-do-banco.mjs` | a cópia diária; 113 tabelas, 8,7 MB, primeira rodada feita |
| `coletor/restaurar-copia.mjs` | confere e restaura num schema separado; restauração provada |
| `.github/workflows/copia-do-banco.yml` | 06h12 UTC todo dia; domingo com o histórico de métrica |
| painel de saúde | o robô da cópia entrou como **crítico**, cobra após 30h |

**A prova de ponta a ponta da cópia, feita hoje:** as 113 tabelas subiram para o
WorkDrive, foram baixadas de volta, toda soma de verificação bateu, a
restauração num schema separado reproduziu `vessel_pecas` com as 210 linhas e
conteúdo legível, o segredo de cron veio redigido, e o schema de teste foi
apagado.

### Falta

1. ~~A camada 3~~ — **FEITA em 17/09/2026.** `vessel_pedidos`,
   `vessel_pedido_itens` e `vessel_envios_ao_meta` no ar, com o robô
   `coletor/trazer-pedidos-do-bling.mjs` e agendamento diário às 07h34 UTC.
2. **Os espelhos das tabelas novas** no CSV do WorkDrive.
3. **O texto das três finalidades novas** da política de privacidade. Até ele
   subir, a página do Appointment Card **não chama** `vessel_registrar_cartao` —
   a porta existe e está fechada por escolha, não por falta.
4. **Enviar os commits para o GitHub.** Enquanto não forem, o agendamento da
   cópia não roda: hoje existe uma cópia, de hoje, feita à mão.


---

## 12. A conferência contra o que o comercial já usa (17/09/2026)

A tabela nova (pedido a pedido) foi comparada com `gc_vendas_item` (total do mês
por loja por SKU), em agosto inteiro. **Elas não batem, e isso está certo** — mas
só depois de um defeito meu ter sido consertado.

### O defeito, que a comparação achou

Um item de R$ 97,80 saía por R$ 0,80 na minha conta: eu subtraía o `desconto` do
item como se fosse dinheiro.

**Medido: é PORCENTAGEM.** Em 1.125 itens, o maior `desconto` é 84,36 — e em 21
deles ele é maior que o valor do próprio item, o que em reais seria pagar para a
cliente levar.

Consertado em duas partes, e a segunda é a que importa:
- a coluna passou a se chamar `desconto_percentual` — nome que mente é pior que
  coluna ausente, porque o próximo a chegar subtrai de novo;
- entrou `total_do_item`, **já calculado**, para ninguém precisar saber da
  pegadinha para somar receita.

### O que sobra de diferença, e por quê

| | pedido a pedido | comercial |
|---|---|---|
| Dom Pedro — **peças** | **161** | **161** ✓ |
| Dom Pedro — receita | 23.696,45 | 25.245,24 |
| Atacado — peças | 275 | 257 |
| Loja Shopify, Atacado Fábrica | aparecem | não existem lá |

**As peças do Dom Pedro batem exatamente.** A coleta está completa e certa.

As duas diferenças têm causa conhecida:

1. **Receita: o comercial conta BRUTO, antes do desconto do item; a tabela nova
   conta LÍQUIDO.** Nenhum dos dois está errado — são perguntas diferentes. Quem
   for montar o painel da T09 tem de escolher uma e dizer qual.
2. **Agrupamento: `gc_vendas_item` agrupa por DEPÓSITO; a tabela nova agrupa
   pela LOJA do pedido.** Um pedido pode sair de um depósito que não é o da loja
   — por isso o Atacado difere e por isso Loja Shopify e Atacado Fábrica nem
   aparecem lá (não estão entre os canais foco).

⚠️ **Isto precisa estar decidido ANTES da T09.** Dois painéis lendo os mesmos
pedidos e dando números diferentes é como se perde a confiança nos dois — e já
aconteceu aqui, com as conversas do Instagram (12 no gerenciador, 33 na dash).

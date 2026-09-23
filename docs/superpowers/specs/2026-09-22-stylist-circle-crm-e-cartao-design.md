# Stylist Circle — o CRM da jornada e o cartão da convidada

**Data:** 22/09/2026 · **Ação:** desdobramento da T11 do Growth Plan · **Aprovado pelo dono:** 22/09/2026, nas duas partes, na conversa.

Parte da branch `feat/t11-bases-stylist-circle`, que já traz as três bases (Stylists, Eventos, Convidadas) e o placar. Este desenho soma duas peças por cima delas.

---

## Parte 1 — O CRM da jornada da stylist

### O que o dono pediu
"Faltou um CRM para organizar a jornada da stylist, em vez de só selecionar o status." Escolhas dele: **quadro por etapas + histórico de contatos** (sem lista de tarefas nesta rodada); quadro como **aba na mesma tela**; histórico com **canal + resultado + nota**; registrar contato **sugere** a etapa, nunca muda sozinho.

### 1.1 Duas vistas no Stylist Circle: Quadro e Lista
- Um seletor no topo da tela: **Quadro** | **Lista**. A Lista é a tela de hoje, sem perder nada (item 8 do PADRAO-DA-CENTRAL). O quadro abre por padrão; a escolha fica guardada no aparelho.
- **Computador:** uma coluna por etapa do fluxo principal — Prospectado, Contatado, Interessado, Em negociação, Evento agendado e ativado, Evento realizado, Recorrente — e uma coluna **Saídas** recolhida (Sem retorno, Não interessado, Pausado, Inativo), que abre ao tocar.
- **Celular (≤640px):** uma etapa por vez. As etapas viram botões no topo com a contagem ("Contatado · 4"), que quebram em linhas. **Rolagem horizontal da página = 0.**
- A busca e a situação (ativa/desativada) da barra de hoje valem para as duas vistas.

### 1.2 O cartão do quadro
- Nome (sem cortar), código, cidade e loja.
- Próxima ação e prazo. **Atrasada** (prazo antes de hoje) ganha o fundo de atenção do padrão (`color-mix` com `--orange`, texto `--text`).
- Último contato: "último contato há 3 dias" / "nenhum contato registrado".
- Dois botões: **Registrar contato** e **Avançar para [próxima etapa]**.
  - "Avançar" existe **só** nas etapas manuais: Prospectado→Contatado, Contatado→Interessado, Interessado→Em negociação. De Em negociação em diante quem move é o encontro (gatilho da T11); lá o cartão não tem "Avançar".
  - Nas Saídas, o cartão tem **Reabrir**, que devolve para Prospectado (ou para o fato, se ela já teve encontro — mesma regra de `vessel_stylist_editar`).
- Tocar no nome abre a **ficha**.

### 1.3 A ficha
Modal pelas regras do item 4 do padrão (420px no computador; tela cheia com 12px no celular; `dvh`; página atrás travada com `v-trava-rolagem`; pendurado na raiz da tela). Mostra:
1. os dados de hoje (os mesmos da Lista) e o botão **Corrigir…**;
2. **Registrar contato** (o formulário do 1.4);
3. **Histórico**, do mais novo para o mais antigo: data e hora, quem registrou, canal, resultado, nota. Lista vazia diz "Nenhum contato registrado ainda"; erro de leitura diz o erro (item 9 — nunca lista vazia no lugar do erro).

### 1.4 Registrar contato
- **Canal** (um toque): WhatsApp, Ligação, Instagram, E-mail, Presencial.
- **Resultado** (um toque): Sem resposta, Conversou, Demonstrou interesse, Pediu proposta, Marcou encontro, Recusou.
- **Nota** (opcional, até 500 caracteres).
- **Próxima ação e prazo** (opcionais). Preenchidas, substituem a próxima ação de hoje; vazias, a de hoje fica.
- Data, hora e quem registrou entram sozinhos (do login).
- Exige a permissão de **editar** Atendimentos.

### 1.5 A sugestão de etapa
Depois de gravar, se o resultado leva para uma etapa **à frente** da atual, a tela oferece **"Mover para X?"** com um botão; a Ionara decide.

| Resultado | Sugere |
|---|---|
| Conversou | Contatado |
| Demonstrou interesse | Interessado |
| Pediu proposta | Em negociação |
| Recusou | Não interessado |
| Sem resposta · Marcou encontro | nada (o encontro ativa sozinho) |

Nunca sugere para trás; nunca sugere se ela está em Pausado ou Inativo; nunca sugere as etapas que vêm dos encontros. "Recusou" é a exceção que vai para uma Saída, e só se ela ainda não teve encontro.

### 1.6 No placar
Soma **"Contatos até ativar"**: média de contatos registrados antes do primeiro encontro, entre as stylists ativadas no período, com o número de stylists ao lado ("3,4 contatos, média de 5 stylists"). Razão, não proporção.

### 1.7 Banco
- Tabela nova `vessel_stylist_contatos`: `id`, `stylist_id` (FK `vessel_stylists`, `on delete cascade`), `canal` e `resultado` com CHECK de lista fechada, `nota`, `criado_em`, `criado_por` (uuid do login), `criado_por_nome`, `teste`. RLS ligada **sem política**: só as funções abaixo leem e escrevem.
- `vessel_stylist_registrar_contato(p_codigo, p_canal, p_resultado, p_nota, p_proxima_acao, p_proxima_acao_em)` — trava de editar; devolve `{ok, situacao, id, sugestao}` (a sugestão calculada no banco com a tabela do 1.5, e a mesma regra espelhada em JS com teste).
- `vessel_stylist_contatos(p_codigo)` — trava de ver; o histórico.
- `vessel_rastreio_dos_stylists` passa a devolver `contatos` (total) e `ultimo_contato_em`.
- `vessel_placar_do_stylist_circle` ganha `contatos_ate_ativar` e `stylists_com_contatos_ate_ativar`.
- "Avançar" e "Reabrir" usam a `vessel_stylist_editar` que já existe (que já recusa etapa automática e etapa que contradiz o encontro).
- Portas: `revoke from public, anon` + `grant to authenticated` nas duas funções novas.

---

## Parte 2 — O cartão e a mensagem da convidada

### O que o dono pediu
"Um card rápido para as convidadas, tipo Appointment Card": **só um PNG para enviar + mensagem com link rastreado para confirmar presença**. Título **"Private Edit"** e, embaixo, menor, **"Hosted by [anfitriã]"**. Quem envia: **os dois** (a equipe ou a stylist, conforme o encontro).

### 2.1 O link só dela
- Cada convidada ganha `chave_convite` (8 caracteres, sorteada no mesmo alfabeto do encontro, sem O/0/I/1; índice único). Nasce no convite (`vessel_convidar_para_encontro`) e, para as antigas, na primeira vez que o cartão é gerado.
- Endereço: `vesselbrasil.com.br/pe/<chave do encontro>/<chave dela>`. O `/pe/<chave do encontro>` de hoje continua igual, para quem chega pelo link geral.
- A página, com a chave dela: "Olá, **[primeiro nome]**", os dados do encontro, e dois botões — **Confirmar presença** e **Falar com a equipe**. Não pede nome nem WhatsApp. A resposta grava `rsvp` **na cadeira dela**.
- **Rastreio:** a primeira abertura grava `convite_aberto_em`; cada abertura soma `convite_aberturas`. O cartão da convidada na Central mostra "abriu o convite em 23/09" ou "ainda não abriu".
- As duas chaves têm de bater (a da convidada pertence àquele encontro); se não baterem, a página mostra o convite geral, sem nome — a mesma resposta para chave errada e inexistente, para não permitir varredura.
- Encontro cancelado, arquivado ou encerrado: a página diz que o convite não aceita mais resposta, sem nome.
- **Primeiro nome só**, nunca sobrenome, telefone ou e-mail (a página é pública e o link pode ser repassado).
- Consentimento: responder grava a permissão de atendimento, como o RSVP de hoje; a de marketing só se ela marcar.

### 2.2 O PNG
- 1080×1350, desenhado no navegador (canvas), como o Appointment Card. Nada vai para servidor.
- Base do Appointment Card: `fundo.png` e as fontes `vessel-angeletta` e `vessel-versatile(-light)` (woff2 já recortadas e com `:`/`;` já destrocados por `ferramentas/fontes-do-cartao.py` do repositório do site), copiadas para a Central.
- Hierarquia, de cima para baixo: **Private Edit** · *Hosted by [anfitriã]* (menor) · **[nome da convidada]** · data por extenso ("sábado, 10 de outubro") · horário ("19h") · local.
- Nome longo quebra em duas linhas, nunca corta nem encolhe além de um piso; o teste cobre o nome mais comprido da base de exemplo.
- Arquivo baixado: `private-edit_<primeiro-nome>_<AAAA-MM-DD>.png`.

### 2.3 A janela "Cartão e mensagem"
No cartão de cada convidada (Private Edit → Convidadas e presença), para quem tem a permissão de ver Atendimentos (a mesma de marcar convite):
- prévia do PNG;
- **Quem envia:** Equipe Vessel | A stylist (lembra a última escolha por encontro, no aparelho);
- **Equipe:** **Enviar no WhatsApp dela** (abre `wa.me/<telefone dela>` com o texto) · **Compartilhar cartão** (celular, Web Share com o arquivo) ou **Baixar cartão** (computador) · **Copiar mensagem**;
- **Stylist:** **Mandar para a stylist** (abre `wa.me/<telefone da stylist>` com a mensagem pronta para ela repassar) · **Baixar/Compartilhar cartão** · **Copiar mensagem**;
- qualquer um desses gestos marca **Convite enviado** (`vessel_convite_marcar`, já existente).
- Modal pelas regras do item 4 do padrão.

### 2.4 As mensagens (aprovadas pelo dono em 22/09/2026)
**Pela stylist** — W22 do módulo 04, com o link no lugar da pergunta final:
> [nome], estou preparando uma VESSEL Private Edit para um pequeno grupo de clientes. Vou apresentar uma seleção de bolsas sob o meu olhar, com a equipe da VESSEL à disposição. Será em [data], às [horário], em [local]. Gostaria muito de ter você comigo. Confirme sua presença por aqui: [link]

**Pela equipe** — texto novo:
> [nome], a [stylist] está preparando uma VESSEL Private Edit para um pequeno grupo de clientes e gostaria muito de ter você com ela. Será em [data], às [horário], em [local], com uma seleção de bolsas preparada pela [stylist] e a equipe da VESSEL à disposição. Confirme sua presença por aqui: [link]

`[nome]` e `[stylist]` são o **primeiro nome**. ⚠️ As duas mudam o texto do plano (o W22 pedia o link em dois passos); o módulo 12 pede a aprovação do Breno antes do uso externo — registrado aqui, não bloqueia a construção.

### 2.5 Banco
- `vessel_atendimentos` ganha `chave_convite` (único onde não nulo), `convite_aberto_em`, `convite_aberturas int default 0`.
- `vessel_convite_da_convidada(p_chave, p_convidada)` — **anon**; devolve o encontro e o primeiro nome, grava a abertura; limite por origem igual ao do RSVP.
- `vessel_rsvp_da_convidada(p_chave, p_convidada, p_resposta, p_aceite_marketing, p_aceite_versao, p_armadilha)` — **anon**; grava na cadeira dela.
- `vessel_chave_da_convidada(p_id)` — trava de ver; devolve (e cria, se faltar) a chave, para a Central montar o link.
- `vessel_convidadas_do_encontro` passa a devolver `chave_convite`, `convite_aberto_em`, `convite_aberturas`.

### 2.6 Site (repositório `vessel-brasil`)
- Rota nova no `vercel.json`: `/pe/:chave/:convidada` → `/private-edit/index.html`.
- A página lê a segunda parte do endereço; com ela, chama as duas portas novas; sem ela, segue igual.
- Publica por GitHub Actions do repositório do site. Conferir no ar pelo endereço, depois do push.

---

## Como se prova
- Banco: aplicador no molde de `coletor/aplicar-vessel-t11-bases-do-stylist-circle.mjs` — ensaio por padrão, `--gravar` para valer, prova com perfis de mentira dentro de transação desfeita, impressão das tabelas reais igual antes e depois. Casos: permissão (sem sessão, só ver, editar), listas fechadas, sugestão de etapa, chave errada/inexistente com resposta igual, abertura contada, resposta na cadeira certa, encontro fechado.
- Regras puras em JS com teste (sugestão de etapa, colunas do quadro, texto das mensagens, layout do cartão: quebra de nome).
- Telas: fotos a 375 e 1440, claro e escuro, pelo laboratório de rede interceptada; o PNG conferido pela foto.
- Página pública: aberta no site publicado com um encontro de teste.

## Fora desta rodada
Lista de tarefas do dia e lembrete no celular; lembrete automático para quem não abriu o convite; cartão de entrada com QR para a gerente.

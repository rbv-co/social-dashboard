# Config de Usuários — Etapa 2: entender e conceder

Desenho fechado com o dono em **11/08/2026**. Sucessor de
`2026-08-06-config-admin-redesenho-design.md` (a escada de permissões), que está
no ar e **não é revogado por este** — a escada continua sendo como o nível se
escolhe. O que muda é o que a tela **conta** sobre cada nível, e como se dá
acesso a alguém novo.

## O que o dono disse

Ele apontou quatro incômodos, e marcou os quatro:

1. Achar a pessoa e saber o que ela já tem.
2. Entender o que cada permissão faz de verdade.
3. Coisas de naturezas diferentes moram no mesmo lugar.
4. Dar acesso a alguém novo é marcar item por item.

E rejeitou explicitamente a primeira proposta, que escondia o que é igual pra
todo mundo: **"eu ainda gosto de uma visualização de todas as ferramentas, porém
um detalhamento maior do que é cada permissão."**

Isso reposicionou o desenho. O problema não é excesso de linhas — é que **as
linhas não dizem nada**.

## As medições que decidiram (11/08/2026, banco de produção)

Nada aqui foi suposto. Se algum número mudar, é por aqui que a conversa recomeça.

**O acesso tem três faixas, e a tela mostra as três com o mesmo peso:**

| Faixa | Quem tem | Recursos |
|---|---|---|
| Praticamente todos | 80–93% | Redes Sociais, Notícias, Gestão à Vista, Análise de Vendas, Relatório Interativo, Gestor Comercial, Relatórios, Metas |
| Metade | 47–60% | Fábrica, Gestão de Tráfego, Frota, Análise de Campanhas, Colaboradores, Banco |
| Raro | 7–33% | Status do Claude, Aprovar requisição, Patrimônio, Autenticidade |
| Ninguém | 0% | Conteúdo, Escritório 3D, Relatórios do Patrimônio, Relatórios da Frota |

**15 pessoas, 12 formatos de acesso distintos.** Só três pares são idênticos.
O dono classificou isso como **"foi acontecendo, deveria ter padrão"** — não
como diferença intencional.

**O campo `cargo` está vazio em 21 das 26 pessoas.** Os 4 preenchidos
(Suprimentos, Administrativo, Contador, Financeiro) têm uma pessoa cada, menos
Suprimentos com duas — e nenhuma delas tem login. **Consequência que define o
desenho: não existe taxonomia de cargo de onde derivar perfil.** Um desenho que
peça pra classificar 26 pessoas antes de funcionar morre na primeira semana.

**6 dos 15 logins não estão ligados a nenhum cadastro de colaborador.** Foi essa
lacuna que fez o aviso do checklist não chegar em quem tinha login — ver
`2026-08-11` no histórico da Frota. Hoje ela é invisível na tela.

**Correção de um achado meu que estava errado** (11/08/2026): eu havia anotado
que `sales.metas` e `gestor.relatorios` eram invisíveis no editor por não estarem
em `PERMISSION_TREE`. **Não são.** O editor desenha a partir de `RECURSOS`, não da
árvore — `agruparRecursos` agrupa pelo prefixo da chave quando a árvore não
declara o grupo. As duas sempre apareceram e sempre foram revogáveis.

Eu medi a árvore e supus o resto sem ler o caminho até a tela. Fica registrado
porque o erro é instrutivo: **neste projeto, "qual lista manda" é pergunta que se
responde lendo quem itera, não quem parece ser o catálogo.**

O risco real mora na outra lista: chave concedida no banco e ausente de
`RECURSOS` valeria e não teria linha no editor. Hoje não acontece (18 chaves
concedidas, todas presentes) e virou um teste-guarda.

## As decisões

### D1 · Nenhuma ferramenta some da lista
As 24 continuam à vista, sempre. Dobrar, agrupar por poder ou esconder "o que
todo mundo tem" foi **recusado pelo dono**. Não reabrir sem ele.

### D2 · Cada nível diz o que faz, naquela ferramenta, em português
É o coração desta etapa. Hoje "Ver e mexer" aparece com a mesma cara em toda
linha, e significa coisas incomparáveis:

| Ferramenta | "Ver e mexer" significa |
|---|---|
| Frota | Pega e devolve carro, faz o checklist. **Não** cadastra veículo. |
| Gestão de Tráfego | **Muda o orçamento de campanha que está gastando agora** e pausa anúncio no ar. |

Quem concede não tem como saber a diferença sem conhecer a ferramenta por
dentro. A frase precisa dizer **o que a pessoa consegue fazer** e **o que não
consegue** — a segunda metade é a que resolve dúvida.

### D3 · A frase fica sempre visível
Escolha do dono, contra a alternativa de aparecer só ao mexer na linha. A lista
fica mais alta de rolar; em troca, nada exige um clique pra ser entendido.

### D4 · Selo nas que mexem em dinheiro
Escolha do dono, sobre o princípio. **A lista exata ainda precisa do aval dele.**

Certas, porque gastam verba real:
- **Gestão de Tráfego** — muda orçamento de campanha em veiculação.
- **Fábrica de Anúncios** — sobe campanha para a conta de anúncios.

Eu havia incluído **Metas de venda** nesta lista durante a conversa, e está
errado: meta é alvo de faturamento, não gasto — mexer nela não tira dinheiro de
lugar nenhum. Corrigido aqui antes de virar código.

A decidir com o dono: se o selo é só "gasta dinheiro" ou "consequência que não
se desfaz" — no segundo caso entrariam também **Colaboradores e Acessos**
(desliga e apaga pessoa) e **Aprovar requisição** (libera carro). São critérios
diferentes e o selo perde força se misturar os dois.

### D5 · O resumo de uma linha vive na LISTA, não no detalhe
A primeira proposta punha o resumo dentro da pessoa e escondia o detalhe — foi
recusada. O resumo é útil, mas no lugar certo: na lista de pessoas, cada uma tem
uma frase ("Anúncios e Frota · 11 de 24"), pra saber quem é sem abrir. Abrir
mostra as 24, completas.

### D6 · Três naturezas, três abas dentro da pessoa
Hoje é uma janela só. São coisas que quebram de formas diferentes:

- **O que ela abre** — as 24 ferramentas (D1–D4).
- **Avisos no celular** — Vendas, Saldo, Conteúdo, Checklist do carro. **Não é
  permissão**: é se o telefone toca. Misturar as duas foi uma das queixas.
- **Cadastro** — a qual colaborador este login pertence. É aqui que os 6 logins
  sem elo aparecem, em vermelho, em vez de falharem calados.

### D7 · Pessoa nova começa copiando alguém que já está certo
Sem taxonomia de cargo (ver medições), o perfil não tem de onde nascer a não ser
de uma pessoa real. O fluxo é: e-mail → **"começar com o acesso de…"** (uma
pessoa, ou "sem nada") → a tela abre as 24 pra ajustar a exceção → grava.
Quando um jeito se repetir, o dono salva com nome e ele vira perfil.

### D8 · Perfil é VIVO — mexer no perfil muda quem está nele
**Escolha do dono, contra a minha recomendação.** A alternativa era o perfil ser
uma foto do momento, sem propagação. Ele escolheu a propagação, ciente de que
ela dá acesso a várias pessoas de uma vez.

Registrado aqui porque a razão da minha recomendação continua válida e vai
reaparecer: propagação automática é o oposto de
`permissão nasce desmarcada`. D9, D10 e D11 existem para que as duas coisas
convivam.

### D9 · Exceção dada à mão SOBREVIVE à mudança do perfil
O perfil manda no que **ele** cobre. Ferramenta concedida individualmente fica
marcada como exceção e não é apagada quando o perfil muda. Perfil que apaga o
que alguém deu à mão faz o dono perder trabalho sem aviso.

### D10 · Ferramenta nova NUNCA entra num perfil sozinha
Esta é a decisão que impede D8 de furar a regra de que ferramenta nova nasce sem
acesso pra ninguém. Ao subir uma ferramenta, ela nasce **fora de todos os
perfis**. Alguém precisa adicioná-la — e aí vale D11.

Sem D10, subir uma ferramenta daria acesso a 5 pessoas sem ninguém abrir a ficha
de ninguém.

### D11 · Toda mudança de perfil mostra quem será afetado, antes de gravar
Ao alterar um perfil, a tela nomeia as pessoas e diz o que elas passarão a poder
fazer, com Aplicar ou Cancelar. Exemplo validado com o dono:

> Você adicionou **Patrimônio · Ver e mexer** ao perfil "Anúncios".
> **5 pessoas vão receber isto agora:** Raissa Herculano, Gabriel Alves,
> Jeremias Vieira, Humberto Mendonça, Theo Vieira.
> Elas vão poder **editar bens do patrimônio**. Nenhuma delas tem isso hoje.

É o passo que mantém o dono como quem decide, em vez de descobrir depois.

## O que fica de fora

- **Nenhuma mudança no modelo de permissão.** A escada, `PERMISSION_TREE`,
  `permissions{}` e `features[]` seguem como estão. Esta etapa mexe no que a
  tela **conta** e em como se **concede**, não em como se **avalia**.
- **Nenhuma migration de dado.** Ninguém ganha nem perde acesso pela entrega
  deste desenho. Se alguma tela passar a mostrar acesso diferente do que a
  pessoa tem hoje, é defeito, não intenção.
- Preencher o `cargo` das 26 pessoas. É trabalho do dono, e D7 existe justamente
  pra não depender disso.
- Unificar as duas listas concorrentes de lugar (`acessos_organizacoes` ×
  `patrimonio_locais`), que segue pendente da etapa 1.

## O trabalho que só o dono pode fazer

**As frases de D2 precisam ser escritas uma a uma, e eu não sei o que várias
ferramentas fazem por dentro.** Escrever frase errada aqui é pior que não ter
frase: ela vai ser lida como verdade na hora de conceder acesso.

O que eu consigo escrever com base em código lido: Frota, Gestão de Tráfego,
Colaboradores e Acessos, Redes Sociais, Central de Conteúdo, Patrimônio.
As demais precisam de uma passada dele — ou de eu ler cada ferramenta antes.

Isto é item de plano, não de desenho: **nenhuma frase entra na tela sem estar
conferida.**

## Risco conhecido

D8 é a decisão de maior consequência deste documento. O modo de falha é: alguém
edita um perfil achando que mexe numa pessoa e mexe em cinco. D11 é a única
proteção, e por isso **não é opcional na implementação** — se ela for cortada
por prazo, D8 deve ser cortada junto.

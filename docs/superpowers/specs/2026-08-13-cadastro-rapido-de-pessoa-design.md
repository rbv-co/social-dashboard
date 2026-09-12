# Cadastro rápido de colaborador — desenho

Vale para **Patrimônio** e **Frota**. Pedido do dono em 13/08/2026:

> "quando vou cadastrar um patrimônio ou veículo em um colaborador não cadastrado, quero
> que permita eu cadastrar de forma rápida ali na hora só para sair no nome da pessoa
> correta" — e, logo depois: "campos como marca, setor, cargo, também com possibilidade de
> adicionar novos".

É a regra do `+` (já valendo desde 07/08 para marca, local, ambiente e tipo) chegando ao
campo de pessoa. **Isto REVERTE de propósito a exceção escrita naquela época** ("pessoa vem
de outro cadastro, criar gente pelo formulário de patrimônio seria errado"): o dono viu na
prática que a exceção trava quem está cadastrando, e mandou derrubá-la.

## O que foi medido antes de desenhar

Tudo abaixo saiu do banco de produção em 13/08/2026, não de suposição.

| | |
|---|---|
| Colaboradores cadastrados | 28 — sendo 24 ativos |
| Sem cargo preenchido | 23 de 28 |
| Sem marca / sem setor | 16 / 15 |
| Bens com nome solto (`dono_texto`, gente que nunca foi cadastrada) | 12 |
| Setores / marcas / organizações | 14 / 5 / 5 |

**O achado que muda o desenho.** Simulei o login de cada perfil numa transação desfeita
(`rollback`, nada foi escrito). Resultado:

> **Gabriel Alves, Guilherme Cardoso e Jeremias Vieira mexem na Frota e enxergam ZERO
> colaboradores e ZERO setores.** Para os três, o campo "Responsável — de quem é o carro"
> já está vazio hoje, e nenhum `+` na tela resolveria: a lista inteira está fechada para
> eles no banco.

A causa: `acessos_pessoas` e `acessos_setores` só abrem para `is_acessos_admin()` — quem é
admin ou tem a permissão de Colaboradores e Acessos. Dos 8 que mexem na Frota, 5 não têm
essa permissão; 2 deles (Humberto e Raissa) passam por serem admin, e os 3 acima ficam de
fora.

**O molde já existe na casa.** `patrimonio_empresas` tem duas regras — `..._leitura_frota` e
`..._criar_frota` — que deixam quem mexe na Frota ler e criar marca. Foi assim que o mesmo
problema já foi resolvido uma vez. Este desenho segue esse molde, com uma restrição a mais
(ver D3).

## Decisões

### D1 — Um componente só, aplicado em 6 campos

`src/compartilhado/escolha-de-pessoa.vue`, ao lado do `escolha-de-local-e-ambiente.vue` que
já segue esse padrão. O `select` de sempre mais um `+` do lado.

| Tela | Campo |
|---|---|
| Patrimônio | "Com quem está" na ficha do bem |
| Patrimônio | Pessoa na alteração em massa |
| Frota | "Responsável — de quem é o carro" |
| Frota | "Quem vai dirigir" (requisição) |
| Frota | "Quem vai usar" (retirada avulsa) |
| Frota | "Passar para" |

**Fica de fora, de propósito:** o filtro "por pessoa" da lista do Patrimônio. Filtro só
filtra o que existe — criar gente ali não tem sentido nenhum. É a mesma regra que já vale
para os outros `+`.

### D2 — O que a caixinha pede

**Nome** (obrigatório) · **Cargo** · **Marca** · **Setor**. Os três últimos são opcionais:
16 das 28 pessoas de hoje estão sem marca e 15 sem setor, então exigi-los criaria uma
trava nova no lugar da que se está tirando.

- **Marca** e **Setor** são listas, e cada uma ganha o próprio `+` dentro da caixinha.
- **Cargo é texto livre com sugestão** dos cargos que já existem — não vira lista. Não há
  tabela de cargos no sistema, e 23 das 28 pessoas estão sem: uma tabela nasceria com ~5
  valores para manter, sem ganho. Digitar qualquer coisa nova continua valendo.

A pessoa criada **já nasce selecionada** no campo que abriu a caixinha, e nada do que já
estava digitado no formulário do bem ou do carro se perde.

### D3 — Porta estreita: nome sim, contato não

Quem mexe em Patrimônio ou Frota passa a enxergar **id, nome, cargo, situação e o elo com
o login** de cada colaborador — e **só isso**. O que continua fechado é o **contato**
guardado no cadastro de colaboradores: `email_corporativo`, `email_outlook`,
`numero_pessoal`, `numero_corporativo`, `conta_apple` e `avatar_url` seguem invisíveis
para quem não tem Colaboradores e Acessos.

> **Correção de 13/08/2026, medida no banco em produção.** A frase original dizia que
> "e-mail continua invisível", sem recorte, e isso é mais do que este trabalho entrega:
> qualquer pessoa logada JÁ lê as 20 linhas de `profiles`, **inclusive a coluna `email`** —
> que é o e-mail de LOGIN. Isso é anterior a esta branch e não muda com ela: nenhuma
> policy foi afrouxada aqui. Não é o mesmo dado que a porta estreita protege (o contato do
> colaborador), e também não é escândalo — é o e-mail de trabalho de colega, visível a
> colega. Mas fica registrado: **a exposição de `profiles.email` é pré-existente, está
> FORA do escopo deste trabalho, e merece um olhar próprio.**

Foi a escolha do dono entre duas saídas:

| | Custo |
|---|---|
| **Porta estreita** (escolhida) | Mexe no carregamento das duas telas |
| Porta larga (liberar a tabela inteira, igual marca) | Uma linha só no banco, mas Gabriel, Guilherme e Jeremias passariam a ver e-mail e celular de todo mundo |

**Efeito colateral bom, de graça:** a Frota casa o usuário logado com a ficha dele por
`profile_id`. Hoje, para os 3 sem acesso, esse casamento nunca acontece — o checklist deles
grava sem `pessoa_id`. Levar `profile_id` na porta estreita conserta isso junto.

### D4 — Nome repetido não entra

"maria souza", "Maria Souza" e " MARIA SOUZA " são a mesma pessoa. Se já existir, a tela
**usa a que existe e avisa**, em vez de criar a segunda. A comparação ignora maiúsculas e
espaços das pontas.

Isso **não pode ficar só na tela**: a checagem mora na função do banco, que é quem grava.
Duas pessoas cadastrando ao mesmo tempo em janelas diferentes é exatamente o caso que a
tela sozinha não cobre.

`acessos_pessoas.nome` **não** ganha `unique`: a base real pode um dia ter dois homônimos
de verdade, e uma trava dura impediria o cadastro legítimo. A função devolve o existente;
quem insiste em criar o homônimo faz pela tela de Colaboradores, que é o lugar de decidir
isso com calma.

### D5 — Quem pode criar

Quem já pode cadastrar o bem ou o carro. No banco: `is_patrimonio_admin()` **ou**
`is_frota_admin()` **ou** `is_acessos_admin()`. Na tela, o `+` só aparece para quem já
podia editar aquele registro (`patrimonio.criar`/`editar`, `frota.editar`) — os dois
modelos de permissão da casa precisam concordar, senão o botão aparece e o banco recusa.

Criar colaborador **não** é o mesmo que criar login no aplicativo. A pessoa nasce só como
ficha; login continua sendo assunto da tela de Usuários, com a permissão de sempre.

> **Correção de 13/08/2026: o banco é mais largo do que este parágrafo promete.**
> `is_patrimonio_admin()` e `is_frota_admin()` só olham se `profiles.features` contém
> `patrimonio` / `frota` — e `derivar-features.js` deriva essas features de **qualquer**
> permissão que tenha a ação `ver`. Ou seja: quem consegue apenas ABRIR o Patrimônio ou a
> Frota já pode chamar `criar_pessoa_rapida`/`criar_setor_rapido` pela API, enquanto o `+`
> na tela só aparece para quem pode EDITAR. O dono decidiu **deixar como está por
> enquanto** (todo portador é gente da casa, e o estrago possível é uma ficha a mais — sem
> login, sem contato, sem permissão), com a condição de o banco DIZER isso: a diferença
> está escrita nos `comment on function` de
> `db/migrations/2026-08-13-cadastro-rapido-nota-de-escopo.sql`. Apertar de verdade exige
> ensinar ao banco o segundo modelo de permissão (`permissions{}`), que é a Onda 3.

### D6 — A pessoa nasce ativa e mínima

`status = 'ativo'` (é o padrão da tabela). Sem e-mail, sem telefone, sem data de contrato —
a ficha completa se preenche depois, na tela de Colaboradores. O objetivo declarado pelo
dono é "só para sair no nome da pessoa correta".

### D7 — O que este trabalho NÃO faz

- Não cria login no aplicativo.
- Não mexe em ninguém que já está cadastrado.
- Não tira a opção "— outra pessoa, de fora da empresa —" que a Frota já oferece na
  requisição e no "passar para". São coisas diferentes: aquela é para quem **não é** da
  casa; esta é para quem **é** e ainda não foi cadastrado.
- Não mexe nos 12 bens com nome solto. Ligá-los é decisão de quem conhece cada caso, e a
  ficha do bem já avisa e oferece o campo.

### D8 — Sem o `+`, o que muda para os 3 da Frota

Mesmo que ninguém nunca use o `+`, a porta estreita sozinha já conserta o campo
"Responsável" vazio de Gabriel, Guilherme e Jeremias. Isso é metade do valor da entrega e
precisa ser provado separado do resto.

## O banco

Migration `db/migrations/2026-08-13-cadastro-rapido-de-pessoa.sql`. Cinco objetos, todos
`security definer` com `search_path = public`, executáveis só por `authenticated`
(`revoke` de `public` e de `anon`, como já fazem `is_acessos_admin` e as irmãs).

1. **`pode_cadastrar_pessoa_rapida()`** → verdadeiro se `is_acessos_admin()` ou
   `is_patrimonio_admin()` ou `is_frota_admin()`. Uma função só, para a regra não divergir
   entre os quatro lugares que a usam.

2. **`pessoas_para_escolher()`** → `id, nome, status, cargo, profile_id`. Nada de contato
   (D3). Recusa quem não passa em `pode_cadastrar_pessoa_rapida()` — **estourando**, e não
   devolvendo lista vazia: "não tenho acesso" e "não tem ninguém cadastrado" não podem
   chegar iguais na tela.

2b. **`setores_para_escolher()`** → `id, nome`. Pelo mesmo motivo: `acessos_setores` também
   está fechada, e sem ela o campo Setor da caixinha nasceria vazio justamente para quem
   mais precisa dele.

3. **`criar_pessoa_rapida(p_nome, p_cargo, p_marca_id, p_setor_id)`** → devolve a linha
   criada **ou a que já existia**, com um campo dizendo qual dos dois foi (D4). Recusa nome
   vazio ou só espaço. Apara os espaços das pontas antes de gravar.

4. **`criar_setor_rapido(p_nome)`** → mesmo desenho. `acessos_setores.nome` já é `unique`,
   então o "já existia" aqui também evita o erro cru do banco chegar à tela.

**Marca não precisa de função nova:** `patrimonio_empresas` já tem leitura e criação
liberadas para Frota e para Patrimônio, e a tela do Patrimônio já cria marca assim hoje.

**Nenhuma policy de `acessos_pessoas` ou `acessos_setores` é afrouxada.** As tabelas
continuam fechadas como estão; o acesso novo passa inteiro pelas funções acima, que
entregam só o que D3 permite.

## Como se prova

Sem tocar em dado real, sem criar pessoa de teste em produção
(`feedback_nao_mexer_dados_reais`).

1. **Lógica pura, com teste ao lado** — `nova-opcao.js` sai de `patrimonio/` para
   `compartilhado/` (é a mesma regra de nome repetido, e agora tem dois donos); mais a
   função que mescla a lista de nomes com a lista de contatos de quem tem as duas.
2. **Banco, por simulação em transação desfeita** — três logins: Gabriel Alves (Frota, sem
   Colaboradores) passa a enxergar a lista e consegue criar; Cristian (tem tudo) continua
   igual; alguém sem Patrimônio nem Frota nem Acessos é recusado. Tudo dentro de `begin` /
   `rollback`.
3. **Nome repetido** — provado na função, não só na tela: chamar duas vezes com grafias
   diferentes tem de devolver a mesma linha, e a segunda chamada não pode criar nada.
4. **Tela a 375px** — a caixinha aberta dentro do formulário não pode estourar a largura
   nem empurrar o rodapé da ficha para fora. Medida com navegador de verdade, no harness de
   sempre (extrair a marcação real + o CSS escopado com os `:deep(...)` desembrulhados,
   servir por http local).
5. **`npm test` e `npm run build`** — a suíte inteira, não só os testes novos. Teste verde
   não é tela que abre: o guarda de imports esquecidos (`imports.test.mjs`) precisa cobrir
   o componente novo nas duas pastas.

## Ordem do trabalho

| | |
|---|---|
| F1 | Migration + as provas 2 e 3 |
| F2 | Componente compartilhado + `nova-opcao.js` mudando de pasta + prova 1 |
| F3 | Patrimônio: os 2 campos, carregamento pela porta estreita |
| F4 | Frota: os 4 campos, carregamento pela porta estreita mais o casamento por `profile_id` |
| F5 | Prova 4 (375px), prova 5 (suíte e build), subir |

Ver `docs/superpowers/specs/2026-08-03-patrimonio-modulo-proprio-design.md` e
`docs/superpowers/specs/2026-08-04-frota-design.md`.

# "Entrar como" — sessão real de outra pessoa, sem senha

## Por que existe

A Central já tem a "Visão como" (`admin/tela-de-visao-como.vue`): mostra, a
partir da configuração gravada no perfil, quais cards apareceriam pra uma
pessoa. Isso responde "quais painéis ela tem acesso", mas não responde "o que
ela vê DENTRO deles" — porque isso depende de RLS (linha a linha, no banco),
não só da lista de permissões. `allowed_accounts` e `escopo_por_equipe`, por
exemplo, decidem quais contas/lojas aparecem para ela, e isso só se prova
abrindo a tela de verdade, autenticado como ela.

O motivo concreto: validar o acesso da Héllen Cardoso antes dela definir a
própria senha, sem o admin nunca saber ou escolher essa senha.

## O que NÃO é

Não é a "Visão como" (que continua existindo, inalterada, para uma checagem
rápida sem sessão nenhuma). Não abre mão do RLS — a pessoa que entra como
outra enxerga exatamente o que aquela sessão enxergaria, nem mais nem menos,
porque é a mesma sessão que ela teria.

## Arquitetura

```
Admin clica "Entrar como" (tela-de-visao-como.vue)
  -> abre aba em branco (window.open, ANTES do fetch — senão vira popup bloqueado)
  -> POST /functions/v1/entrar-como-usuario  { alvoId }
       [Edge Function, Authorization: Bearer <token do admin>]
       1. anonClient.auth.getUser()                 -> confere quem chama
       2. profiles.select(is_superadmin,disabled) do chamador -> só super-admin, não desativado
       3. profiles.select(email,disabled) do alvo    -> alvo existe, não desativado, != chamador
       4. adminClient.auth.admin.generateLink({type:'magiclink', email: alvoEmail})
       5. anonClient.auth.verifyOtp({token_hash, type:'magiclink'})
            -> { access_token, refresh_token } de uma sessão REAL da pessoa-alvo
       6. adminClient.from('entradas_como_outro_usuario').insert({...})  [auditoria]
       <- { access_token, refresh_token }
  -> aba.location.href = "/?modo=entrar-como#access_token=...&refresh_token=...&type=magiclink"
       [essa é a MESMA forma de link que convite/redefinição de senha já usam —
        o boot do app (ponto-de-partida.js) já sabe consumir isso sozinho,
        via sbClient.auth.getSession()]
  -> conectar-no-banco-de-dados.js detecta ?modo=entrar-como e faz o sbClient
     DESSA aba usar sessionStorage em vez de localStorage
  -> o app sobe normal: carregarPerfil roda com a sessão dela, RLS aplica as
     regras dela, os cards/telas que aparecem são os dela de verdade
  -> moldura-do-aplicativo.vue mostra a faixa fixa "Você está vendo como
     <email dela> — Sair" enquanto sessionStorage tiver a marca ligada
```

## Por que sessionStorage resolve o problema de colisão

O Supabase guarda a sessão em `localStorage`, sob uma chave fixa
(`sb-kounqtdoioootxqegkij-auth-token`) — compartilhada por TODAS as abas da
mesma origem. Se a aba de impersonação usasse o `sbClient` padrão, a sessão
da pessoa-alvo sobrescreveria a sessão do admin em qualquer aba que relesse o
`localStorage` (um F5, por exemplo) — o admin "viraria" a pessoa-alvo sem
pedir.

`sessionStorage` é isolado por aba (mesmo dentro da mesma origem): a aba de
impersonação nunca lê nem escreve o `localStorage` da sessão real do admin.
Fechar a aba apaga a sessão sozinho.

A decisão de qual storage usar é tomada UMA VEZ, na primeira linha que
constrói o `sbClient` (`conectar-no-banco-de-dados.js`), lendo
`?modo=entrar-como` da URL (síncrono, disponível antes de qualquer código do
Supabase rodar) e gravando uma marca em `sessionStorage` para sobreviver a um
F5 daquela mesma aba.

## Componentes

### 1. Migration `db/migrations/2026-09-17-log-de-entrar-como.sql`

Tabela `entradas_como_outro_usuario`:

| coluna | tipo | |
|---|---|---|
| id | uuid, pk, default gen_random_uuid() | |
| admin_id | uuid, not null, references profiles(id) | quem entrou |
| admin_email | text, not null | cópia — sobrevive se o perfil for apagado depois |
| alvo_id | uuid, not null, references profiles(id) | como quem |
| alvo_email | text, not null | idem |
| criado_em | timestamptz, not null, default now() | |

RLS ligado. Uma política de SELECT: `using (public.superadmin_pela_ficha())`
— a MESMA função (baseada na coluna `profiles.is_superadmin`, não na lista de
e-mails de `is_superadmin()`) já usada pela política de `bling_lojas`
(`db/migrations/2026-08-20-grupo-do-canal.sql`), pelo mesmo motivo: é a coluna
que a tela usa. Sem política de INSERT/UPDATE/DELETE para `authenticated` — só
a Edge Function grava, com a chave de serviço, que ignora RLS.

### 2. Edge Function `supabase/functions/entrar-como-usuario/index.ts`

Porte do MESMO padrão de `invite-user/index.ts`: `anonClient` com o
`Authorization` de quem chamou para descobrir e validar quem é (evita confiar
em qualquer dado que o corpo da requisição possa afirmar sobre si mesmo);
`adminClient` com `SUPABASE_SERVICE_ROLE_KEY` para agir.

Corpo esperado: `{ alvoId: string }`.

Recusas (nessa ordem, a primeira que bater):
1. Não autenticado -> erro.
2. Chamador não é `is_superadmin` -> erro ("Apenas super-admin pode entrar
   como outro usuário").
3. `alvoId === chamador.id` -> erro ("Você já é você").
4. Perfil do alvo não existe -> erro.
5. Perfil do alvo tem `disabled = true` -> erro ("Conta desativada — reative
   antes de entrar como ela").

Depois das recusas: `generateLink` (tipo `magiclink`, sem enviar e-mail — a
função admin só GERA o link, quem manda e-mail é outra chamada que não fazemos
aqui) -> `verifyOtp` com o `token_hash` devolvido, usando um cliente com a
chave anônima (a troca de token por sessão é um endpoint público do GoTrue,
não precisa da chave de serviço) -> grava a auditoria -> devolve
`{ access_token, refresh_token, expires_in }` — os três exatamente como
`verifyOtp` devolveu (nunca um `expires_in` chutado no front: o SDK usa esse
valor para calcular quando renovar sozinho, e um valor errado tanto encurta
quanto estica a sessão sem motivo).

Nunca loga os tokens (nem em `console.log`, nem no corpo de erro).

### 3. `src/compartilhado/conectar-no-banco-de-dados.js`

Antes de `createClient`, decide o storage:

```js
function _emModoEntrarComo() {
  try {
    if (new URLSearchParams(window.location.search).get('modo') === 'entrar-como') {
      window.sessionStorage.setItem('modo_entrar_como', '1')
    }
    return window.sessionStorage.getItem('modo_entrar_como') === '1'
  } catch { return false }
}
export const emModoEntrarComo = _emModoEntrarComo()
export const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY,
  emModoEntrarComo ? { auth: { storage: window.sessionStorage } } : undefined)
```

`try/catch` porque este arquivo já é importado pelo teste de
`controle-de-login-e-usuario.test.mjs` com um `window` mínimo, sem
`location`/`sessionStorage` de verdade — sem a guarda, o teste existente
quebra.

### 4. `src/ferramentas/admin/tela-de-visao-como.vue`

Botão "Entrar como (sessão real)" — visualmente separado do resto da tela
(é uma ação bem mais séria que a simulação acima dela), com `confirm()` antes
de qualquer chamada (mesmo padrão do "Excluir" em `tela-de-admin.vue`).

```js
async function entrarComo() {
  if (!confirm(`Entrar como "${pessoa.value.name || pessoa.value.email}"? ...`)) return
  const aba = window.open('', '_blank')
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/entrar-como-usuario`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${estado.currentSession?.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ alvoId: pessoa.value.id }),
    })
    const dados = await r.json()
    if (!r.ok || dados.error) throw new Error(dados.error || 'Falha ao gerar a sessão')
    const hash = `access_token=${dados.access_token}&refresh_token=${dados.refresh_token}&expires_in=${dados.expires_in}&token_type=bearer&type=magiclink`
    if (aba) aba.location.href = `/?modo=entrar-como#${hash}`
  } catch (e) {
    aba?.close()
    erroEntrar.value = e.message || 'Não consegui entrar como essa pessoa.'
  }
}
```

### 5. `src/moldura-do-aplicativo.vue`

Faixa fixa no topo, acima de tudo (mesmo raciocínio de z-index das outras
faixas fixas da moldura), visível em `v-if="emModoEntrarComo"`:

> Você está vendo como **{{ estado.user?.email }}** — [Sair]

`Sair` faz o mesmo que o `sair()` que já existe (signOut + volta pro login),
e tenta `window.close()` primeiro (a aba foi aberta por script, então fecha
sem pedir permissão na maioria dos navegadores).

## Erros e casos de borda

- Front não abriu a aba (bloqueio de popup mesmo com `window.open('','_blank')`
  síncrono) -> mostra o erro na própria tela, não tenta navegar `null`.
- Edge Function falha depois de a aba já estar aberta em branco -> a aba
  recebe `.close()`, nada fica pendurado.
- `generateLink`/`verifyOtp` falha (conta sem e-mail confirmado, rate limit
  do GoTrue) -> erro sobe como veio, sem inventar mensagem.

## Testes

- `entrar-como-usuario`: sem teste de integração (edge function real,
  precisa de Supabase de verdade) — mesma situação de `invite-user`, que
  também não tem. A parte que dá pra testar sem rede (a ordem das recusas)
  fica documentada no próprio arquivo, como o resto das edges deste projeto.
- `conectar-no-banco-de-dados.js`: o teste existente
  (`controle-de-login-e-usuario.test.mjs`) continua passando com o `window`
  mínimo — é a prova de que a guarda não quebrou o boot fora do navegador.
- `todo-vue-compila.test.mjs` cobre a sintaxe dos dois `.vue` tocados.

## Fora do escopo (YAGNI, registrado para não reabrir a discussão)

- Registrar quando a pessoa SAI do modo (só a entrada é auditada).
- Limite de duração da sessão além do que o Supabase já expira sozinho.
- Bloquear "entrar como" outro super-admin (o chamador já tem o mesmo nível
  de confiança).
- Qualquer mudança na "Visão como" existente — continua do jeito que está.

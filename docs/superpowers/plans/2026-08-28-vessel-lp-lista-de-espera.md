# LP VESSEL BRASIL — lista de espera · Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr no ar `vesselbrasil.com.br` com a página de lista de espera da VESSEL BRASIL, levando junto a página do selo `/verify`, numa casa que não tem como servir a Central de Inteligência RBV.

**Architecture:** Repositório e projeto Vercel próprios contendo **apenas o rosto público** — HTML estático, CSS, fotos e módulos de lógica pura. Sem framework, sem etapa de construção, sem segredo. O banco continua sendo o Supabase do iamundi (`kounqtdoioootxqegkij`), acessado só por funções `security definer`; migrations e Edge Functions **continuam morando no iamundi**, junto com as outras 60, porque partir o histórico do banco em dois repositórios é pior do que a assimetria.

**Tech Stack:** HTML/CSS/JS puro (padrão de `public/verify/index.html`) · `node --test` para a lógica pura · Supabase (Postgres + Edge Functions) · Vercel · Bling API v3 · Zoho Sheet API.

**Spec:** `docs/superpowers/specs/2026-08-28-vessel-lp-lista-de-espera-design.md`

## Global Constraints

Valores exatos, copiados da spec e do código que já está no ar. Valem para **todas** as tarefas.

- **Paleta da marca** (de `public/verify/index.html:20-28`, não reinventar):
  `--espresso:#29211C` · `--oliva:#667355` · `--mushroom:#F2EFE6` · `--offwhite:#B7AA9A` · `--fundo:#20261C` (olive noir) · `--fundo-alto:#2A3023` · `--champagne:#C3A36A` · `--marfim:#F4F0E7`
- **Fonte:** Montserrat (200;300;400;500;600) via Google Fonts, com queda para `'Avenir Next','Segoe UI',sans-serif`. Montserrat é a substituta oficial da Versatile, que é paga e não tem licença web.
- **Supabase:** `https://kounqtdoioootxqegkij.supabase.co`. A chave `anon` é pública por desenho e já está em `public/verify/index.html:438` — copiar de lá, nunca gerar outra.
- **Marca:** é **VESSEL BRASIL**. Nunca "La vessel" (é a marca do certificado impresso, papel desatualizado). Instagram `@vessel.brasil`.
- **Produto:** bolsas de **canvas**, não couro. Público **feminino**. Regra de marca inviolável já registrada em `coletor/gestor-comercial.mjs:435`.
- **Nomes de arquivo:** português, kebab-case. Cada pasta ganha `LEIA-ME.txt`.
- **Comentários e mensagens de erro:** português, sem jargão. O código desta casa é lido pelo dono.
- **Responsivo:** funciona a partir de **375px** sem estourar a largura; desktop mantém a composição deslocada do design.
- **Nada de dado real tocado:** cadastros de teste são identificáveis (`@teste.vesselbrasil`) e removidos ao fim.
- **Sem emoji em ícone.** Ícone é SVG.

---

### Task 1: A casa nova, com o `/verify` dentro dela

Primeira tarefa e a maior, de propósito: o entregável é *"o selo da Vessel funciona num servidor onde a Central não existe"*. Repositório, configuração e mudança de casa andam juntos porque nenhum deles é testável sozinho.

**Files:**
- Create: `~/vessel-brasil/` (repositório novo, `rbv-co/vessel-brasil`)
- Create: `~/vessel-brasil/package.json`
- Create: `~/vessel-brasil/vercel.json`
- Create: `~/vessel-brasil/LEIA-ME.txt`
- Create: `~/vessel-brasil/.gitignore`
- Move: `iamundi/public/verify/` → `~/vessel-brasil/verify/` (index.html, regras.js, marca/, fotos/lv1021/)
- Move: `iamundi/src/verify-regras.test.mjs` → `~/vessel-brasil/verify/regras.test.mjs` (com o import corrigido)

**Interfaces:**
- Consumes: nada (é a primeira).
- Produces: a raiz `~/vessel-brasil/` com `verify/regras.js` exportando `normalizarCodigo(texto) → string`, `pecaDaSerie(numero,total) → string`, `mesPorExtenso(iso) → string`, `dataPorExtenso(iso) → string`, `whatsappLimpo(texto) → string`, `whatsappValido(texto) → boolean`. As tarefas 4 e 6 reusam `whatsappLimpo` e `whatsappValido`.

- [ ] **Step 1: Criar o repositório local e a estrutura**

```bash
mkdir -p ~/vessel-brasil && cd ~/vessel-brasil
git init -b main
```

- [ ] **Step 2: Escrever o `package.json`**

Sem dependência nenhuma. Não há construção: o `test` roda direto no Node.

```json
{
  "name": "vessel-brasil",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test '**/*.test.mjs'"
  }
}
```

- [ ] **Step 3: Escrever o `vercel.json`**

A regra de reescrita do `/verify` vem do iamundi. **Não existe regra pega-tudo aqui** — é essa ausência que garante que caminho digitado devolve 404, e não uma tela.

```json
{
  "rewrites": [
    { "source": "/verify/:codigo", "destination": "/verify/index.html" }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Content-Security-Policy", "value": "frame-ancestors 'none'" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" }
      ]
    }
  ]
}
```

**Diferença deliberada em relação ao iamundi:** o `Strict-Transport-Security` sai **sem `preload`**. O `preload` grava nos navegadores, por dois anos, que todo subdomínio de `vesselbrasil.com.br` só abre com cadeado. Como o domínio é novo e ainda não se sabe que subdomínios a marca vai querer, isso é uma decisão de mão única tomada cedo demais. `includeSubDomains` fica; `preload` entra depois, se o dono quiser.

- [ ] **Step 4: Escrever o `.gitignore` e o `LEIA-ME.txt`**

```
node_modules/
.vercel/
.DS_Store
```

`LEIA-ME.txt` — escrito para o dono, não para programador:

```
CASA PÚBLICA DA VESSEL BRASIL
=============================

O que é: as páginas que qualquer pessoa da internet abre em
vesselbrasil.com.br. Duas por enquanto:

  /            → a LP: a página de "entre para a lista"
  /verify/<código> → o selo de autenticidade da bolsa (a tag NFC abre aqui)

POR QUE ISSO NÃO MORA JUNTO COM A CENTRAL
-----------------------------------------
A Central de Inteligência RBV é o painel interno da consultoria. Se as duas
coisas morassem no mesmo servidor, qualquer endereço digitado no domínio da
Vessel poderia abrir o painel da RBV. Aqui isso é impossível, e não por causa
de uma regra: é porque os arquivos do painel NÃO EXISTEM neste servidor.

NÃO GUARDE SEGREDO AQUI
-----------------------
Tudo neste repositório é público por natureza — qualquer visitante baixa. A
única chave que aparece (a "anon" do Supabase) é pública de propósito, e por
si só não lê nada: quem barra é a trava do banco.

ONDE MORA O RESTO
-----------------
Banco (tabelas e funções) e robôs continuam no repositório do iamundi, junto
com as outras migrations. O painel de administração do selo também.
```

- [ ] **Step 5: Mover o `/verify` (o conteúdo, sem alterar)**

```bash
cd ~/vessel-brasil
mkdir -p verify
cp -R ~/iamundi/public/verify/. verify/
ls verify verify/marca verify/fotos/lv1021
```

Esperado: `index.html`, `regras.js`, `LEIA-ME.txt`, `marca/` (logomarca.png, monograma.png, pattern.png) e `fotos/lv1021/` com as 5 fotos.

**A armadilha desta tarefa:** o banco guarda a foto como `fotos/lv1021/1-frente.jpg`, caminho **relativo**, que o navegador resolve contra a URL da página. Servida em `/verify/<código>`, a base é `/verify/`. Por isso as fotos têm de ficar em `verify/fotos/lv1021/` — no mesmo lugar da árvore. Fora dali, o certificado abre bonito e **sem bolsa**, sem erro nenhum na tela.

- [ ] **Step 6: Mover o teste e corrigir o import**

Cria `~/vessel-brasil/verify/regras.test.mjs`, cópia de `~/iamundi/src/verify-regras.test.mjs`, com a linha de import trocada de:

```js
} from '../public/verify/regras.js';
```

para:

```js
} from './regras.js';
```

- [ ] **Step 7: Rodar o teste — tem de passar já**

Run: `cd ~/vessel-brasil && npm test`
Expected: PASS em todos os testes de `verify/regras.test.mjs`. Nenhum código mudou; se falhar, o import está errado.

- [ ] **Step 8: Provar o `/verify` localmente, com foto**

Sem regra da Vercel, a URL bonita não existe na máquina — por isso a página aceita `?c=CÓDIGO`, que existe justamente para isso.

```bash
cd ~/vessel-brasil && python3 -m http.server 8788 &
```

Abrir `http://localhost:8788/verify/index.html?c=K7M4X9QP2R` no navegador de verdade.
Esperado: o certificado da Mônaco / Quartz / LV1021, **com as cinco fotos aparecendo**. Foto faltando = caminho errado, e é exatamente o defeito que o Step 5 avisa.

- [ ] **Step 9: Commit**

```bash
cd ~/vessel-brasil
git add package.json vercel.json .gitignore LEIA-ME.txt verify
git commit -m "Casa pública da Vessel, com o selo /verify dentro"
```

- [ ] **Step 10: Criar o repositório remoto e o projeto Vercel**

```bash
gh repo create rbv-co/vessel-brasil --private --source=. --push
cd ~/vessel-brasil && vercel link --yes
vercel --prod
```

Esperado: uma URL `*.vercel.app`. **Conferir nela**, não no hash local: abrir `<url>/verify/K7M4X9QP2R` e ver o certificado com fotos. Depois abrir `<url>/qualquer-coisa-que-nao-existe` e **exigir 404** — se vier uma tela, a blindagem não existe.

> ⛔ **Nada de domínio ainda.** `vesselbrasil.com.br` só entra na Task 10, depois de Termos e Privacidade existirem. Publicar antes é pôr no ar um formulário que promete páginas inexistentes.

---

### Task 2: As fotos da LP, tiradas do PDF sem perder qualidade

**Files:**
- Create: `~/vessel-brasil/fotos/lp/*.jpg` (7 arquivos)
- Create: `~/vessel-brasil/fotos/LEIA-ME.txt`
- Create: `~/vessel-brasil/ferramentas/extrair-fotos-do-pdf.mjs`

**Interfaces:**
- Consumes: a estrutura da Task 1.
- Produces: os caminhos `fotos/lp/<nome>.jpg` que a Task 6 referencia no HTML.

- [ ] **Step 1: Escrever o extrator**

As 7 imagens do PDF são todas `DCTDecode` — **JPEG puro**. Medido:

```
imagens embutidas: 7 · DCTDecode: 7 · JPXDecode: 0
dimensões: 2477x1858, 2208x1474, 2000x2000, 1595x1063, 1472x983, 1225x817, 1053x1489
```

Isso significa que os bytes entre `stream` e `endstream` **já são um .jpg válido**. Copiar é a extração — não há descompressão, recompressão nem perda. Escrever `ferramentas/extrair-fotos-do-pdf.mjs`:

```js
// Tira as fotos de dentro de um PDF sem mexer num pixel.
//
// POR QUE ISSO FUNCIONA: dentro do PDF, foto guardada com o filtro DCTDecode
// JÁ É um arquivo JPEG inteiro. O PDF só embrulha os bytes. Copiar o miolo do
// embrulho devolve o .jpg original, na resolução original. Se um dia aparecer
// imagem com outro filtro (FlateDecode, JPXDecode), este extrator IGNORA — e
// deve mesmo: essas precisariam ser remontadas, e remontar é perder.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

export function jpegsDoPdf(bytes) {
  const achados = [];
  const marca = Buffer.from('stream');
  for (let i = 0; i < bytes.length - 6; i++) {
    if (!bytes.slice(i, i + 6).equals(marca)) continue;
    // O cabeçalho do objeto vem ANTES do "stream". Só interessa se for DCTDecode.
    const cabecalho = bytes.slice(Math.max(0, i - 700), i).toString('latin1');
    if (!cabecalho.includes('DCTDecode')) continue;
    let ini = i + 6;
    while (bytes[ini] === 0x0d || bytes[ini] === 0x0a) ini++;
    // Todo JPEG começa com FF D8 e termina com FF D9. Achar o fim é mais
    // confiável do que ler /Length, que pode ser uma referência indireta.
    if (bytes[ini] !== 0xff || bytes[ini + 1] !== 0xd8) continue;
    let fim = ini + 2;
    while (fim < bytes.length - 1 && !(bytes[fim] === 0xff && bytes[fim + 1] === 0xd9)) fim++;
    achados.push(bytes.slice(ini, fim + 2));
    i = fim;
  }
  return achados;
}

if (process.argv[2]) {
  const fotos = jpegsDoPdf(readFileSync(process.argv[2]));
  mkdirSync('fotos/lp', { recursive: true });
  fotos.forEach((b, i) => {
    const nome = `fotos/lp/bruta-${String(i + 1).padStart(2, '0')}.jpg`;
    writeFileSync(nome, b);
    console.log(nome, b.length, 'bytes');
  });
  console.log(`\n${fotos.length} fotos extraídas.`);
}
```

- [ ] **Step 2: Rodar o extrator**

Run: `cd ~/vessel-brasil && node ferramentas/extrair-fotos-do-pdf.mjs "$HOME/Downloads/Vessel - LP.pdf"`
Expected: **7 arquivos** em `fotos/lp/`, e a soma dos bytes na mesma ordem de grandeza dos 4,3 MB do PDF.

- [ ] **Step 3: Conferir que são JPEG de verdade e ver as dimensões**

```bash
cd ~/vessel-brasil && for f in fotos/lp/*.jpg; do
  echo "$f → $(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | tail -2 | tr -d ' \n')"
done
```

Expected: sete linhas com largura e altura reais. Arquivo que o `sips` não lê não é JPEG e o extrator errou.

- [ ] **Step 4: Fixar o CONTRATO DE NOMES (decisão do dono, 28/08)**

As fotos extraídas são **provisórias**. O dono entrega até **domingo, 31/08/2026**, uma pasta com as definitivas **já nomeadas com estes mesmos nomes** — a troca é substituir arquivo por arquivo, sem tocar em uma linha de HTML.

Por isso o nome é o entregável desta tarefa, não a foto. Os sete, fixos:

| Arquivo | Onde entra | Enquadramento que o design pede |
|---|---|---|
| `heroi.jpg` | bloco 1, fundo do herói | vertical/quadrada, mulher, P&B, espaço escuro à esquerda para o título |
| `narrativa-bolsa.jpg` | bloco 2, canto inferior esquerdo | bolsa em detalhe, na mão |
| `vessel-ferragem.jpg` | bloco 3, à direita | mãos trabalhando a ferragem — feitura |
| `colecao-01-marea.jpg` | bloco 4, foto da esquerda | peça VESSEL 01 / MAREA |
| `colecao-02-lunea.jpg` | bloco 4, foto maior | peça VESSEL 02 / LUNEA |
| `codes-alcas.jpg` | bloco 5, foto grande | detalhe de alça/estrutura |
| `codes-textura.jpg` | bloco 5, foto menor | textura do canvas, vertical |

Abrir cada extraída, comparar com o PDF e renomear para o nome da tabela. Se uma das sete não for foto do design (o objeto de 2000x2000 pode ser logotipo), **apagar** e cobrir o buraco com outra do próprio PDF, para não faltar nome.

**Fonte das provisórias: o próprio PDF do design.** Não baixar foto de banco de imagem — são fotos de terceiro, com licença que ninguém conferiu, num site que vai ao ar com a marca da cliente. As do PDF são da própria marca.

- [ ] **Step 5: Escrever `fotos/LEIA-ME.txt`**

```
FOTOS DA LP
===========
Saíram de dentro do arquivo "Vessel - LP.pdf" (o design), pela ferramenta
ferramentas/extrair-fotos-do-pdf.mjs. Não foram reprocessadas: são os mesmos
bytes que estavam no PDF, na resolução original.

Se um dia chegarem as fotos originais do fotógrafo, troque os arquivos
mantendo os MESMOS NOMES e nada mais precisa mudar.
```

- [ ] **Step 6: Commit**

```bash
cd ~/vessel-brasil
git add ferramentas/extrair-fotos-do-pdf.mjs fotos
git commit -m "Fotos da LP extraídas do PDF do design, sem reprocessar"
```

---

### Task 3: As regras da lista (lógica pura, TDD)

Tudo o que é decisão — e-mail serve? WhatsApp serve? como o nome fica? — sai do HTML e vira módulo testável, no mesmo padrão de `verify/regras.js`.

**Files:**
- Create: `~/vessel-brasil/regras-da-lista.mjs`
- Test: `~/vessel-brasil/regras-da-lista.test.mjs`

**Interfaces:**
- Consumes: `whatsappLimpo`, `whatsappValido` de `verify/regras.js` (Task 1).
- Produces: `emailValido(texto) → boolean` · `nomeLimpo(texto) → string` · `cadastroValido({nome,email,whatsapp}) → {ok:boolean, erro:string|null}`. A Task 6 chama `cadastroValido` antes de enviar.

- [ ] **Step 1: Escrever os testes que falham**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { emailValido, nomeLimpo, cadastroValido } from './regras-da-lista.mjs';

test('emailValido: aceita o que é e-mail', () => {
  assert.equal(emailValido('ana@gmail.com'), true);
  assert.equal(emailValido('ana.maria+lista@empresa.com.br'), true);
});

test('emailValido: recusa o que não é', () => {
  for (const ruim of ['', 'ana', 'ana@', '@gmail.com', 'ana @gmail.com', 'ana@gmail']) {
    assert.equal(emailValido(ruim), false, `devia recusar: ${JSON.stringify(ruim)}`);
  }
});

test('nomeLimpo: tira espaço sobrando e não deixa o nome virar grito', () => {
  assert.equal(nomeLimpo('  ana   maria  '), 'ana maria');
});

test('nomeLimpo: preserva acento e apóstrofo, que são nome de gente', () => {
  assert.equal(nomeLimpo("  Maria D'Ávila  "), "Maria D'Ávila");
});

test('cadastroValido: os três campos certos passam', () => {
  const r = cadastroValido({ nome: 'Ana Maria', email: 'ana@gmail.com', whatsapp: '(19) 99617-0272' });
  assert.deepEqual(r, { ok: true, erro: null });
});

test('cadastroValido: a mensagem de erro é em português e diz o que fazer', () => {
  // Quem lê isso é a cliente, na tela. "invalid input" não serve.
  assert.equal(cadastroValido({ nome: '', email: 'ana@gmail.com', whatsapp: '19996170272' }).erro,
    'Preencha seu nome.');
  assert.equal(cadastroValido({ nome: 'Ana', email: 'ana', whatsapp: '19996170272' }).erro,
    'Confira o e-mail: parece que falta alguma coisa.');
  assert.equal(cadastroValido({ nome: 'Ana', email: 'ana@gmail.com', whatsapp: '123' }).erro,
    'Confira o WhatsApp: use DDD + número.');
});

test('cadastroValido: reclama de UM problema por vez, o primeiro', () => {
  // Despejar três erros de uma vez na tela faz a pessoa desistir.
  assert.equal(cadastroValido({ nome: '', email: 'x', whatsapp: '1' }).erro, 'Preencha seu nome.');
});

test('cadastroValido: nome só de espaço é nome vazio', () => {
  assert.equal(cadastroValido({ nome: '   ', email: 'ana@gmail.com', whatsapp: '19996170272' }).ok, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd ~/vessel-brasil && node --test regras-da-lista.test.mjs`
Expected: FAIL — `Cannot find module './regras-da-lista.mjs'`.

- [ ] **Step 3: Escrever o mínimo que faz passar**

```js
// As decisões da lista de espera, longe do HTML — assim dá pra testar sem
// abrir navegador. Mesmo desenho de verify/regras.js.
import { whatsappValido } from './verify/regras.js';

// Deliberadamente frouxa: e-mail de verdade só se prova mandando mensagem, e
// regex esperta recusa endereço válido e estranho. Aqui só barra o erro de
// digitação óbvio — algo antes do @, algo depois, e um ponto no domínio.
export function emailValido(texto) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(texto || '').trim());
}

export function nomeLimpo(texto) {
  return String(texto || '').trim().replace(/\s+/g, ' ');
}

export function cadastroValido({ nome, email, whatsapp }) {
  if (!nomeLimpo(nome)) return { ok: false, erro: 'Preencha seu nome.' };
  if (!emailValido(email)) return { ok: false, erro: 'Confira o e-mail: parece que falta alguma coisa.' };
  if (!whatsappValido(whatsapp)) return { ok: false, erro: 'Confira o WhatsApp: use DDD + número.' };
  return { ok: true, erro: null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd ~/vessel-brasil && npm test`
Expected: PASS em tudo — os testes novos e os do `/verify` que vieram na Task 1.

- [ ] **Step 5: Commit**

```bash
cd ~/vessel-brasil
git add regras-da-lista.mjs regras-da-lista.test.mjs
git commit -m "Regras da lista de espera, com teste"
```

---

### Task 4: A tabela e a função fechada

Mora no **iamundi** (`~/iamundi-worktrees/vessel-lp`), junto com as outras migrations.

**Files:**
- Create: `iamundi/db/migrations/2026-08-28-vessel-lista-de-espera.sql`
- Create: `iamundi/docs/provar-lista-de-espera.sql`

**Interfaces:**
- Consumes: nada do código anterior.
- Produces: a função `public.vessel_entrar_na_lista(p_nome text, p_email text, p_whatsapp text, p_aceite_versao text, p_armadilha text)` devolvendo `json` no formato `{"ok": true}`. A Task 6 chama por `POST /rest/v1/rpc/vessel_entrar_na_lista`. Tabela `public.vessel_lista_espera`, lida pelo robô da Task 8.

- [ ] **Step 1: Escrever a migration**

```sql
-- LISTA DE ESPERA DA VESSEL BRASIL
--
-- Mesmo desenho de vessel_pecas e por que: a chave anônima está dentro do HTML
-- de uma página pública. Com leitura direta, qualquer pessoa baixaria a lista
-- de nomes, e-mails e telefones. Por isso: RLS ligada e ZERO política. Tudo
-- passa pela função abaixo, que é a única porta.

create table if not exists public.vessel_lista_espera (
  id             bigserial primary key,
  nome           text not null,
  email          text not null,
  whatsapp       text not null,
  origem         text not null default 'lp-vesselbrasil',
  ip_hash        text,
  aceite_em      timestamptz not null default now(),
  aceite_versao  text not null,
  criado_em      timestamptz not null default now(),
  -- estado de cada espelho, preenchido pelo robô (nunca pela página)
  bling_id       text,
  bling_em       timestamptz,
  planilha_em    timestamptz,
  ultimo_erro    text
);

-- Quem se cadastrar duas vezes não vira duas linhas.
create unique index if not exists vessel_lista_espera_email_idx
  on public.vessel_lista_espera (lower(email));

-- O robô procura o que ainda não espelhou. Índice parcial: só as pendentes.
create index if not exists vessel_lista_espera_pendente_bling_idx
  on public.vessel_lista_espera (criado_em) where bling_em is null;
create index if not exists vessel_lista_espera_pendente_planilha_idx
  on public.vessel_lista_espera (criado_em) where planilha_em is null;

alter table public.vessel_lista_espera enable row level security;
-- Nenhuma policy, de propósito. Ver o comentário do topo.

comment on table public.vessel_lista_espera is
  'Lista de espera da LP vesselbrasil.com.br. RLS ligada e SEM política: só a '
  'função vessel_entrar_na_lista escreve, e ninguém lê pela API pública.';

create or replace function public.vessel_entrar_na_lista(
  p_nome          text,
  p_email         text,
  p_whatsapp      text,
  p_aceite_versao text,
  p_armadilha     text default null
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cab     json := nullif(current_setting('request.headers', true), '')::json;
  v_ip      text;
  v_recentes int;
begin
  -- O CAMPO-ARMADILHA. Um campo invisível que gente não vê e robô preenche.
  -- Responde sucesso e não grava: o robô não descobre que foi barrado e não
  -- volta com outra estratégia.
  if coalesce(trim(p_armadilha), '') <> '' then
    return json_build_object('ok', true);
  end if;

  if coalesce(trim(p_nome), '') = ''
     or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
     or length(regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g')) not in (10, 11)
  then
    return json_build_object('ok', false, 'erro', 'Confira os campos e tente de novo.');
  end if;

  -- IP só como hash, nunca cru — mesmo padrão de vessel_registrar, e é o que
  -- a LGPD pede. O digest vem QUALIFICADO: pgcrypto mora no schema
  -- extensions, e sem o prefixo a função quebra com search_path = public.
  v_ip := encode(
    extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'),
    'hex');

  select count(*) into v_recentes
    from public.vessel_lista_espera
   where ip_hash = v_ip and criado_em > now() - interval '1 hour';

  -- Teto de 5 por hora por origem. Estourado, responde sucesso e não grava,
  -- pelo mesmo motivo da armadilha.
  if v_recentes >= 5 then
    return json_build_object('ok', true);
  end if;

  insert into public.vessel_lista_espera (nome, email, whatsapp, ip_hash, aceite_versao)
  values (trim(p_nome), lower(trim(p_email)), trim(p_whatsapp), v_ip, p_aceite_versao)
  on conflict (lower(email)) do nothing;
  -- E-mail repetido cai aqui e responde sucesso SEM dizer que já existia.
  -- Dizer transformaria a página num verificador de "fulana está na lista?".

  return json_build_object('ok', true);
end;
$$;

revoke all on function public.vessel_entrar_na_lista(text, text, text, text, text) from public;
grant execute on function public.vessel_entrar_na_lista(text, text, text, text, text) to anon, authenticated;
```

- [ ] **Step 2: Aplicar a migration**

Migration nova vai pelo MCP do Supabase (`apply_migration`), nome `2026-08-28-vessel-lista-de-espera`.

- [ ] **Step 3: Escrever a prova permanente**

`iamundi/docs/provar-lista-de-espera.sql` — roda dentro de uma transação que **volta atrás**, para provar sem sujar dado real:

```sql
-- Prova da lista de espera. Roda inteiro e desfaz: não deixa linha para trás.
begin;

-- 1. A trava está ligada e não há política nenhuma.
select 'rls ligada' as prova,
       relrowsecurity as resultado
  from pg_class where relname = 'vessel_lista_espera';
select 'politicas (tem de ser 0)' as prova,
       count(*)::text as resultado
  from pg_policies where tablename = 'vessel_lista_espera';

-- 2. Um cadastro bom entra.
select 'cadastro bom' as prova,
       public.vessel_entrar_na_lista('Ana Teste', 'ana@teste.vesselbrasil', '19996170272', 'v1')::text;
select 'gravou 1 linha' as prova, count(*)::text
  from public.vessel_lista_espera where email = 'ana@teste.vesselbrasil';

-- 3. O MESMO e-mail não cria segunda linha.
select public.vessel_entrar_na_lista('Ana De Novo', 'ana@teste.vesselbrasil', '19996170272', 'v1');
select 'e-mail repetido continua 1 linha' as prova, count(*)::text
  from public.vessel_lista_espera where email = 'ana@teste.vesselbrasil';

-- 4. A armadilha barra e NÃO grava.
select public.vessel_entrar_na_lista('Robo', 'robo@teste.vesselbrasil', '19996170272', 'v1', 'sou-robo');
select 'armadilha nao gravou (tem de ser 0)' as prova, count(*)::text
  from public.vessel_lista_espera where email = 'robo@teste.vesselbrasil';

-- 5. O IP nunca foi gravado cru.
select 'ip guardado como hash de 64' as prova,
       (length(ip_hash) = 64)::text
  from public.vessel_lista_espera where email = 'ana@teste.vesselbrasil';

rollback;
```

- [ ] **Step 4: Rodar a prova**

Executar o arquivo inteiro. Esperado, em ordem: `rls ligada = t` · `politicas = 0` · `cadastro bom = {"ok":true}` · `gravou = 1` · `e-mail repetido = 1` · `armadilha = 0` · `hash de 64 = t`.

Qualquer linha diferente disso **para a tarefa** — não seguir para a próxima.

- [ ] **Step 5: Provar de fora, com a chave pública, que a tabela é cega**

```bash
KEY=$(grep -o -E "eyJ[A-Za-z0-9_.-]{40,}" ~/vessel-brasil/verify/index.html | head -1)
curl -sS "https://kounqtdoioootxqegkij.supabase.co/rest/v1/vessel_lista_espera?select=*" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: `[]`. Qualquer outra coisa significa que vazou nome, e-mail e telefone de gente.

- [ ] **Step 6: Commit (no worktree do iamundi)**

```bash
cd ~/iamundi-worktrees/vessel-lp
git add db/migrations/2026-08-28-vessel-lista-de-espera.sql docs/provar-lista-de-espera.sql
git commit -m "Tabela e funcao fechada da lista de espera, com prova por rollback"
```

---

### Task 5: A página, os sete blocos

**Files:**
- Create: `~/vessel-brasil/index.html`

**Interfaces:**
- Consumes: `fotos/lp/*.jpg` (Task 2), a paleta e a fonte das Global Constraints, `verify/marca/logomarca.png` (Task 1).
- Produces: os `id` de âncora `#narrativa`, `#a-vessel`, `#colecao`, `#acesso-privado`, e os campos `#nome`, `#email`, `#whatsapp`, `#empresa` (a armadilha) e `#erro`, que a Task 6 liga.

- [ ] **Step 1: Escrever o esqueleto e os tokens**

Arquivo único, sem construção. O cabeçalho, na íntegra:

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>VESSEL BRASIL</title>
<meta name="description" content="Para mulheres que carregam mais.">
<meta property="og:title" content="VESSEL BRASIL">
<meta property="og:description" content="Para mulheres que carregam mais.">
<meta property="og:image" content="/fotos/lp/heroi.jpg">
<link rel="icon" href="/verify/marca/monograma.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@200;300;400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --espresso:#29211C;   /* Espresso Profundo — Pantone Black 4 C */
  --oliva:#667355;      /* Verde Oliva — Pantone 5605 UP */
  --mushroom:#F2EFE6;   /* Mushroom Beige — Pantone 7527 UP */
  --offwhite:#B7AA9A;   /* Off White Quente — Pantone 7530 UP */
  --fundo:#20261C;      /* olive noir */
  --fundo-alto:#2A3023; /* variacao tonal */
  --champagne:#C3A36A;
  --marfim:#F4F0E7;
}
*{box-sizing:border-box}
html,body{margin:0;max-width:100%;overflow-x:hidden}
body{
  background:var(--mushroom); color:var(--espresso);
  font-family:Montserrat,'Avenir Next','Segoe UI',sans-serif;
  font-weight:300; line-height:1.6;
}
img{max-width:100%;display:block}
</style>
</head>
```

O `overflow-x:hidden` com `max-width:100%` no `html` e no `body` é o que segura a promessa dos 375px: bloco deslocado que passa da borda **rola a página inteira de lado** no celular, e é o defeito mais comum desse tipo de composição.

O texto vem **palavra por palavra** do design, já extraído:

| Bloco | Rótulo | Título | Apoio |
|---|---|---|---|
| 1 Herói | — | `Para mulheres que carregam mais.` | `Presença para acompanhar o que importa — sem dizer uma palavra além do necessário.` + botão `CONHEÇA A VESSEL` |
| 2 | `— A NARRATIVA` | `Presença não se anuncia.` | os três parágrafos I, II, III (abaixo) |
| 3 | `— A VESSEL` | `Uma marca brasileira criada para acompanhar mulheres em movimento.` | `Formas essenciais. Materiais nobres.` / `Detalhes que revelam intenção.` |
| 4 | `— A COLEÇÃO` | `The Vessel Collection.` | `Formas que acompanham diferentes ritmos, momentos e maneiras de estar.` — legendas `VESSEL 01 / MAREA` e `VESSEL 02 / LUNEA` |
| 5 | `— A COLEÇÃO` | `Design codes.` | `O que fica quando tudo mais passa.` / `Formas estruturadas. Curvas inesperadas. Assimetrias sutis. Ferragens como joias. Branding silencioso.` / `RECOGNIZABLE BY DESIGN. NOT BY LOGOS.` |
| 6 | `— ACESSO PRIVADO` | `Entre para o Universo Vessel.` | `Receba em primeira mão lançamentos, experiências e convites exclusivos da Vessel.` |

Os três do bloco 2, na íntegra:

> **I** — A Vessel nasce do olhar para o essencial: uma bolsa não para completar uma imagem, mas para sustentar uma jornada.
> **II** — Na curadoria, cada linha, toque e fechamento é observado pelo que permanece quando a tendência passa.
> **III** — O resultado é uma presença serena — feita para quem reconhece intenção nos detalhes e escolhe levar apenas o que tem significado.

- [ ] **Step 2: Topo e rodapé**

Topo: `logomarca.png`, e os links `NARRATIVA` → `#narrativa`, `A VESSEL` → `#a-vessel`, `COLEÇÃO` → `#colecao`, e o botão `ACESSO PRIVADO` → `#acesso-privado`. **Todos são âncora na própria página** — não há navegação. O botão `CONHEÇA A VESSEL` do herói também é âncora, para `#narrativa`.

Rodapé: logomarca, ícones de rede em **SVG** (nunca emoji) apontando para `instagram.com/vessel.brasil`, `© 2026 / VESSEL`, e os links `PRIVACIDADE` → `/privacidade`, `TERMOS` → `/termos`, `CONTATO` → `mailto:sac@lavessel.com.br`.

- [ ] **Step 3: O formulário (marcação, ainda sem enviar)**

```html
<form id="formulario" novalidate>
  <label for="nome">NOME</label>
  <input id="nome" name="nome" type="text" autocomplete="name" required>

  <label for="email">E-MAIL</label>
  <input id="email" name="email" type="email" autocomplete="email" required>

  <label for="whatsapp">WHATSAPP</label>
  <input id="whatsapp" name="whatsapp" type="tel" autocomplete="tel" required>

  <!-- O CAMPO-ARMADILHA. Fica fora da tela e fora da ordem do Tab: gente não
       vê e não tabula até ele; robô que preenche tudo, preenche. Não usar
       display:none — leitor de tela ignora, mas robô também. -->
  <div aria-hidden="true" style="position:absolute;left:-9999px;top:auto;
       width:1px;height:1px;overflow:hidden">
    <label for="empresa">Empresa</label>
    <input id="empresa" name="empresa" type="text" tabindex="-1" autocomplete="off">
  </div>

  <button type="submit" id="enviar">ENTRAR PARA A LISTA <span aria-hidden="true">→</span></button>
  <p id="erro" role="alert" hidden></p>
  <p class="legal">Ao continuar, você concorda com nossos
    <a href="/termos">Termos de Uso</a> e <a href="/privacidade">Política de Privacidade</a>.</p>
</form>
```

- [ ] **Step 4: Medir a 375px e no desktop, no navegador de verdade**

```bash
cd ~/vessel-brasil && python3 -m http.server 8788 &
```

Abrir `http://localhost:8788/`, e conferir **na tela**, não no código:
1. a 375px de largura, **nada** estoura para os lados (a página não rola na horizontal);
2. no desktop, a composição deslocada do design está de pé;
3. os quatro links do topo pulam para o bloco certo;
4. o contraste do texto sobre o verde escuro e sobre o Mushroom está legível.

- [ ] **Step 5: Commit**

```bash
cd ~/vessel-brasil && git add index.html && git commit -m "A LP: os sete blocos do design"
```

---

### Task 6: Ligar o formulário no banco

**Files:**
- Modify: `~/vessel-brasil/index.html` (só o `<script type="module">` do fim)

**Interfaces:**
- Consumes: `cadastroValido` de `regras-da-lista.mjs` (Task 3); a função `vessel_entrar_na_lista` (Task 4); os `id` da Task 5.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Escrever o script**

```html
<script type="module">
import { cadastroValido } from './regras-da-lista.mjs';

const SUPABASE = 'https://kounqtdoioootxqegkij.supabase.co';
// A MESMA chave anônima de verify/index.html:438. Copiar de lá, não gerar
// outra: é pública por desenho, e sozinha não lê nada (quem barra é a trava).
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';

// A VERSÃO DO TEXTO QUE A PESSOA ACEITOU. Sobe de v1 para v2 SEMPRE que os
// Termos ou a Política mudarem — sem isso o consentimento guardado não prova
// nada, porque não dá pra saber com o que ela concordou.
const VERSAO_DO_ACEITE = 'v1';

const $ = (id) => document.getElementById(id);
const form = $('formulario'), erro = $('erro'), botao = $('enviar');

function mostrarErro(texto){ erro.textContent = texto; erro.hidden = false; }

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  erro.hidden = true;

  const dados = {
    nome: $('nome').value, email: $('email').value, whatsapp: $('whatsapp').value,
  };
  const check = cadastroValido(dados);
  if (!check.ok) { mostrarErro(check.erro); return; }

  botao.disabled = true;
  botao.textContent = 'ENVIANDO…';
  try {
    const r = await fetch(`${SUPABASE}/rest/v1/rpc/vessel_entrar_na_lista`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_nome: dados.nome, p_email: dados.email, p_whatsapp: dados.whatsapp,
        p_aceite_versao: VERSAO_DO_ACEITE, p_armadilha: $('empresa').value,
      }),
    });
    if (!r.ok) throw new Error('rpc ' + r.status);
    const resposta = await r.json();
    if (resposta && resposta.ok === false) { mostrarErro(resposta.erro); return; }
    // Trocar o formulário pelo agradecimento, em vez de mostrar um aviso ao
    // lado: some o botão, então ninguém envia duas vezes por ansiedade.
    form.innerHTML =
      '<p class="obrigado">Pronto. Você está na lista.<br>' +
      'Vamos avisar em primeira mão.</p>';
  } catch (e) {
    // Nunca mostrar o erro técnico pra cliente. E NÃO dizer "tente de novo"
    // sem dar saída: o WhatsApp do SAC é a saída.
    mostrarErro('Não conseguimos enviar agora. Tente de novo em instantes.');
  } finally {
    botao.disabled = false;
    botao.textContent = 'ENTRAR PARA A LISTA →';
  }
});
</script>
```

- [ ] **Step 2: Provar o caminho de sucesso, no navegador de verdade**

Com o servidor local de pé, preencher `Ana Teste` / `ana@teste.vesselbrasil` / `(19) 99617-0272` e enviar.
Esperado na tela: o formulário some e aparece **"Pronto. Você está na lista."**

- [ ] **Step 3: Provar que gravou de verdade — a prova tem de MUDAR o valor**

```sql
select nome, email, aceite_versao, length(ip_hash) as tam_hash, criado_em
  from public.vessel_lista_espera where email = 'ana@teste.vesselbrasil';
```

Expected: **uma** linha, `aceite_versao = 'v1'`, `tam_hash = 64`.

- [ ] **Step 4: Provar os três recuos**

1. enviar com nome vazio → aparece `Preencha seu nome.` e **nada** vai para a rede;
2. enviar o mesmo e-mail de novo → tela de agradecimento, e a consulta acima continua com **1** linha;
3. preencher o campo escondido `empresa` pelo console (`document.getElementById('empresa').value='robo'`) com um e-mail novo → tela de agradecimento, e `select count(*) ... where email='<o novo>'` devolve **0**.

- [ ] **Step 5: Limpar o cadastro de teste**

```sql
delete from public.vessel_lista_espera where email like '%@teste.vesselbrasil';
```

- [ ] **Step 6: Commit**

```bash
cd ~/vessel-brasil && git add index.html && git commit -m "Formulario ligado na funcao fechada"
```

---

### Task 7: Termos de Uso e Política de Privacidade

⛔ **Esta tarefa trava o lançamento.** O formulário já promete as duas páginas. Publicar sem elas é prometer o que não existe, e a LGPD exige a política quando se coleta nome, e-mail e telefone.

**Files:**
- Create: `~/vessel-brasil/termos/index.html`
- Create: `~/vessel-brasil/privacidade/index.html`

**Interfaces:**
- Consumes: a paleta e a fonte das Global Constraints.
- Produces: as rotas `/termos` e `/privacidade`, apontadas pela Task 5.

- [ ] **Step 1: Escrever os dois textos (decisão do dono, 28/08)**

O dono pediu que eu escrevesse. **Ressalva registrada uma vez e não repetida:** o texto vai ser honesto, específico e cobrir o que a LGPD exige, mas **não é texto revisado por advogado** — vale mandar alguém olhar antes de a lista crescer.

A Política diz, no mínimo e sem enrolação:
- **quais dados**: nome, e-mail, WhatsApp, e a data do aceite;
- **o que NÃO é coletado**: o IP é guardado só como código embaralhado, e não dá pra voltar atrás;
- **para quê**: avisar sobre lançamentos e convites da marca. Nada mais;
- **com quem são compartilhados, pelo nome**: **Bling** (sistema de gestão) e **Zoho** (planilha e e-mail). Dizer o nome, não "parceiros";
- **por quanto tempo**: até a pessoa pedir para sair;
- **como sair**: escrever para `sac@lavessel.com.br` (conferido em lavessel.com.br/pages/contato) ou responder qualquer mensagem. Saída em até 7 dias;
- **quem é o responsável**: LAVESSEL INDÚSTRIA E COMÉRCIO DE BOLSAS, CNPJ 53.242.015/0001-22.

Os Termos dizem o que a lista é e o que ela **não** é: entrar não garante compra, não garante preço, não garante peça, e não é pedido.

- [ ] **Step 2: Montar as duas páginas**

Mesma paleta e mesma fonte da LP, uma coluna, largura de leitura confortável, o topo e o rodapé da LP. Cada página termina com a data da última alteração e a **versão** (`v1`), que é a mesma string do `VERSAO_DO_ACEITE` da Task 6.

- [ ] **Step 3: Conferir os quatro caminhos**

Abrir `/termos` e `/privacidade` direto; e, da LP, clicar nos dois links do rodapé e nos dois do texto legal do formulário. Os quatro têm de abrir. **Link quebrado aqui é promessa quebrada.**

- [ ] **Step 4: Commit**

```bash
cd ~/vessel-brasil && git add termos privacidade && git commit -m "Termos de Uso e Politica de Privacidade (v1)"
```

---

### Task 8: A sonda — o que o Bling e o Zoho aceitam de verdade

Tarefa de descoberta. **Nada é escrito no Bling nem na planilha antes dela.** O entregável é um documento com o que foi medido, não código de produção.

**Files:**
- Create: `iamundi/docs/sonda-bling-contatos-zoho-sheet.md`

**Interfaces:**
- Consumes: `bling_tokens` e `acessos_conexoes` do banco.
- Produces: o formato exato do corpo de criação de contato e do campo de origem, que a Task 9 usa.

- [ ] **Step 1: Descobrir o campo de origem no Bling**

Consultar a documentação da API v3 do Bling para `POST /contatos` e **ler um contato existente** por `GET /contatos/{id}` para ver os campos que voltam preenchidos. Procurar onde cabe a marca de origem — candidatos: um campo de observação, e a lista de categorias/tipos de contato.

- [ ] **Step 2: Criar UM contato de teste e conferir na tela do Bling**

Nome `TESTE LP VESSEL — apagar`. Depois de criado, **abrir o Bling e olhar**: a marca de origem aparece num lugar onde a pessoa que usa o sistema vai ver? Se ficar num canto que ninguém abre, não serve, e o campo está errado.

- [ ] **Step 3: Apagar o contato de teste**

E conferir que sumiu.

- [ ] **Step 4: Descobrir a permissão do Zoho Sheet**

Achar o nome exato do escopo de escrita em planilha e o endereço de "acrescentar linha". Conferir se a conexão de hoje (`acessos_conexoes`, provedor `zoho`) tem o escopo — **ela não tem**: hoje são `WorkDrive.files.ALL`, `WorkDrive.teamfolders.ALL` e `ZohoMail.organization.accounts.READ`. Anotar exatamente o que o dono precisa autorizar, e em qual tela.

- [ ] **Step 5: Escrever o achado**

`docs/sonda-bling-contatos-zoho-sheet.md`, em português, com: o corpo exato que o Bling aceitou, o campo que carrega a origem, a prova de que aparece na tela, o nome do escopo do Zoho e o endereço de acrescentar linha.

**Se nenhum campo do Bling servir para marcar a origem de um jeito visível, a tarefa PARA e o assunto volta ao dono.** Não inventar campo, e nunca enfiar a origem dentro do nome do contato.

- [ ] **Step 6: Commit**

```bash
cd ~/iamundi-worktrees/vessel-lp
git add docs/sonda-bling-contatos-zoho-sheet.md
git commit -m "Sonda: o que o Bling e o Zoho aceitam, medido contra a API real"
```

---

### Task 9: O robô que espelha

**Files:**
- Create: `iamundi/supabase/functions/vessel-espelhar-lista/index.ts`
- Create: `iamundi/supabase/functions/vessel-espelhar-lista/LEIA-ME.txt`
- Create: `iamundi/db/migrations/2026-08-28-vessel-espelho-agendado.sql`

**Interfaces:**
- Consumes: `vessel_lista_espera` (Task 4); o formato provado na Task 8; `bling_tokens`; `acessos_conexoes`.
- Produces: nada para tarefas seguintes.

- [ ] **Step 1: Escrever a função**

A regra que manda aqui, no cabeçalho do arquivo, no mesmo espírito de `enviar-pdf-checklist`:

> **O cadastro nunca esperou por isto.** Quando este robô roda, a pessoa já está gravada e já viu a tela de agradecimento. Tudo o que der errado daqui pra frente atrasa um **espelho** — não perde um cadastro, e não aparece pra quem preencheu.

Comportamento:
- lê as linhas com `bling_em is null` ou `planilha_em is null`, em lotes;
- pega o token do Bling **direto de `bling_tokens`**, sem passar pelo `bling-proxy` — a portaria pública continua só leitura, e é esse o ponto;
- cria o contato no formato provado na Task 8, grava `bling_id` e `bling_em`;
- acrescenta a linha na planilha, grava `planilha_em`;
- **os dois espelhos são independentes**: o Bling falhar não pode impedir a planilha, e vice-versa;
- toda falha vira `ultimo_erro` **em português, dizendo o que fazer**, e a linha volta para a fila;
- exige o segredo de cron (`exigirSegredoDeCron`, de `../_shared/segredo-de-cron.ts`), como as outras.

Enquanto o dono não autorizar o Zoho, o `ultimo_erro` da parte da planilha é exatamente: `Falta autorizar a permissão de planilha do Zoho. Enquanto isso, os cadastros ficam guardados aqui e nada se perde.`

- [ ] **Step 2: Conferir que compila**

Run: `cd ~/iamundi-worktrees/vessel-lp && node --test supabase/functions/toda-edge-compila.test.mjs`
Expected: PASS. Esse teste existe porque **nada** compilava as edges, e uma variável repetida já derrubou a `bling-proxy` em produção.

- [ ] **Step 3: Subir pela CLI, nunca montando o corpo à mão**

```bash
cd ~/iamundi-worktrees/vessel-lp
supabase functions deploy vessel-espelhar-lista --use-api
```

`--use-api` porque não há Docker aqui. **Montar o corpo à mão já subiu um placeholder para a produção uma vez** — não repetir.

- [ ] **Step 4: CHAMAR a função depois de subir**

Subir não é provar. Invocar uma vez com um cadastro de teste na fila, e conferir: o contato apareceu no Bling com a marca de origem, `bling_id` e `bling_em` preencheram, e a planilha ganhou a linha (ou o `ultimo_erro` diz, em português, que falta a autorização).

- [ ] **Step 5: Agendar**

Migration `2026-08-28-vessel-espelho-agendado.sql`, com `pg_cron` de 15 em 15 minutos. Depois de agendar, conferir no painel de Saúde dos Robôs — lembrando que `cron.job_run_details` mente, e quem diz a verdade é a execução real.

- [ ] **Step 6: Limpar o teste**

Apagar o contato de teste no Bling, a linha na planilha e a linha em `vessel_lista_espera`.

- [ ] **Step 7: Commit**

```bash
cd ~/iamundi-worktrees/vessel-lp
git add supabase/functions/vessel-espelhar-lista db/migrations/2026-08-28-vessel-espelho-agendado.sql
git commit -m "Robo que espelha a lista de espera no Bling e na planilha"
```

---

### Task 10: Apontar o domínio, DEPOIS limpar o iamundi, entregar

> ⚠️ **A ORDEM MUDOU EM 28/08, e o motivo é medido.** O plano original mandava
> limpar o iamundi primeiro. Não pode: o selo **está em uso**. `vessel_leituras`
> mostra leituras quase todo dia desde 19/08, de 1 a 3 origens diferentes por
> dia, e **zero etiquetas gravadas** (`vessel_pecas.gravada_em`) — ou seja,
> essas pessoas abrem pelo endereço direto em `central.rbvcompany.com/verify/`.
> Remover antes de o domínio novo funcionar deixaria todas elas sem página.
>
> **Sequência correta:** domínio no ar → `vesselbrasil.com.br/verify/<código>`
> respondendo 200 com foto → **só então** apagar do iamundi.

**Files:**
- Modify: `iamundi/vercel.json`
- Delete: `iamundi/public/verify/` (a pasta inteira)
- Delete: `iamundi/src/verify-regras.test.mjs`

**Interfaces:**
- Consumes: tudo o que veio antes.
- Produces: o site no ar.

- [ ] **Step 1: Tirar do iamundi o que mudou de casa**

O `vercel.json` fica assim — some o desvio do host da Vessel, e some a exceção `verify` do pega-tudo:

```json
{
  "rewrites": [
    { "source": "/((?!escritorio-3d).*)", "destination": "/index.html" }
  ],
  "headers": [ ... sem alteração ... ]
}
```

E apagar `public/verify/` e `src/verify-regras.test.mjs`, que agora vivem na casa nova.

- [ ] **Step 2: Provar que o iamundi não quebrou**

Run: `cd ~/iamundi-worktrees/vessel-lp && npm test && npm run build`
Expected: PASS nos dois. **Conferir que o total de testes não ENCOLHEU além dos que mudaram de casa** — suíte que encolhe em silêncio é arquivo sumindo, nunca flake.

Conferir também que o painel `/autenticidade` continua de pé: ele **fica** no iamundi e não foi tocado.

- [ ] **Step 3: Commit e abrir o PR do iamundi**

```bash
cd ~/iamundi-worktrees/vessel-lp
git add vercel.json
git rm -r --cached public/verify && git rm --cached src/verify-regras.test.mjs
git commit -m "O /verify mudou de casa: limpeza do iamundi"
gh pr create --fill
```

- [ ] **Step 4: Cadastrar o domínio na Vercel**

```bash
cd ~/vessel-brasil
vercel domains add vesselbrasil.com.br
vercel domains add www.vesselbrasil.com.br
```

Anotar o **A** e o **CNAME** que a Vercel devolver.

- [ ] **Step 5: Configurar o DNS JUNTO com o dono (decisão dele, 28/08)**

Não é entrega por escrito para ele fazer sozinho: ele pediu para fazer junto. Sessão a dois, ele com o painel do Registro.br aberto, eu ditando campo a campo e conferindo por `dig` a cada passo. O aviso vale igual, e vai dito em voz alta antes de tocar em qualquer coisa:

> ⚠️ **ADICIONE, NÃO SUBSTITUA.** A zona tem hoje os três MX do Zoho, o SPF (`v=spf1 include:zohomail.com ~all`) e o registro de verificação. **Se algum sumir, o e-mail do domínio para.**
> ⚠️ **NÃO troque os servidores de DNS para os da Vercel.** Isso descarta tudo o que está acima de uma vez.

- [ ] **Step 6: Depois de o dono apontar, conferir pelo caminho todo**

```bash
dig +short www.vesselbrasil.com.br
curl -sSI https://vesselbrasil.com.br/ | head -3
curl -sS -o /dev/null -w "%{http_code}\n" https://vesselbrasil.com.br/verify/K7M4X9QP2R
curl -sS -o /dev/null -w "%{http_code}\n" https://vesselbrasil.com.br/qualquer-coisa-que-nao-existe
```

Esperado: a LP abre · o selo devolve **200** · o caminho inventado devolve **404**, e não uma tela. E, o mais importante, conferir que **o e-mail continua funcionando** — mandar uma mensagem para um endereço do domínio e ver chegar.

- [ ] **Step 7: A entrega ao dono**

Cópia no Desktop com data e versão no nome, e um resumo em português dizendo: o que está no ar, o que ficou de fora, e o que ainda depende dele.

---

## O que este plano NÃO faz

- **O catálogo em PDF automático.** É a outra máquina, com spec própria. Achado que já está registrado para ela: o montador de PDF do projeto não desenha imagem por decisão registrada no arquivo — mas as fotos são `.jpg`, e **JPEG entra no PDF sem ser reprocessado**, exatamente como a Task 2 já prova com o PDF do design.
- **Cupom e qualquer integração com a Shopify.** Fora de escopo por decisão do dono em 28/08.
- **Área logada.** `ACESSO PRIVADO` é o nome do bloco do formulário.
- **Tela de administração da lista.** Ver quem se cadastrou é assunto de outra rodada; por enquanto o dado vive na planilha e no Bling, que é onde o dono já trabalha.

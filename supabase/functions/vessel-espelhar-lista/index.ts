// supabase/functions/vessel-espelhar-lista/index.ts
//
// O ROBÔ DO ESPELHO: leva a base da VESSEL BRASIL para onde o dono trabalha — a
// planilha "Base de clientes.xlsx" no Zoho WorkDrive, com ONZE ABAS, e o Bling.
//
// ⚠️ O NOME DELE FICOU MENOR QUE O TRABALHO. Ele nasceu espelhando só a lista de
// espera; desde 21/09/2026 escreve a planilha inteira (lista de espera,
// garantias, vendas, atribuição, origens, pessoas, atendimentos, convites
// abertos, stylists, private edits, beauty sessions). Renomear a função
// obrigaria a mexer no cron e no gatilho do banco, que apontam para este nome —
// risco sem ganho. Ele é O escritor da planilha.
//
// A REGRA QUE MANDA AQUI: **o cadastro nunca esperou por isto.** Quando este
// robô roda, a pessoa já está gravada em `vessel_lista_espera` e já viu a tela
// de agradecimento. Tudo o que pode dar errado daqui pra frente atrasa um
// ESPELHO — não perde um cadastro, e não aparece pra quem preencheu. Por isso
// toda falha é gravada em português na própria linha (`ultimo_erro`), dizendo
// o que fazer, e a linha continua na fila.
//
// A PÁGINA NUNCA ESCREVE NO BLING NEM NO ZOHO. Quem escreve é este robô, com
// credencial própria. Três ganhos: a portaria pública do Bling (`bling-proxy`)
// continua SÓ LEITURA, o cadastro não se perde se um terceiro cair, e a página
// responde na hora sem esperar dois sistemas de fora.
//
// ── O QUE FOI MEDIDO CONTRA AS APIS DE VERDADE ──────────────────────────────
// A sondagem de 28/08 está em docs/sonda-bling-contatos-zoho-sheet.md. O que
// mudou depois, e importa para quem mexer aqui:
//
// 1. A PERMISSÃO DE CONTATOS FOI CONCEDIDA em 29/08/2026. `GET /contatos`
//    responde 200. O robô saiu do modo "avisa e espera".
//
// 2. E AÍ APARECERAM TRÊS DEFEITOS que a falta de permissão vinha escondendo.
//    Medidos contra a API de verdade, mandando cadastros PROPOSITALMENTE
//    inválidos — o Bling valida o corpo antes de gravar, então nada entrou na
//    base do dono:
//
//    a) `tipo` e `situacao` são OBRIGATÓRIOS e o robô não mandava nenhum dos
//       dois. TODO cadastro teria voltado 400 ("O tipo da pessoa é um campo
//       obrigatório"). Como não havia inscrito ainda, isso só apareceria na
//       primeira pessoa que se cadastrasse.
//    b) O WhatsApp ia em `telefone`. Nos contatos de verdade da conta o
//       `telefone` está VAZIO e o número vive em `celular` — mandar no campo
//       errado deixaria o número invisível onde a equipe procura.
//    c) `observacoes` NÃO É CAMPO DE CONTATO. Li um contato de verdade: são 24
//       campos e `observacoes` não está entre eles. O Bling aceita o campo no
//       envio sem reclamar e simplesmente descarta — ou seja, a marca de
//       origem que o dono pediu sumiria em silêncio, do pior jeito possível.
//
// 3. ONDE A MARCA DE ORIGEM CABE DE VERDADE. Procurei campo livre em
//    `financeiro`, `endereco`, `dadosAdicionais` e `pessoasContato`: não existe
//    nenhum de texto livre. O que existe é `codigo`, que está VAZIO em todos os
//    contatos da conta — então dá para usar sem atropelar nada. Vai
//    `LP-<data>-<id curto>`, único por pessoa, visível na lista do Bling.
//    A etiqueta de verdade do Bling é `tiposContato`, e os 12 tipos que existem
//    hoje (Cliente, Fornecedor, Vendedor…) não têm nenhum de lista de espera.
//    Criar um tipo novo é escrita em dado real e é decisão do dono — quando ele
//    criar, é só somar o id em TIPOS_DO_CADASTRO aqui embaixo.
//
// 4. NENHUMA CREDENCIAL DO ZOHO ESCREVE EM PLANILHA. Nem a de `coletor/.env`
//    (WorkDrive.files.ALL, WorkDrive.team.READ) nem a de `acessos_conexoes`
//    (ZohoMail.*, WorkDrive.teamfolders.ALL, files.ALL, sharing.ALL). Zoho
//    Sheet é outro produto, com escopo próprio. **Armadilha:** a API de
//    planilha responde HTTP 400 ("parameter [method] missing"), não 401 nem
//    403 — ela reclama do formato ANTES de checar permissão, e isso parece
//    "quase funcionando". Não é.
//    Por isso o espelho é um ARQUIVO (era CSV, hoje .xlsx), com a permissão de
//    arquivo que já existe e já está provada em produção pelo robô de PDF do
//    checklist. O .xlsx é montado por nós, sem biblioteca — ver
//    `_shared/planilha-xlsx.js`, que explica por quê.
//
// 5. `override-name-exist=false` NÃO guarda versão nova: cria um arquivo com
//    data e hora no nome ("lista-de-espera-vessel 28-08-2026 20:39:19:335.csv").
//    Rodando 4x por dia isso viraria ~120 arquivos por mês. Medido. Aqui vai
//    `true`, que atualiza o MESMO arquivo — id e link não mudam. Rodando de 3
//    em 3 minutos, como hoje, seriam ~14 mil arquivos por mês.
//    (O robô do checklist usa `false` de propósito, e está certo: ficha
//    assinada não se sobrescreve. Aqui o arquivo é uma fotografia da lista.)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { montarAbas, CONSULTAS } from '../_shared/abas-da-vessel.js';
import { montarXlsx, bytesIguais } from '../_shared/planilha-xlsx.js';
import { celularParaOBling } from '../_shared/celular-do-bling.js';
import { completarContato } from '../_shared/completar-contato-do-bling.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WD = 'https://www.zohoapis.com/workdrive/api/v1';
const BLING = 'https://api.bling.com.br/Api/v3';

// O CAMINHO DA PASTA VAI POR NOME, NUNCA POR ID ESCRITO AQUI. Se alguém
// recriar uma pasta no Zoho, o id muda — e um id fixo continuaria apontando,
// calado, para o lugar errado. Mesma regra do robô do checklist.
const RAIZ = 'wbp6sefe483fe7da14c6ebe53225105f1f389'; // espaço "01. RBV and Company"
//
// ⚠️ MUDOU EM 21/09/2026, POR PEDIDO DO DONO. Eram duas pastas e onze arquivos
// CSV: dois aqui ("Lista de espera (LP)": a lista e as garantias) e nove em
// "Base de clientes", escritos por um robô do GitHub Actions de hora em hora.
// Agora é UM arquivo .xlsx com ONZE ABAS, numa pasta só, escrito só por aqui.
// O robô do GitHub foi desligado no mesmo dia: dois escritores no mesmo arquivo
// fariam a planilha pular entre duas versões, e o último a subir venceria.
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Base de clientes'];
const ARQUIVO = 'Base de clientes.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// As etiquetas que o contato recebe no Bling. Hoje só "Cliente", que é o que
// existe. Quando o dono criar um tipo "Lista de espera (LP)", some o id aqui.
const TIPOS_DO_CADASTRO = [{ id: 14580785954 }]; // Cliente

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

// ── Zoho ────────────────────────────────────────────────────────────────────

async function tokenZoho(conexao: any): Promise<string> {
  let dc = String(conexao.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const corpo = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: conexao.client_id,
    client_secret: conexao.client_secret,
    refresh_token: conexao.refresh_token,
  });
  const r = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) {
    throw new Error('Não consegui entrar no Zoho para atualizar a planilha. Abra Acessos → Zoho '
      + 'e clique em conectar; a próxima rodada tenta de novo sozinha.');
  }
  return j.access_token as string;
}

async function wdGet(t: string, caminho: string) {
  const r = await fetch(WD + caminho, {
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' },
  });
  const txt = await r.text();
  try { return { ok: r.ok, status: r.status, corpo: JSON.parse(txt) }; }
  catch { return { ok: r.ok, status: r.status, corpo: null }; }
}

async function acharOuCriarPasta(t: string, paiId: string, nome: string, podeCriar: boolean): Promise<string> {
  // Laço com fim: laço sem fim numa Edge Function trava a rodada inteira.
  for (let pagina = 0; pagina < 5; pagina++) {
    const r = await wdGet(t, `/files/${encodeURIComponent(paiId)}/files`
      + `?page%5Blimit%5D=100&page%5Boffset%5D=${pagina * 100}`);
    // Falha de leitura NÃO autoriza criar às cegas: criaria pasta repetida.
    if (!r.ok) {
      throw new Error(`Não consegui ler o conteúdo da pasta do Zoho (código ${r.status}) para achar `
        + `"${nome}". Costuma ser instabilidade do Zoho — a próxima rodada tenta de novo sozinha.`);
    }
    const filhas: any[] = Array.isArray(r.corpo?.data) ? r.corpo.data : [];
    for (const f of filhas) {
      const a = f?.attributes ?? {};
      const ehPasta = a.is_folder === true || a.type === 'folder' || a.resource_type === 'folder';
      if (ehPasta && String(a.name ?? '').trim() === nome) return String(f.id ?? a.resource_id);
    }
    if (filhas.length < 100) break;
  }
  if (!podeCriar) {
    throw new Error(`Não achei a pasta "${nome}" no Zoho. Ela faz parte do caminho `
      + `${CAMINHO.join(' / ')} e não deve ser renomeada nem movida.`);
  }
  const r = await fetch(`${WD}/files`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json',
               'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: nome, parent_id: paiId }, type: 'files' } }),
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`Não consegui criar a pasta "${nome}" no Zoho (código ${r.status}). Confira em `
      + 'Acessos se a conexão do Zoho ainda tem permissão de escrita no WorkDrive.');
  }
  const nova = Array.isArray(corpo?.data) ? corpo.data[0] : corpo?.data;
  const id = nova?.id ?? nova?.attributes?.resource_id;
  if (!id) {
    throw new Error(`O Zoho aceitou criar a pasta "${nome}" mas não disse o identificador dela, `
      + 'então não dá pra guardar a planilha lá dentro com segurança.');
  }
  return String(id);
}

/**
 * Baixa a planilha que está lá hoje, em bytes. `null` se ainda não existir.
 *
 * ⚠️ BYTES, E NÃO TEXTO. Um .xlsx é um zip: ler com `.text()` o decodifica como
 * UTF-8 e estraga os bytes calado — a comparação nunca bateria, e o robô subiria
 * arquivo novo a cada três minutos, para sempre.
 */
async function baixarPlanilha(t: string, pastaId: string): Promise<Uint8Array | null> {
  const lista = await wdGet(t, `/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=100`);
  const achado = (lista.corpo?.data ?? []).find((f: any) =>
    String(f?.attributes?.name ?? '').trim() === ARQUIVO);
  if (!achado) return null;
  const r = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  if (!r.ok) return null;
  return new Uint8Array(await r.arrayBuffer());
}

async function subirPlanilha(t: string, pastaId: string, bytes: Uint8Array): Promise<void> {
  const fd = new FormData();
  // ⚠️ Nada de BOM aqui. Ele resolvia o acento no CSV; num zip, três bytes a
  // mais no começo fazem o Excel recusar o arquivo inteiro. O .xlsx guarda o
  // texto em UTF-8 por dentro, então o acento já vem certo.
  fd.append('content', new Blob([bytes], { type: TIPO_XLSX }), ARQUIVO);
  const url = `${WD}/upload?filename=${encodeURIComponent(ARQUIVO)}`
    + `&parent_id=${encodeURIComponent(pastaId)}&override-name-exist=true`;
  const r = await fetch(url, {
    method: 'POST',
    // Sem `Content-Type` de propósito: quem monta a fronteira do multipart é o
    // próprio fetch, a partir do FormData. Escrever à mão quebra o envio.
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' },
    body: fd,
  });
  if (!r.ok) {
    throw new Error(`O Zoho recusou a planilha (código ${r.status}). A próxima rodada tenta de novo; `
      + 'se continuar, confira em Acessos se a conexão do Zoho ainda tem permissão de escrita.');
  }
}

// ── A PLANILHA ──────────────────────────────────────────────────────────────
//
// ⚠️ AS ONZE ABAS NÃO MORAM AQUI, e é de propósito: `_shared/abas-da-vessel.js`
// diz quais colunas, de que tipo e em que ordem, e `_shared/planilha-xlsx.js`
// monta o arquivo. Os dois rodam também em node, então há teste para cada aba e
// para cada tipo de data — o que era impossível quando isto vivia dentro da
// edge, que o `node --test` não carrega. Cinco das onze abas estão vazias no
// banco hoje, e sem teste ninguém veria coluna trocada nelas.
//
// ⚠️ E O FUSO: até 21/09/2026 a planilha imprimia a hora como o banco a guarda
// (UTC) e saía TRÊS HORAS ADIANTADA. Dos 150 cadastros da lista de espera, 24
// apareciam no DIA ERRADO. Quem converte agora é `planilha-xlsx.js`, num lugar
// só, pelo tipo declarado na coluna.

/**
 * Lê uma tabela inteira, de mil em mil.
 *
 * ⚠️ PAGINAR NÃO É PRECIOSISMO: o cliente do Supabase devolve no MÁXIMO 1000
 * linhas e NÃO avisa que cortou. `vessel_pedidos` já tem 464; no dia em que
 * passar de mil, a planilha perderia as vendas mais antigas em silêncio.
 */
async function lerTudo(sb: any, { tabela, colunas, ordem }: any): Promise<any[]> {
  const linhas: any[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    let consulta = sb.from(tabela).select(colunas).range(inicio, inicio + 999);
    if (ordem) consulta = consulta.order(ordem.coluna, { ascending: !ordem.desc });
    const { data, error } = await consulta;
    if (error) throw new Error(`não consegui ler ${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return linhas;
}

// ── Bling ───────────────────────────────────────────────────────────────────

async function tokenBling(sb: any): Promise<string> {
  const { data } = await sb.from('bling_tokens').select('*').order('id', { ascending: false }).limit(1).maybeSingle();
  if (!data?.access_token) throw new Error('Não há token do Bling guardado.');
  if (new Date(data.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) return data.access_token;

  // Renovar ROTACIONA o refresh_token: se renovar e não gravar de volta, o
  // próximo que usar o antigo é recusado. Por isso a gravação vem junto.
  const creds = btoa(`${data.client_id}:${data.client_secret}`);
  const r = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${creds}` },
    body: `grant_type=refresh_token&refresh_token=${data.refresh_token}`,
  });
  if (!r.ok) throw new Error('Não consegui renovar o acesso ao Bling.');
  const t = await r.json();
  await sb.from('bling_tokens').update({
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', data.id);
  return t.access_token;
}

const FALTA_PERMISSAO_BLING =
  'O Bling ainda não deixa a central cadastrar contatos: falta autorizar essa permissão no '
  + 'aplicativo. Os cadastros continuam guardados aqui e na planilha, e nada se perde — assim que '
  + 'a permissão for concedida, eles sobem sozinhos. Atenção: reautorizar o Bling derruba o acesso '
  + 'atual até o novo ser gravado, então faça com alguém acompanhando.';

/** O PREFIXO POR ORIGEM. Ate 06/09/2026 o codigo comecava sempre com "LP-",
 *  porque quando ele foi escrito so existia UMA landing page. A coluna `origem`
 *  nasceu depois, para a LP de pre-venda, e esta funcao nao acompanhou: no Bling
 *  um cadastro de pre-venda ficava IDENTICO a um da LP comum, e a unica forma de
 *  separar era pela data. A planilha sempre soube (tem coluna `origem`); o Bling
 *  nao. Corrigido antes do primeiro cadastro de pre-venda existir. */
export const PREFIXO_POR_ORIGEM: Record<string, string> = {
  'pre-venda': 'PV',
  'lp-vesselbrasil': 'LP',
};
const PREFIXO_PADRAO = 'LP';

/** A MARCA DE ORIGEM, no único campo livre que um contato do Bling tem. */
export function codigoDeOrigem(linha: any): string {
  const dia = new Date(linha.criado_em).toISOString().slice(0, 10).replace(/-/g, '');
  // Um pedaço do id da linha entra para o código ser único por pessoa: se dois
  // contatos disputassem o mesmo `codigo`, o Bling poderia recusar o segundo.
  const curto = String(linha.id).replace(/[^A-Za-z0-9]/g, '').slice(-6).toUpperCase();
  // Origem desconhecida cai em "LP" e NAO em algo inventado: melhor um cadastro
  // com a etiqueta antiga do que um codigo que ninguem sabe ler.
  const pre = PREFIXO_POR_ORIGEM[String(linha.origem || '').trim()] || PREFIXO_PADRAO;
  return `${pre}-${dia}-${curto}`;
}

/** Devolve `{id}` se deu certo, ou `{erro}` com a frase em português. */
async function mandarPraBling(t: string, linha: any): Promise<{ id: string } | { erro: string }> {
  const r = await fetch(`${BLING}/contatos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      nome: linha.nome,
      // OBRIGATÓRIOS, e a falta dos dois derrubava TODO cadastro com 400.
      // "F" é pessoa física; "A" é ativo. Medido contra a API.
      tipo: 'F',
      situacao: 'A',
      email: linha.email,
      // WhatsApp vai em CELULAR, não em telefone: nos contatos de verdade da
      // conta o `telefone` está vazio e o número vive aqui. No campo errado ele
      // ficaria invisível justamente onde a equipe procura.
      // ⚠️ NORMALIZADO, NÃO CRU. Quatro cadastros ficaram presos para sempre
      // porque a pessoa digitou o telefone com `+55`: o Bling responde 400
      // ("É necessário preencher corretamente o campo Celular") e a linha tenta
      // de novo, com o mesmo número, a cada 15 minutos. Medido em 11/09/2026:
      // eram exatamente os 4 com `+`, e 0 de 4 tinham entrado.
      celular: celularParaOBling(linha.whatsapp),
      // A MARCA DE ORIGEM que o dono pediu. NÃO vai em `observacoes`: esse
      // campo não existe no contato do Bling (li um de verdade, são 24 campos e
      // ele não está lá) — o Bling aceita no envio e descarta calado.
      codigo: codigoDeOrigem(linha),
      tiposContato: TIPOS_DO_CADASTRO,
    }),
  });
  if (r.status === 403) return { erro: FALTA_PERMISSAO_BLING };
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 300);
    return { erro: `O Bling recusou o cadastro (código ${r.status}). A próxima rodada tenta de novo. `
      + `Resposta: ${txt}` };
  }
  const j = await r.json().catch(() => null);
  const id = j?.data?.id ?? j?.id;
  return id ? { id: String(id) } : { erro: 'O Bling aceitou mas não disse o número do contato.' };
}

// ── A rodada ────────────────────────────────────────────────────────────────

const ROBO = 'vessel-espelhar-lista';

/* ⚠️ UMA RODADA POR VEZ — E POR QUE ISSO SUBSTITUIU UM FREIO DE TEMPO.
 *
 * Até 12/09/2026 o gatilho da tabela tinha um freio: se uma rodada tivesse
 * acontecido nos últimos 20 segundos, o cadastro novo NÃO disparava nada e
 * esperava o cron de 3 em 3 minutos. Medido nas 12 últimas pessoas: 10 chegaram
 * ao Bling em 5-9s, e 2 levaram ~175s — as que caíram nessa janela.
 *
 * O freio existia por um motivo real, que continua valendo: duas rodadas ao
 * mesmo tempo veem a MESMA linha pendente e criam DOIS contatos no Bling para a
 * mesma pessoa. Mas freio de tempo é palpite nos dois sentidos — atrasa quem não
 * precisava, e ainda deixa colidir uma rodada que demore mais que a janela (elas
 * existem: medi rodadas de até 35s).
 *
 * A trava é exata. E quem não pega a trava SAI NA HORA, sem fazer nada: não é
 * perda, porque quem está com ela lê a lista INTEIRA e cobre a linha nova.
 *
 * ⚠️ SOBRA UMA JANELA, E ELA É TRATADA NO `finally`: quem se cadastrou DEPOIS de
 * a rodada em curso ter lido a lista não seria coberto por ela nem por quem foi
 * barrado. Por isso, ao soltar a trava, a rodada confere se entrou alguém no
 * meio e dispara o robô de novo. A condição é `criado_em > comecouEm`, o que
 * TERMINA: só dispara por gente que chegou durante esta rodada, nunca por uma
 * linha que está pendente porque o Bling está fora do ar. */
Deno.serve(async (req) => {
  const barrado = await exigirSegredoDeCron(req, ROBO);
  if (barrado) return barrado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const comecouEm = new Date().toISOString();

  // 120s é o mesmo prazo que o `disparar_robo` dá à chamada. Se esta rodada
  // morrer no meio, a trava vence sozinha e a próxima entra.
  const { data: pegouATrava } = await sb.rpc('tomar_trava', { p_robo: ROBO, p_segundos: 120 });
  if (!pegouATrava) return json({ ok: true, situacao: 'outra rodada ja esta correndo' });

  try {
    return await rodada(sb);
  } finally {
    await sb.rpc('soltar_trava', { p_robo: ROBO });
    try {
      const { count } = await sb.from('vessel_lista_espera')
        .select('id', { count: 'exact', head: true })
        .gt('criado_em', comecouEm);
      if ((count ?? 0) > 0) {
        // ⚠️ OS NOMES SÃO `p_body` e `p_timeout`, conferidos na assinatura real da
        // função no banco. Escrevi `p_corpo`/`p_timeout_ms` de cabeça primeiro e
        // teria falhado CALADO: nome de parâmetro errado no `rpc` vira erro, o
        // erro cai no `catch` de baixo, e ninguém saberia que o re-disparo nunca
        // aconteceu — só que às vezes um cadastro demorava 3 minutos.
        await sb.rpc('disparar_robo', {
          p_robo: ROBO, p_funcao: ROBO, p_segredo: ROBO,
          p_body: { origem: 'entrou-no-meio' }, p_timeout: 120000,
        });
      }
    } catch { /* o cron de 3 minutos cobre; não vale derrubar a resposta por isto */ }
  }
});

async function rodada(sb: any): Promise<Response> {

  /* ⚠️ A LISTA TAMBÉM TEM DE TENTAR DE NOVO (medido em 12/09/2026). Esta leitura
   * devolvia `Gateway Timeout` várias vezes por dia, e a rodada morria inteira —
   * mesma causa do 401 do guardião: na virada do minuto vários cron disparam
   * juntos e o PostgREST engasga. Uma rodada perdida não perde ninguém (a
   * seguinte compara tudo de novo), mas atrasa o cadastro em até 3 minutos — e o
   * dono pediu que fosse ao vivo.
   * Três tentativas, espera curta. Se ainda assim não vier, devolve o erro: a
   * rodada seguinte cobre. */
  let todas: any[] | null = null;
  let ultimoErro = '';
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const r = await sb.from('vessel_lista_espera').select('*').order('criado_em', { ascending: true });
    if (!r.error) { todas = r.data; break; }
    ultimoErro = r.error.message;
    if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 600 * tentativa));
  }
  if (todas === null) return json({ erro: 'não consegui ler a lista', detalhe: ultimoErro }, 500);

  const linhas = todas ?? [];
  const pendentesBling = linhas.filter((l: any) => !l.bling_em);

  // POR QUE NÃO BASTA OLHAR "TEM LINHA NOVA":
  // se alguém pedir para sair e a linha for apagada do banco, não existe linha
  // nova — e a planilha continuaria com os dados dela no Zoho. A Política de
  // Privacidade promete apagar em 7 dias, e isso seria promessa quebrada.
  // Por isso a rodada COMPARA o arquivo com o que ele deveria ser, e regrava
  // sempre que diferir: some linha, muda linha, entra linha, tanto faz.

  const resultado: Record<string, unknown> = { total: linhas.length };

  // ── 1. A PLANILHA, com as ONZE abas ───────────────────────────────────────
  // A planilha e o Bling são INDEPENDENTES: um falhar não pode impedir o outro.
  // Por isso cada um tem o seu `try`.
  {
    try {
      // ⚠️ A LISTA DE ESPERA REAPROVEITA A LEITURA DE CIMA, em vez de ler a
      // mesma tabela duas vezes. As linhas de lá vêm com `select('*')` porque o
      // Bling precisa de `bling_em` e companhia; as abas usam só as colunas que
      // declaram, então sobra dado na memória e falta nenhum.
      const dados: Record<string, any[]> = { listaDeEspera: linhas };

      // Em grupos de cinco, e não as catorze de uma vez: na virada do minuto
      // vários cron disparam juntos e o PostgREST engasga (medido em 12/09).
      const chaves = Object.keys(CONSULTAS).filter((k) => k !== 'listaDeEspera');
      for (let i = 0; i < chaves.length; i += 5) {
        const lote = chaves.slice(i, i + 5);
        const partes = await Promise.all(
          lote.map((n) => lerTudo(sb, (CONSULTAS as any)[n])));
        lote.forEach((n, x) => { dados[n] = partes[x]; });
      }

      const abas = montarAbas(dados);
      const queDeveriaEstar = await montarXlsx(abas);

      const { data: conexao } = await sb
        .from('acessos_conexoes')
        .select('client_id, client_secret, refresh_token, data_center')
        .eq('provedor', 'zoho').maybeSingle();
      if (!conexao?.refresh_token) {
        throw new Error('A central não está conectada ao Zoho. Abra Acessos → Zoho e clique em '
          + 'conectar; a planilha sobe sozinha na rodada seguinte.');
      }
      const tz = await tokenZoho(conexao);

      let pasta = RAIZ;
      for (let i = 0; i < CAMINHO.length; i++) {
        // Só a última pasta do caminho pode ser criada. As de cima já existem e
        // são do dono: criar uma delas por engano esconderia um erro de caminho.
        pasta = await acharOuCriarPasta(tz, pasta, CAMINHO[i], i === CAMINHO.length - 1);
      }
      const deHoje = await baixarPlanilha(tz, pasta);
      const contagem = abas.map((a: any) => `${a.nome}: ${a.linhas.length}`).join(', ');

      if (bytesIguais(deHoje, queDeveriaEstar)) {
        resultado.planilha = `em dia (${contagem})`;
      } else {
        // A planilha é uma FOTOGRAFIA do banco inteiro, não um acréscimo.
        await subirPlanilha(tz, pasta, queDeveriaEstar);
        // ⚠️ ESTA MARCA NÃO É ENFEITE: `vessel_lista_atrasados` acusa qualquer
        // cadastro que passe 10 minutos sem ela. Se a planilha subir e isto não
        // for gravado, o vigia grita sem motivo — e alarme falso cega.
        await sb.from('vessel_lista_espera')
          .update({ planilha_em: new Date().toISOString() })
          .is('planilha_em', null);
        resultado.planilha = `regravada, ${(queDeveriaEstar.length / 1024).toFixed(1)} KB `
          + `(${contagem})`;
      }
    } catch (e) {
      const frase = e instanceof Error ? e.message : String(e);
      // A linha que ainda espera espelho carrega o motivo, em português.
      await sb.from('vessel_lista_espera').update({ ultimo_erro: frase }).is('planilha_em', null);

      // ⚠️ E QUANDO NÃO HÁ NENHUMA ESPERANDO, O ERRO CAÍA NO VÁCUO. Medido em
      // 21/09/2026: as 150 linhas já tinham `planilha_em`, então o `update` de
      // cima atingia ZERO linhas — a planilha falhava e o `ultimo_erro`, que é
      // o lugar que o LEIA-ME manda o dono olhar, continuava vazio. A função
      // devolve 200 (o Bling pode ter dado certo), então `robos_execucoes`
      // também marcava `ok`. Silêncio completo.
      // Agora, nesse caso, o motivo vai na linha MAIS RECENTE — uma só, para
      // não apagar o erro de Bling das outras 149.
      if (!linhas.some((l: any) => !l.planilha_em)) {
        const maisNova = linhas.reduce((a: any, b: any) =>
          String(b.criado_em ?? '') > String(a?.criado_em ?? '') ? b : a, linhas[0]);
        if (maisNova?.id) {
          await sb.from('vessel_lista_espera')
            .update({ ultimo_erro: frase }).eq('id', maisNova.id);
        }
      }
      resultado.planilha = `falhou: ${frase}`;
    }
  }

  // ── 1c. COMPLETAR O CADASTRO DA CLIENTE NO BLING ─────────────────────────
  //
  // Na hora da venda a vendedora quase nunca consegue tirar todos os dados.
  // Validar a garantia é o momento em que a própria cliente preenche o que
  // faltou — e daqui isso vai para o cadastro dela no Bling.
  //
  // ⚠️ A PÁGINA NÃO FAZ ISSO, e não é detalhe: a portaria pública do Bling é só
  // leitura, e a cliente não pode ficar esperando dois sistemas de fora
  // responderem. Quem escreve é este robô, com credencial própria.
  //
  // ⚠️ O CONTATO É LIDO INTEIRO E DEVOLVIDO INTEIRO. Mandar só os campos que
  // mudaram é como se apagam os outros sem ninguém ver. Provado em 06/09/2026
  // contra a API de verdade, num contato descartável criado e apagado: o PUT
  // respondeu 204, celular e nascimento entraram, e telefone, e-mail,
  // naturalidade e CEP continuaram lá.
  try {
    const { data: paraCompletar } = await sb
      .from('vessel_registros')
      .select('codigo, nome, cpf, whatsapp, nascimento, bling_contato_id')
      .is('bling_atualizado_em', null)
      .not('cpf', 'is', null)
      .limit(25);   // teto por rodada: são 4 rodadas por hora, e a fila anda.

    if (paraCompletar?.length) {
      const tb = await tokenBling(sb);
      let completados = 0, semContato = 0, semMudanca = 0;

      for (const g of paraCompletar) {
        // O contato vem do registro quando a compra foi casada; senão, procura
        // pelo CPF, que é o que liga a pessoa à compra dela.
        let contatoId = g.bling_contato_id;
        if (!contatoId) {
          const busca = await fetch(
            `${BLING}/contatos?numeroDocumento=${encodeURIComponent(String(g.cpf).replace(/\D/g, ''))}`,
            { headers: { Authorization: `Bearer ${tb}`, Accept: 'application/json' } });
          const jb = await busca.json().catch(() => null);
          contatoId = jb?.data?.[0]?.id ?? null;
        }
        if (!contatoId) {
          // Sem cadastro no Bling não há o que completar. NÃO cria contato: a
          // cliente pode ter comprado numa revenda, e inventar cadastro aqui
          // encheria a base do dono de gente que nunca comprou dele.
          semContato++;
          continue;
        }

        const det = await fetch(`${BLING}/contatos/${contatoId}`,
          { headers: { Authorization: `Bearer ${tb}`, Accept: 'application/json' } });
        const atual = (await det.json().catch(() => null))?.data;
        if (!atual) { semContato++; continue; }

        const { corpo, mudou } = completarContato(atual, g);
        if (!mudou) {
          // Nada a fazer, mas MARCA assim mesmo: sem isto o robô releria esta
          // linha a cada 15 minutos, para sempre, gastando cota do Bling.
          await sb.from('vessel_registros')
            .update({ bling_atualizado_em: new Date().toISOString(), bling_contato_id: String(contatoId) })
            .eq('codigo', g.codigo);
          semMudanca++;
          continue;
        }

        const put = await fetch(`${BLING}/contatos/${contatoId}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tb}`, Accept: 'application/json',
                     'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        if (put.ok) {
          await sb.from('vessel_registros')
            .update({ bling_atualizado_em: new Date().toISOString(), bling_contato_id: String(contatoId) })
            .eq('codigo', g.codigo);
          completados++;
        }
        // Recusa do Bling NÃO marca: a linha fica na fila e a próxima rodada
        // tenta de novo. Garantia não se perde por isso — ela já está no banco.
      }
      resultado.cadastros = `${completados} completado(s), ${semMudanca} já em dia, `
        + `${semContato} sem cadastro no Bling`;
    } else {
      resultado.cadastros = 'nenhum pendente';
    }
  } catch (e) {
    resultado.cadastros = `falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  // ── 2. O BLING ────────────────────────────────────────────────────────────
  if (pendentesBling.length) {
    try {
      const tb = await tokenBling(sb);
      let ok = 0;
      // ⚠️ O BLING PERMITE 3 CHAMADAS POR SEGUNDO, e ele mesmo diz isso no erro:
      // {"type":"TOO_MANY_REQUESTS","limit":3,"period":"second"}. Sem respiro, um
      // dia com vários cadastros novos derruba os do fim da fila — e eles ficam
      // com o 429 gravado, parecendo defeito do Bling, quando é pressa nossa.
      // 400ms entre uma e outra dá 2,5 por segundo, com folga.
      const respiro = (ms: number) => new Promise((r) => setTimeout(r, ms));
      let primeira = true;
      for (const l of pendentesBling) {
        if (!primeira) await respiro(400);
        primeira = false;
        const r = await mandarPraBling(tb, l);
        if ('id' in r) {
          await sb.from('vessel_lista_espera')
            .update({ bling_id: r.id, bling_em: new Date().toISOString(), ultimo_erro: null })
            .eq('id', l.id);
          ok++;
        } else {
          await sb.from('vessel_lista_espera').update({ ultimo_erro: r.erro }).eq('id', l.id);
          // Falta de permissão vale para TODAS as linhas: insistir uma a uma só
          // gastaria a cota do Bling para receber o mesmo 403.
          if (r.erro === FALTA_PERMISSAO_BLING) {
            await sb.from('vessel_lista_espera')
              .update({ ultimo_erro: r.erro }).is('bling_em', null);
            resultado.bling = `bloqueado: falta a permissão de contatos no Bling `
              + `(${pendentesBling.length} esperando)`;
            return json(resultado);
          }
        }
      }
      resultado.bling = `${ok} de ${pendentesBling.length} cadastrado(s)`;
    } catch (e) {
      const frase = e instanceof Error ? e.message : String(e);
      for (const l of pendentesBling) {
        await sb.from('vessel_lista_espera').update({ ultimo_erro: frase }).eq('id', l.id);
      }
      resultado.bling = `falhou: ${frase}`;
    }
  } else {
    resultado.bling = 'em dia';
  }

  return json(resultado);
}

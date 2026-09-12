// supabase/functions/vessel-espelhar-lista/index.ts
//
// O ROBÔ DO ESPELHO: pega quem entrou na lista de espera da VESSEL BRASIL e
// leva o cadastro para onde o dono trabalha — a planilha (CSV no Zoho
// WorkDrive) e o Bling.
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
//    Por isso o espelho da planilha é um CSV, com a permissão de ARQUIVO que
//    já existe e já está provada em produção pelo robô de PDF do checklist.
//
// 5. `override-name-exist=false` NÃO guarda versão nova: cria um arquivo com
//    data e hora no nome ("lista-de-espera-vessel 28-08-2026 20:39:19:335.csv").
//    Rodando 4x por dia isso viraria ~120 arquivos por mês. Medido. Aqui vai
//    `true`, que atualiza o MESMO arquivo — id e link não mudam.
//    (O robô do checklist usa `false` de propósito, e está certo: ficha
//    assinada não se sobrescreve. Aqui o arquivo é uma fotografia da lista.)
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { montarCsvDeGarantias } from '../_shared/csv-de-garantias.js';
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
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Lista de espera (LP)'];
const ARQUIVO = 'lista-de-espera-vessel.csv';

// A SEGUNDA PLANILHA, na MESMA pasta (pedido do dono em 06/09/2026). Arquivo
// separado, e nao colunas somadas no de cima: uma lista de espera tem
// nome/e-mail/origem e uma garantia tem selo, modelo, prazo e pedido — juntar as
// duas daria uma planilha em que metade das colunas esta sempre vazia.
const ARQUIVO_GARANTIAS = 'garantias-vessel.csv';

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

/** Baixa o CSV que está lá hoje. Devolve '' se não existir ainda. */
async function baixarCsv(t: string, pastaId: string, nomeDoArquivo: string = ARQUIVO): Promise<string> {
  const lista = await wdGet(t, `/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=100`);
  const achado = (lista.corpo?.data ?? []).find((f: any) =>
    String(f?.attributes?.name ?? '').trim() === nomeDoArquivo);
  if (!achado) return '';
  const r = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  if (!r.ok) return '';
  return (await r.text()).replace(/^\uFEFF/, '');
}

async function subirCsv(t: string, pastaId: string, texto: string,
                        nomeDoArquivo: string = ARQUIVO): Promise<void> {
  const fd = new FormData();
  // BOM no início: sem ele o Excel abre "Ana" como "AnÃ¡". O arquivo vai ser
  // aberto também fora do Zoho.
  fd.append('content', new Blob(['\uFEFF' + texto], { type: 'text/csv' }), nomeDoArquivo);
  const url = `${WD}/upload?filename=${encodeURIComponent(nomeDoArquivo)}`
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

// ── CSV ─────────────────────────────────────────────────────────────────────

function celula(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Aspas, ponto-e-vírgula, vírgula e quebra de linha dentro do campo quebram
  // a planilha se não forem escapados. Nome de gente tem vírgula.
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// O TEXTO É PARA GENTE LER, não o valor cru do banco: quem abre a planilha no
// Bling e no Zoho não sabe o que "visita" ou "ecommerce" significam sem olhar
// o código. `null` é "ainda não chegou na segunda pergunta" — a LP cadastra
// primeiro e pergunta depois (Task 1), então toda linha nasce assim.
function objetivoLegivel(v: string | null | undefined): string {
  if (v === 'visita') return 'quer visitar a loja';
  if (v === 'ecommerce') return 'quer comprar pelo site';
  return 'ainda nao escolheu';
}

function montarCsv(linhas: any[]): string {
  // ⚠️ COLUNA NOVA SEMPRE NO FIM. Quem já baixou este CSV montou planilha em
  // cima desta ordem; inserir no meio deslocaria todas as colunas seguintes e
  // quebraria o trabalho dessa pessoa, sem erro nenhum aparecendo em lugar algum.
  const cab = ['nome', 'email', 'whatsapp', 'origem', 'entrou_em', 'aceite_em', 'aceite_versao', 'no_bling',
    'objetivo'];
  const corpo = linhas.map((l) => [
    l.nome, l.email, l.whatsapp, l.origem,
    new Date(l.criado_em).toISOString().slice(0, 19).replace('T', ' '),
    l.aceite_em ? new Date(l.aceite_em).toISOString().slice(0, 19).replace('T', ' ') : '',
    l.aceite_versao,
    l.bling_id ? 'sim' : 'ainda não',
    objetivoLegivel(l.objetivo),
  ].map(celula).join(','));
  return [cab.join(','), ...corpo].join('\n') + '\n';
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

Deno.serve(async (req) => {
  const barrado = await exigirSegredoDeCron(req, 'vessel-espelhar-lista');
  if (barrado) return barrado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: todas, error } = await sb
    .from('vessel_lista_espera')
    .select('*')
    .order('criado_em', { ascending: true });
  if (error) return json({ erro: 'não consegui ler a lista', detalhe: error.message }, 500);

  const linhas = todas ?? [];
  const pendentesBling = linhas.filter((l: any) => !l.bling_em);

  // POR QUE NÃO BASTA OLHAR "TEM LINHA NOVA":
  // se alguém pedir para sair e a linha for apagada do banco, não existe linha
  // nova — e o CSV continuaria com os dados dela no Zoho. A Política de
  // Privacidade promete apagar em 7 dias, e isso seria promessa quebrada.
  // Por isso a rodada COMPARA o arquivo com o que ele deveria ser, e regrava
  // sempre que diferir: some linha, muda linha, entra linha, tanto faz.
  const csvQueDeveriaEstar = montarCsv(linhas);

  const resultado: Record<string, unknown> = { total: linhas.length };

  // ── 1. A PLANILHA ─────────────────────────────────────────────────────────
  // Os dois espelhos são INDEPENDENTES: o Bling falhar não pode impedir a
  // planilha, e vice-versa. Por isso cada um tem seu try.
  {
    try {
      const { data: conexao } = await sb
        .from('acessos_conexoes')
        .select('client_id, client_secret, refresh_token, data_center')
        .eq('provedor', 'zoho').maybeSingle();
      if (!conexao?.refresh_token) {
        throw new Error('A central não está conectada ao Zoho. Abra Acessos → Zoho e clique em '
          + 'conectar; a lista sobe sozinha na rodada seguinte.');
      }
      const tz = await tokenZoho(conexao);

      let pasta = RAIZ;
      for (let i = 0; i < CAMINHO.length; i++) {
        // Só a última pasta do caminho pode ser criada. As de cima já existem e
        // são do dono: criar uma delas por engano esconderia um erro de caminho.
        pasta = await acharOuCriarPasta(tz, pasta, CAMINHO[i], i === CAMINHO.length - 1);
      }
      const csvDeHoje = await baixarCsv(tz, pasta);
      if (csvDeHoje === csvQueDeveriaEstar) {
        resultado.planilha = `em dia (${linhas.length} linha(s))`;
      } else {
        // O CSV é uma FOTOGRAFIA da lista inteira, não um acréscimo.
        await subirCsv(tz, pasta, csvQueDeveriaEstar);
        await sb.from('vessel_lista_espera')
          .update({ planilha_em: new Date().toISOString() })
          .is('planilha_em', null);
        resultado.planilha = `regravada com ${linhas.length} linha(s)`;
      }
    } catch (e) {
      const frase = e instanceof Error ? e.message : String(e);
      await sb.from('vessel_lista_espera').update({ ultimo_erro: frase }).is('planilha_em', null);
      resultado.planilha = `falhou: ${frase}`;
    }
  }

  // ── 1b. A PLANILHA DAS GARANTIAS, na mesma pasta ─────────────────────────
  //
  // ⚠️ VAI NUM `try` PRÓPRIO, e não junto do de cima: se o Zoho recusar ESTA
  // planilha, a lista de espera — que já funcionava — não pode parar de subir
  // por tabela. Cada uma reporta o seu próprio resultado.
  //
  // ⚠️ CPF INTEIRO, por decisão do dono em 06/09/2026 (a alternativa mascarada
  // estava na mesa). O arquivo mora num drive compartilhado.
  try {
    const { data: conexao } = await sb
      .from('acessos_conexoes')
      .select('client_id, client_secret, refresh_token, data_center')
      .eq('provedor', 'zoho').maybeSingle();
    if (!conexao?.refresh_token) throw new Error('A central não está conectada ao Zoho.');
    const tz = await tokenZoho(conexao);

    let pasta = RAIZ;
    for (let i = 0; i < CAMINHO.length; i++) {
      pasta = await acharOuCriarPasta(tz, pasta, CAMINHO[i], i === CAMINHO.length - 1);
    }

    const [regs, peds, pecas, lotes] = await Promise.all([
      sb.from('vessel_registros').select('*'),
      sb.from('vessel_pedidos_de_registro').select('*'),
      sb.from('vessel_pecas').select('codigo, lote_id'),
      sb.from('vessel_lotes').select('id, modelo, cor'),
    ]);

    // Duas leituras e um mapa, em vez de um `select` aninhado: embed com nome
    // ambíguo já derrubou consulta nesta casa, e aqui o custo é o mesmo.
    const loteDoId: Record<string, any> = {};
    for (const l of (lotes.data ?? [])) loteDoId[String(l.id)] = l;
    const pecaParaLote: Record<string, any> = {};
    for (const p of (pecas.data ?? [])) {
      const l = loteDoId[String(p.lote_id)];
      if (l) pecaParaLote[String(p.codigo)] = { modelo: l.modelo, cor: l.cor };
    }

    const csvGarantias = montarCsvDeGarantias(regs.data ?? [], peds.data ?? [], pecaParaLote);
    const csvLaDentro = await baixarCsv(tz, pasta, ARQUIVO_GARANTIAS);
    if (csvLaDentro === csvGarantias) {
      resultado.garantias = `em dia (${(regs.data ?? []).length} garantia(s))`;
    } else {
      await subirCsv(tz, pasta, csvGarantias, ARQUIVO_GARANTIAS);
      resultado.garantias = `regravada com ${(regs.data ?? []).length} garantia(s) `
        + `e ${(peds.data ?? []).length} na fila`;
    }
  } catch (e) {
    // Falha aqui NÃO trava a lista de espera nem perde garantia: a garantia
    // continua inteira no banco, e a próxima rodada tenta de novo em 15 min.
    resultado.garantias = `falhou: ${e instanceof Error ? e.message : String(e)}`;
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
});

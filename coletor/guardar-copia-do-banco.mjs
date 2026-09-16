// GUARDA UMA CÓPIA DO BANCO NO ZOHO WORKDRIVE.
//
//   node coletor/guardar-copia-do-banco.mjs             # a cópia do dia
//   node coletor/guardar-copia-do-banco.mjs --semanal   # inclui o histórico de métrica
//   node coletor/guardar-copia-do-banco.mjs --limpar    # apaga o que passou do prazo
//   node coletor/guardar-copia-do-banco.mjs --ensaio    # monta tudo e NÃO envia
//
// ⚠️ POR QUE ISTO EXISTE
// A organização está no plano FREE da Supabase, e a documentação deles é
// explícita: backup diário automático é só de Pro para cima, e projetos Free
// devem exportar por conta própria. Até 16/09/2026 ninguém exportava — o banco
// não tinha cópia NENHUMA. Não uma cópia velha: nenhuma.
//
// ⚠️ E O ESPELHO NÃO SERVE DE BACKUP, DE PROPÓSITO
// O robô `vessel-espelhar-lista` COMPARA o arquivo inteiro e regrava a cada 15
// minutos, para cumprir a Política de Privacidade: apagou do banco, some da
// planilha. É exatamente isso que o desqualifica como cópia de segurança — uma
// perda no banco chega no espelho em quinze minutos. Espelho e backup são
// opostos, e precisamos dos dois.
//
// Desenho: docs/superpowers/specs/2026-09-16-vessel-base-de-dados-e-backup-design.md
import './lib/carregar-env.mjs';
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const WD = 'https://www.zohoapis.com/workdrive/api/v1';

// ⚠️ CAMINHO POR NOME, NUNCA POR ID ESCRITO AQUI. Se alguém recriar a pasta no
// Zoho o id muda, e um id fixo continuaria apontando, calado, para o lugar
// errado. Mesma regra do robô da lista de espera.
const RAIZ = 'wbp6sefe483fe7da14c6ebe53225105f1f389';   // espaço "01. RBV and Company"
const PASTA_BASE = '00. Copias de seguranca da Central';

const ensaio = process.argv.includes('--ensaio');
const NOME_DO_ROBO = 'guardar-copia-do-banco';
const semanal = process.argv.includes('--semanal');
const limpar = process.argv.includes('--limpar');

// ── o que entra na cópia ─────────────────────────────────────────────────────
//
// A regra é o CONTRÁRIO de uma lista de inclusão: copia-se TUDO, menos o que
// está decidido aqui. Tabela nova entra na cópia sozinha — e é assim que tem de
// ser, porque lista de inclusão envelhece em silêncio e a tabela que ninguém
// lembrou é justamente a que falta no dia ruim.

/** Registro de execução: se regenera sozinho, e perdê-lo não custa nada. */
const SEM_COPIA = new Set([
  'robos_execucoes', 'robos_travas', 'coletor_log', 'gestor_log',
  'data_integrity_checks', 'ia_execucoes', 'audit_log', 'schema_migrations',
]);

/** Histórico de métrica: grande e quase todo recoletável. Só na cópia semanal. */
const SO_NA_SEMANAL = new Set([
  'daily_snapshots', 'engagement_snapshots', 'content_snapshots', 'ads_snapshots',
  'campaign_insights', 'campaign_insights_hora', 'account_insights',
  'perfil_visitas_hora', 'followers_leituras', 'campaign_adsets', 'campaigns',
]);

/**
 * Tabelas com dado de CLIENTE — gente que pode pedir para ser apagada.
 *
 * ⚠️ Elas ficam FORA da cópia mensal de 12 meses, e só na diária de 30 dias.
 * Guardar dado de cliente por um ano numa cópia que ninguém revisita briga com
 * o direito ao apagamento: apagar do banco e a pessoa continuar viva numa cópia
 * de onze meses atrás não é apagar. Trinta dias é o prazo em que a cópia ainda
 * serve para desfazer um estrago, e é curto o bastante para não virar arquivo.
 */
const DE_CLIENTE = new Set([
  'vessel_pessoas', 'vessel_origens', 'vessel_atendimentos', 'vessel_permissoes',
  'vessel_convite_aberturas', 'vessel_lista_espera', 'vessel_registros',
  'vessel_pedidos_de_registro', 'vessel_garantias_baixadas',
  'vessel_tentativas_de_revelar',
]);

/**
 * ⚠️ CREDENCIAL NÃO VAI PARA A CÓPIA, EM TEXTO PURO OU EM QUALQUER FORMA.
 *
 * A cópia mora num drive compartilhado. Quatro tabelas guardam chave de
 * verdade — medido nas colunas, não suposto:
 *
 *   segredos_de_cron.segredo      o que destranca os robôs agendados
 *   bling_tokens.*                acesso ao ERP: pedidos, estoque, contatos
 *   acessos_conexoes.*            acesso ao Zoho — inclusive a este backup
 *   accounts.access_token         acesso às contas de anúncio na Meta
 *
 * Levar isso para o WorkDrive criaria um problema maior que o que este robô
 * resolve: quem tivesse a pasta teria as chaves de tudo.
 *
 * A LINHA FICA, o valor é que sai. Assim a cópia ainda diz QUAIS conexões
 * existiam — que é metade do trabalho de refazer — e restaurar é reautorizar,
 * não adivinhar. Token rotaciona e expira de qualquer jeito: um de trinta dias
 * atrás não serviria nem se estivesse lá.
 */
const SEM_O_VALOR = {
  segredos_de_cron: ['segredo'],
  bling_tokens: ['access_token', 'refresh_token', 'client_secret'],
  acessos_conexoes: ['client_secret', 'refresh_token', 'access_token'],
  accounts: ['access_token'],
};
const MARCA = '(fora da copia: e credencial)';

const DIARIAS_QUE_FICAM = 30;      // dias
const MENSAIS_QUE_FICAM = 12;      // meses
const TETO_DE_APAGAR = 5;          // por rodada, para um defeito não varrer tudo
const QUEDA_QUE_ASSUSTA = 0.10;    // 10% de linhas a menos numa tabela

// ── Supabase ─────────────────────────────────────────────────────────────────

const cabSb = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

/**
 * Todas as tabelas, tiradas do próprio PostgREST.
 *
 * ⚠️ Perguntar ao banco em vez de manter lista à mão: lista à mão envelhece, e
 * a tabela esquecida só aparece no dia em que ela faz falta.
 */
async function tabelasDoBanco() {
  const r = await fetch(REST + '/', { headers: cabSb });
  if (!r.ok) throw new Error(`não consegui listar as tabelas (HTTP ${r.status})`);
  const spec = await r.json();
  return Object.keys(spec.definitions || {}).sort();
}

/** Uma tabela inteira, de mil em mil linhas. */
async function lerTabela(nome) {
  const linhas = [];
  const passo = 1000;
  for (let inicio = 0; ; inicio += passo) {
    const r = await fetch(`${REST}/${nome}?select=*&limit=${passo}&offset=${inicio}`, {
      headers: { ...cabSb, Prefer: 'count=exact' },
    });
    if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const parte = await r.json();
    linhas.push(...parte);
    if (parte.length < passo) break;
  }
  return linhas;
}

// ── Zoho WorkDrive ───────────────────────────────────────────────────────────

async function conexaoZoho() {
  const r = await fetch(`${REST}/acessos_conexoes?provedor=eq.zoho`
    + '&select=client_id,client_secret,refresh_token,data_center&limit=1', { headers: cabSb });
  const [c] = await r.json();
  if (!c?.refresh_token) {
    throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
  }
  return c;
}

async function tokenZoho(c) {
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const r = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) throw new Error('Não consegui entrar no Zoho.');
  return j.access_token;
}

const wdCab = (t) => ({ Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' });

async function pastasDe(t, paiId) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(paiId)}/folders?page%5Blimit%5D=200`,
    { headers: wdCab(t) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return (j?.data ?? []).map((f) => ({ id: String(f.id), nome: String(f?.attributes?.name ?? '').trim() }));
}

async function acharOuCriarPasta(t, paiId, nome) {
  const jaTem = (await pastasDe(t, paiId)).find((p) => p.nome === nome);
  if (jaTem) return jaTem.id;
  const r = await fetch(`${WD}/files`, {
    method: 'POST',
    headers: { ...wdCab(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: nome, parent_id: paiId }, type: 'files' } }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`não consegui criar a pasta "${nome}" no Zoho (HTTP ${r.status})`);
  const nova = Array.isArray(j?.data) ? j.data[0] : j?.data;
  const id = nova?.id ?? nova?.attributes?.resource_id;
  if (!id) throw new Error(`o Zoho criou a pasta "${nome}" e não disse o identificador dela`);
  return String(id);
}

async function subirArquivo(t, pastaId, nome, texto) {
  const fd = new FormData();
  fd.append('content', new Blob([texto], { type: 'application/json' }), nome);
  const r = await fetch(`${WD}/upload?filename=${encodeURIComponent(nome)}`
    + `&parent_id=${encodeURIComponent(pastaId)}&override-name-exist=true`, {
    method: 'POST',
    // Sem Content-Type de propósito: quem monta a fronteira do multipart é o
    // próprio fetch, a partir do FormData. Escrever à mão quebra o envio.
    headers: wdCab(t),
    body: fd,
  });
  if (!r.ok) throw new Error(`o Zoho recusou ${nome} (HTTP ${r.status})`);
}

async function baixarArquivo(t, pastaId, nome) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=200`,
    { headers: wdCab(t) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  const achado = (j?.data ?? []).find((f) => String(f?.attributes?.name ?? '').trim() === nome);
  if (!achado) return null;
  const d = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  return d.ok ? await d.text() : null;
}

async function mandarParaLixeira(t, id) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...wdCab(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { status: '51' }, type: 'files' } }),
  });
  return r.ok;
}

/** Conta ao painel de saúde que esta rodada aconteceu, e como foi. */
async function registrar(deuCerto, recado) {
  try {
    await fetch(`${REST}/robos_execucoes`, {
      method: 'POST',
      headers: { ...cabSb, Prefer: 'return=minimal' },
      body: JSON.stringify({
        robo: NOME_DO_ROBO, ok: deuCerto,
        status_code: deuCerto ? 200 : 500,
        resposta: String(recado).slice(0, 2000),
      }),
    });
  } catch {
    // Não derrubar a cópia por causa do registro: a cópia é o que importa.
  }
}

// Qualquer morte inesperada também precisa aparecer no painel — senão o robô
// "some" e ninguém é avisado.
process.on('uncaughtException', async (erro) => {
  await registrar(false, erro.message);
  console.error('\n⛔ ' + erro.message);
  process.exit(1);
});
process.on('unhandledRejection', async (erro) => {
  await registrar(false, String(erro?.message || erro));
  console.error('\n⛔ ' + String(erro?.message || erro));
  process.exit(1);
});

// ── a rodada ─────────────────────────────────────────────────────────────────

const soma = (texto) => createHash('sha256').update(texto).digest('hex');
const hoje = new Date();
const p = (n) => String(n).padStart(2, '0');
const DIA = `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}-${p(hoje.getDate())}`;
const MES = `${hoje.getFullYear()}-${p(hoje.getMonth() + 1)}`;

if (!SERVICE_KEY) {
  console.error('⛔ Falta SUPABASE_SERVICE_KEY.');
  process.exit(1);
}

console.log(`\nCÓPIA DE ${DIA}${semanal ? ' (semanal: com o histórico de métrica)' : ''}` +
            `${ensaio ? ' — ENSAIO, nada será enviado' : ''}\n`);

const todas = await tabelasDoBanco();
const aCopiar = todas.filter((t) => !SEM_COPIA.has(t) && (semanal || !SO_NA_SEMANAL.has(t)));
const deFora = todas.filter((t) => SEM_COPIA.has(t));
console.log(`${todas.length} tabelas no banco · ${aCopiar.length} nesta cópia · `
          + `${deFora.length} fora de propósito (só registro de execução)\n`);

const arquivos = [];
const manifesto = { versao: 1, dia: DIA, tipo: semanal ? 'semanal' : 'diaria', tabelas: {} };
let bytes = 0;
let comCredencial = 0;
for (const tabela of aCopiar) {
  let linhas = await lerTabela(tabela);
  const apagar = SEM_O_VALOR[tabela];
  if (apagar && linhas.length) {
    linhas = linhas.map((l) => {
      const copia = { ...l };
      for (const c of apagar) if (c in copia && copia[c] !== null) copia[c] = MARCA;
      return copia;
    });
    comCredencial++;
  }
  // JSONL, uma linha por registro. CSV perde o tipo, confunde nulo com texto
  // vazio, e quebra em texto com vírgula e quebra de linha. Backup tem de
  // voltar idêntico ao que saiu.
  const texto = linhas.map((l) => JSON.stringify(l)).join('\n') + (linhas.length ? '\n' : '');
  const nome = `${tabela}.jsonl`;
  arquivos.push({ nome, texto });
  manifesto.tabelas[tabela] = {
    linhas: linhas.length, bytes: Buffer.byteLength(texto), soma: soma(texto),
    ...(apagar ? { sem_o_valor: apagar } : {}),
  };
  bytes += Buffer.byteLength(texto);
  if (linhas.length) console.log(`  ${tabela.padEnd(32)} ${String(linhas.length).padStart(7)} linhas`);
}
console.log(`\ntotal: ${(bytes / 1024 / 1024).toFixed(1)} MB em ${arquivos.length} arquivos`);
console.log(`${comCredencial} tabelas tiveram a credencial removida do arquivo `
          + `(${Object.keys(SEM_O_VALOR).join(', ')})`);

// ⚠️ CONFERIR QUE SAIU MESMO. Anunciar "removi a credencial" e ter removido são
// coisas diferentes — uma coluna renomeada no banco faria a remoção passar por
// cima de nada, calada, e a chave iria junto assim mesmo.
for (const [tabela, colunas] of Object.entries(SEM_O_VALOR)) {
  const arquivo = arquivos.find((a) => a.nome === `${tabela}.jsonl`);
  if (!arquivo || !arquivo.texto.trim()) continue;
  for (const linha of arquivo.texto.trim().split('\n')) {
    const obj = JSON.parse(linha);
    for (const c of colunas) {
      if (c in obj && obj[c] !== null && obj[c] !== MARCA) {
        console.error(`\n⛔ NADA FOI GRAVADO. ${tabela}.${c} ainda tem valor no arquivo.`);
        process.exit(1);
      }
    }
  }
}

// ⚠️ O ENSAIO PARA AQUI, ANTES DE QUALQUER CHAMADA AO ZOHO. A primeira versão
// disto só checava `--ensaio` depois de achar-ou-CRIAR as pastas — ou seja, o
// ensaio criava pasta de verdade. Ensaio que mexe no mundo não é ensaio.
if (ensaio) {
  console.log('\nensaio: li o banco e montei os arquivos. Nada foi enviado, '
            + 'e nenhuma pasta foi criada no Zoho.\n');
  process.exit(0);
}

const conexao = await conexaoZoho();
const tz = await tokenZoho(conexao);
const base = await acharOuCriarPasta(tz, RAIZ, PASTA_BASE);
const pastaDiaria = await acharOuCriarPasta(tz, base, 'diario');

// ⚠️ A TRAVA QUE IMPEDE O PIOR DEFEITO DE BACKUP: o arquivo que sobe truncado
// ou vazio e ninguém percebe até o dia de restaurar. Compara com a cópia
// anterior; queda grande FALHA a rodada em vez de gravar por cima.
const anteriores = (await pastasDe(tz, pastaDiaria))
  .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.nome)).sort((a, b) => b.nome.localeCompare(a.nome));
const ultima = anteriores.find((p) => p.nome !== DIA);
if (ultima) {
  const bruto = await baixarArquivo(tz, ultima.id, 'manifesto.json');
  const antes = bruto ? JSON.parse(bruto) : null;
  const quedas = [];
  for (const [tabela, agora] of Object.entries(manifesto.tabelas)) {
    const era = antes?.tabelas?.[tabela]?.linhas;
    if (era === undefined || era === 0) continue;
    if (agora.linhas < era * (1 - QUEDA_QUE_ASSUSTA)) {
      quedas.push(`${tabela}: ${era} → ${agora.linhas} linhas`);
    }
  }
  if (quedas.length) {
    console.error(`\n⛔ NADA FOI GRAVADO. Encolhimento grande desde ${ultima.nome}:`);
    for (const q of quedas) console.error(`   ${q}`);
    console.error('\nSe o encolhimento for DE VERDADE (faxina, exclusão pedida), rode com --forcar.');
    if (!process.argv.includes('--forcar')) process.exit(1);
  } else {
    console.log(`conferido contra ${ultima.nome}: nenhuma tabela encolheu mais de 10%`);
  }
} else {
  console.log('primeira cópia — não há com o que comparar ainda');
}

const pastaDoDia = await acharOuCriarPasta(tz, pastaDiaria, DIA);
for (const a of arquivos) await subirArquivo(tz, pastaDoDia, a.nome, a.texto);
await subirArquivo(tz, pastaDoDia, 'manifesto.json', JSON.stringify(manifesto, null, 2));
console.log(`\nenviado para ${PASTA_BASE} / diario / ${DIA}`);

// A cópia mensal: só o que NÃO é dado de cliente. Ver o comentário de DE_CLIENTE.
if (hoje.getDate() === 1 || process.argv.includes('--mensal')) {
  const pastaMensal = await acharOuCriarPasta(tz, base, 'mensal');
  const doMes = await acharOuCriarPasta(tz, pastaMensal, MES);
  const semCliente = arquivos.filter((a) => !DE_CLIENTE.has(a.nome.replace(/\.jsonl$/, '')));
  for (const a of semCliente) await subirArquivo(tz, doMes, a.nome, a.texto);
  await subirArquivo(tz, doMes, 'manifesto.json', JSON.stringify({
    ...manifesto, tipo: 'mensal',
    sem_dado_de_cliente: [...DE_CLIENTE],
    porque: 'Dado de cliente fica so na copia diaria de 30 dias: guardar por 12 meses briga com o direito ao apagamento.',
  }, null, 2));
  console.log(`enviado para ${PASTA_BASE} / mensal / ${MES} (${semCliente.length} arquivos, sem dado de cliente)`);
}

// ── limpeza do que passou do prazo ───────────────────────────────────────────
if (limpar) {
  const limite = new Date(hoje); limite.setDate(limite.getDate() - DIARIAS_QUE_FICAM);
  const limiteIso = `${limite.getFullYear()}-${p(limite.getMonth() + 1)}-${p(limite.getDate())}`;
  const velhas = (await pastasDe(tz, pastaDiaria))
    .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f.nome) && f.nome < limiteIso)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  // ⚠️ DUAS TRAVAS. A primeira: nunca apagar as sete mais recentes, aconteça o
  // que acontecer com a conta da data. A segunda: no máximo cinco por rodada —
  // se algum dia a conta sair errada, ela leva cinco, não o acervo inteiro.
  const protegidas = new Set(anteriores.slice(0, 7).map((f) => f.nome));
  const podeApagar = velhas.filter((f) => !protegidas.has(f.nome)).slice(0, TETO_DE_APAGAR);
  for (const f of podeApagar) {
    const ok = await mandarParaLixeira(tz, f.id);
    console.log(`  ${ok ? 'lixeira' : '⚠️ nao consegui'}  diario/${f.nome}`);
  }
  if (velhas.length > podeApagar.length) {
    console.log(`  (${velhas.length - podeApagar.length} ainda por apagar; a proxima rodada continua)`);
  }
}

// ⚠️ REGISTRAR A RODADA NO PAINEL DE SAÚDE DOS ROBÔS.
// Backup que para em silêncio é PIOR que backup nenhum: você segue achando que
// está coberto. Registrado aqui, `robos_esperados` cobra — e cobra como
// crítico, porque é a única cópia que existe.
await registrar(true, `${arquivos.length} arquivos, ${(bytes / 1024 / 1024).toFixed(1)} MB, dia ${DIA}`);
console.log('\npronto.\n');

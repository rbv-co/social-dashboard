// Gera 02-gatilhos.sql: os gatilhos de produção das tabelas declaradas em 01-tabelas-*.sql, as funções
// pedidas nas linhas "-- funções: a, b" desses arquivos (as RPCs que os testes chamam) e o fechamento
// das funções que uns e outras chamam, VERBATIM do levantamento (02-funções.csv, 03-triggers.csv).
// Uso (na raiz do repositório):
//   node api/internal/testebanco/esquema/gerar-gatilhos.mjs <dir do levantamento> > api/internal/testebanco/esquema/02-gatilhos.sql
// O 03-triggers.csv não traz FOR EACH, UPDATE OF nem WHEN. Todo gatilho sai "for each row"; as colunas
// do UPDATE OF e o WHEN vêm de CONFERIDOS, copiados da migration (fonte ao lado). Gatilho gerado que
// não está em CONFERIDOS faz o script FALHAR: leia a migration dele e acrescente a linha.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// tabela.gatilho → { de: colunas do UPDATE OF, quando: condição do WHEN }; {} = nenhum dos dois.
const CONFERIDOS = {
  'bling_lojas.trg_espelhar_grupo_do_canal': { de: 'grupo_id, grupo' },                // db/migrations/2026-08-27-espelho-do-grupo-nos-dois-sentidos.sql:117-119
  'canais_grupos.trg_espelhar_rename_do_grupo': {},                                     // db/migrations/2026-08-21-canal-pai-e-supervisora-de-grupo.sql:88-90
  'equipes.equipes_atualizado': {},                                                     // db/migrations/2026-08-04-equipes-e-escopo.sql:246-247
  'gt_campanhas_rascunho.gt_rascunho_updated_at': {},                                   // db/migrations/2026-08-03-gt-rascunhos-de-campanha.sql (BEFORE UPDATE … FOR EACH ROW; fatia do 5.7)
  'profiles.trg_guard_profiles': {},                                                    // sem migration no repositório; o corpo usa new/old (Ruling 5.1-1)
  'profiles.trg_impedir_autopromocao': {},                                              // supabase/migrations/20260727_impedir_autopromocao_de_admin.sql:51-53
  'frota_checklist.trg_frota_checklist_enfileirar_pdf': { de: 'assinada_em' },            // db/migrations/acessos/036_frota_checklist_pdf.sql:119-121 (after insert or update of assinada_em)
  'frota_checklist.trg_frota_checklist_imutavel': { quando: 'old.assinada_em is not null' }, // db/migrations/acessos/032_frota_checklist_assinatura.sql:50-54 (sem o WHEN recusaria TODA edição de ficha)
  'frota_checklist_respostas.trg_frota_resposta_imutavel': {},                          // db/migrations/acessos/033_frota_resposta_imutavel_insert.sql:20-22 (before insert or update or delete)
  'frota_requisicoes.trg_frota_checar_arquivamento': {},                                // db/migrations/acessos/047_frota_reserva_arquivar.sql:88-92
  'frota_requisicoes.trg_frota_checar_decisao': {},                                     // db/migrations/acessos/045_frota_reserva_editar_cancelar_revogar.sql:244-247 (recriado de 023:88 e 040:58)
  'frota_requisicoes.trg_frota_gravar_historico': {},                                   // db/migrations/acessos/045_frota_reserva_editar_cancelar_revogar.sql:155-158
  'frota_uso.trg_frota_aceite_imutavel': {},                                            // db/migrations/acessos/046_frota_aceite_de_retirada.sql:96-98
  'frota_uso.trg_frota_uso_enfileirar_pdf': { de: 'aceite_em' },                        // db/migrations/2026-08-18-fila-do-pdf-do-aceite.sql:76-78
  'frota_veiculos.trg_frota_espelha_responsavel': { de: 'pessoa_id' },                  // db/migrations/acessos/043_frota_patrimonio_responsavel.sql:50-52
  'frota_veiculos.trg_frota_espelha_situacao': { de: 'situacao' },                      // db/migrations/acessos/042_frota_patrimonio_situacao.sql:86-88
  'frota_veiculos.trg_frota_espelha_situacao_no_bem': {},                               // db/migrations/acessos/051_status_do_veiculo_vale_nos_dois.sql:102-104
  'frota_veiculos.trg_frota_fechar_posse_orfa': { de: 'pessoa_id', quando: 'new.pessoa_id is null' }, // db/migrations/acessos/029_frota_posse_invariante.sql:34-37
  'patrimonio_bens.trg_bem_de_veiculo_segue_a_frota': {},                               // db/migrations/acessos/051_status_do_veiculo_vale_nos_dois.sql:135-138
  'patrimonio_bens.trg_patrimonio_espelha_responsavel': { de: 'pessoa_id' },            // db/migrations/acessos/043_frota_patrimonio_responsavel.sql:69-71
  'patrimonio_bens.trg_patrimonio_espelha_situacao': { de: 'situacao' },                // db/migrations/acessos/042_frota_patrimonio_situacao.sql:110-112
};

const [dir] = process.argv.slice(2);
if (!dir) {
  console.error('uso: gerar-gatilhos.mjs <dir do levantamento>');
  process.exit(2);
}

function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const aqui = fileURLToPath(new URL('.', import.meta.url));
// aceita `create table [if not exists] public.x` em qualquer caixa e FALHA se um `create table` do arquivo
// não casar (tabela escrita de outro jeito perderia os gatilhos em silêncio)
const tabelas = new Set();
const pedidas = [];
for (const a of readdirSync(aqui).filter((a) => /^01-tabelas-.*\.sql$/.test(a))) {
  const sql = readFileSync(join(aqui, a), 'utf8');
  const achadas = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1].toLowerCase());
  const declaradas = [...sql.matchAll(/create\s+table\b/gi)].length;
  if (achadas.length !== declaradas) {
    console.error(`${a}: ${declaradas} "create table", mas só ${achadas.length} no formato "create table [if not exists] public.<nome>"`);
    process.exit(1);
  }
  achadas.forEach((n) => tabelas.add(n));
  for (const m of sql.matchAll(/^-- funções: (.+)$/gm)) pedidas.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
}

const [cabF, ...linF] = lerCSV(readFileSync(join(dir, '02-funções.csv'), 'utf8'));
const iNome = cabF.indexOf('proname'), iDef = cabF.indexOf('definicao');
const funcoes = new Map(linF.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const [cabG, ...linG] = lerCSV(readFileSync(join(dir, '03-triggers.csv'), 'utf8'));
const c = (n) => cabG.indexOf(n);
const gatilhos = new Map();
for (const l of linG) {
  if (l.length < cabG.length || !tabelas.has(l[c('event_object_table')])) continue;
  const chave = `${l[c('event_object_table')]}.${l[c('trigger_name')]}`;
  const g = gatilhos.get(chave) ?? { chave, tabela: l[c('event_object_table')], nome: l[c('trigger_name')],
    momento: l[c('action_timing')], eventos: [], acao: l[c('action_statement')] };
  g.eventos.push(l[c('event_manipulation')]);
  gatilhos.set(chave, g);
}

for (const g of gatilhos.values()) {
  if (!CONFERIDOS[g.chave]) {
    console.error(`gatilho ${g.chave} sem conferência: leia a migration (UPDATE OF? WHEN?) e acrescente em CONFERIDOS`);
    process.exit(1);
  }
}

const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));
const fila = [...[...gatilhos.values()].flatMap((g) => chamadas(g.acao)), ...pedidas];
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const eventos = (g) => g.eventos
  .map((e) => (e === 'UPDATE' && CONFERIDOS[g.chave].de ? `UPDATE OF ${CONFERIDOS[g.chave].de}` : e)).join(' or ');
const quando = (g) => (CONFERIDOS[g.chave].quando ? ` when (${CONFERIDOS[g.chave].quando})` : '');
const nomes = [...vistas].sort();
const ordem = [...gatilhos.values()].sort((a, b) => a.chave.localeCompare(b.chave));
process.stdout.write(
  '-- GERADO por gerar-gatilhos.mjs a partir do levantamento de produção (02-funções.csv, 03-triggers.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção; orientação dos gatilhos das migrations.\n' +
  `-- Tabelas: ${[...tabelas].sort().join(', ')}\n` +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n') + '\n' +
  ordem.map((g) => `create trigger ${g.nome} ${g.momento} ${eventos(g)} on public.${g.tabela} for each row${quando(g)} ${g.acao};\n`).join(''),
);

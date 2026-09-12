import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  janelaDoRecorte, alvosPendentes, interpretarArgumentos, respostaTemAcoes,
  PAUSA_PADRAO, PAUSA_MINIMA, PRIMEIRO_DIA_COM_A_JANELA_NOVA,
} from './janelas-de-backfill.mjs';

test('recorte 0 é o dia isolado', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 0), { since: '2026-08-14', until: '2026-08-14' });
});

test('recortes de N dias terminam no dia da captura e começam N dias antes', () => {
  // É a conta que coletarAdsPorCampanha faz: d = hoje; d.setDate(d.getDate() - dias).
  assert.deepEqual(janelaDoRecorte('2026-08-14', 7), { since: '2026-08-07', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-08-14', 30), { since: '2026-07-15', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-08-14', 1), { since: '2026-08-13', until: '2026-08-14' });
});

test('recorte 1 NÃO é o mesmo que o recorte 0', () => {
  assert.notDeepEqual(janelaDoRecorte('2026-08-14', 1), janelaDoRecorte('2026-08-14', 0));
});

test('recorte 99 é do primeiro dia do mês até o dia', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 99), { since: '2026-08-01', until: '2026-08-14' });
  assert.deepEqual(janelaDoRecorte('2026-03-03', 99), { since: '2026-03-01', until: '2026-03-03' });
});

test('a virada de mês e de ano não escorrega um dia', () => {
  assert.deepEqual(janelaDoRecorte('2026-03-01', 1), { since: '2026-02-28', until: '2026-03-01' });
  assert.deepEqual(janelaDoRecorte('2026-01-01', 30), { since: '2025-12-02', until: '2026-01-01' });
});

test('recorte desconhecido devolve null em vez de inventar janela', () => {
  assert.equal(janelaDoRecorte('2026-08-14', 3), null);
  assert.equal(janelaDoRecorte('2026-08-14', null), null);
});

// ── A VIRADA DA JANELA (20/08/2026) ────────────────────────────────────────
// A `coletarAdsPorCampanha` passou a pedir N dias COMPLETOS (terminando ONTEM)
// em vez de N+1 com o dia de hoje dentro. O backfill não conserta linha velha:
// ele REPETE a pergunta que gravou cada linha. Então a janela que ele usa
// depende de QUANDO a linha foi coletada.

test('a virada é 22/08/2026 — o primeiro dia com os DOIS robôs novos', () => {
  assert.equal(PRIMEIRO_DIA_COM_A_JANELA_NOVA, '2026-08-22');
  // 21/08 foi dia misturado (a Edge subiu às 08h13, depois da rodada das 07h):
  // fica do lado velho de propósito.
  assert.deepEqual(janelaDoRecorte('2026-08-21', 7), { since: '2026-08-14', until: '2026-08-21' });
  assert.deepEqual(janelaDoRecorte('2026-08-22', 7), { since: '2026-08-15', until: '2026-08-21' });
});

test('linha antiga continua sendo lida pela janela velha', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 7), { since: '2026-08-07', until: '2026-08-14' });
});

test('linha coletada ANTES da virada continua sendo lida pela janela velha', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-14', 7, '2026-08-21'),
    { since: '2026-08-07', until: '2026-08-14' }, 'oito dias, como ela foi gravada');
});

test('linha coletada A PARTIR da virada usa a janela nova', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-21', 7, '2026-08-21'),
    { since: '2026-08-14', until: '2026-08-20' }, 'sete dias, terminando ontem');
  assert.deepEqual(janelaDoRecorte('2026-08-25', 30, '2026-08-21'),
    { since: '2026-07-26', until: '2026-08-24' });
});

test('a virada não encosta no recorte 0 nem no 99 — eles nunca mudaram', () => {
  assert.deepEqual(janelaDoRecorte('2026-08-25', 0, '2026-08-21'), { since: '2026-08-25', until: '2026-08-25' });
  assert.deepEqual(janelaDoRecorte('2026-08-25', 99, '2026-08-21'), { since: '2026-08-01', until: '2026-08-25' });
});

test('alvos: uma chamada por conta+data+recorte, sem repetir campanha', () => {
  const linhas = [
    { account_id: 'A', captured_at: '2026-08-01', period_days: 30 },
    { account_id: 'A', captured_at: '2026-08-01', period_days: 30 },
    { account_id: 'A', captured_at: '2026-08-02', period_days: 30 },
    { account_id: 'B', captured_at: '2026-08-01', period_days: 0 },
  ];
  const alvos = alvosPendentes(linhas);
  assert.equal(alvos.length, 3);
});

test('alvos vêm do mais antigo para o mais novo', () => {
  const linhas = [
    { account_id: 'A', captured_at: '2026-08-09', period_days: 7 },
    { account_id: 'A', captured_at: '2026-05-19', period_days: 7 },
  ];
  // O mais antigo primeiro: se o limite da Meta interromper no meio, o que ficou
  // de fora é o mais recente — que é o que a próxima rodada do coletor cobre sozinha.
  assert.equal(alvosPendentes(linhas)[0].captured_at, '2026-05-19');
});

test('alvo de recorte desconhecido é descartado, não vira chamada', () => {
  assert.deepEqual(alvosPendentes([{ account_id: 'A', captured_at: '2026-08-01', period_days: 3 }]), []);
});

test('--desde na seleção de alvos: mantém o alvo NA data limite, descarta o de um dia antes', () => {
  // O risco inteiro desta mudança é off-by-one: um "antes" que devia virar
  // "inclusive" preencheria o dia errado sem avisar. Por isso o dia exatamente
  // na fronteira TEM de sobreviver, e o dia anterior TEM de sumir.
  const linhas = [
    { account_id: 'A', captured_at: '2026-07-17', period_days: 7 }, // um dia antes da fronteira
    { account_id: 'A', captured_at: '2026-07-18', period_days: 7 }, // exatamente na fronteira
    { account_id: 'A', captured_at: '2026-07-19', period_days: 7 }, // depois da fronteira
  ];
  const alvos = alvosPendentes(linhas, '2026-07-18');
  assert.deepEqual(alvos.map((a) => a.captured_at), ['2026-07-18', '2026-07-19']);
});

test('sem desde, alvosPendentes não filtra nada (comportamento de sempre)', () => {
  const linhas = [
    { account_id: 'A', captured_at: '2026-07-17', period_days: 7 },
    { account_id: 'A', captured_at: '2026-07-18', period_days: 7 },
  ];
  assert.equal(alvosPendentes(linhas).length, 2);
  assert.equal(alvosPendentes(linhas, null).length, 2);
});

// ----------------------------------------------------------- as bandeiras

test('--dry-run vale tanto quanto --dry', () => {
  // A grafia que quase todo mundo tenta primeiro. Se ela fosse ignorada, um
  // engano de digitação viraria a execução inteira: 2.179 chamadas e gravação.
  assert.equal(interpretarArgumentos(['--dry']).dry, true);
  assert.equal(interpretarArgumentos(['--dry-run']).dry, true);
});

test('sem bandeira nenhuma: grava, com a pausa padrão', () => {
  const a = interpretarArgumentos([]);
  assert.equal(a.dry, false);
  assert.equal(a.pausa, PAUSA_PADRAO);
  assert.equal(a.erro, null);
});

test('bandeira desconhecida é RECUSADA, nunca ignorada', () => {
  // Ignorar em silêncio é o que torna o engano perigoso: quem escreveu --dri
  // queria uma prévia e receberia a execução de verdade.
  assert.ok(interpretarArgumentos(['--dri']).erro);
  assert.ok(interpretarArgumentos(['--dryrun']).erro);
  assert.ok(interpretarArgumentos(['--dry-runn']).erro);
  assert.ok(interpretarArgumentos(['--gravar']).erro);
});

test('--pausa aceita as duas grafias e convive com --dry', () => {
  assert.equal(interpretarArgumentos(['--pausa', '3000']).pausa, 3000);
  assert.equal(interpretarArgumentos(['--pausa=3000']).pausa, 3000);
  const a = interpretarArgumentos(['--pausa', '3000', '--dry']);
  assert.equal(a.pausa, 3000);
  assert.equal(a.dry, true);
  assert.equal(a.erro, null);
});

test('pausa abaixo do piso vira o piso — zero foi o que derrubou o painel em julho', () => {
  assert.equal(interpretarArgumentos(['--pausa', '0']).pausa, PAUSA_MINIMA);
  assert.equal(interpretarArgumentos(['--pausa', '50']).pausa, PAUSA_MINIMA);
  assert.equal(interpretarArgumentos(['--pausa', '-1']).pausa, PAUSA_MINIMA);
  assert.equal(interpretarArgumentos(['--pausa', '0']).pausaPedida, 0);
});

test('--pausa sem número é erro, não volta para o padrão em silêncio', () => {
  assert.ok(interpretarArgumentos(['--pausa']).erro);
  assert.ok(interpretarArgumentos(['--pausa', 'abc']).erro);
  assert.ok(interpretarArgumentos(['--pausa', '3000ms']).erro);
});

test('--desde aceita as duas grafias e devolve a data', () => {
  assert.equal(interpretarArgumentos(['--desde', '2026-07-18']).desde, '2026-07-18');
  assert.equal(interpretarArgumentos(['--desde=2026-07-18']).desde, '2026-07-18');
  assert.equal(interpretarArgumentos(['--desde', '2026-07-18']).erro, null);
});

test('sem --desde não há filtro nenhum', () => {
  assert.equal(interpretarArgumentos([]).desde, null);
  assert.equal(interpretarArgumentos(['--dry']).desde, null);
});

test('--desde malformado, impossível ou sem valor é RECUSADO, nunca virado em outra coisa', () => {
  // Formato errado: nunca coage para uma data vizinha — coagir aqui é encher o
  // período errado, em silêncio.
  assert.ok(interpretarArgumentos(['--desde', 'ontem']).erro);
  assert.ok(interpretarArgumentos(['--desde', '18-07-2026']).erro);
  assert.ok(interpretarArgumentos(['--desde', '2026/07/18']).erro);
  // Formato certo, calendário impossível: mês 13 e dia 45 não existem, e o
  // construtor Date rolaria por cima disso em silêncio se não fosse conferido.
  assert.ok(interpretarArgumentos(['--desde', '2026-13-45']).erro);
  assert.ok(interpretarArgumentos(['--desde', '2026-02-30']).erro);
  assert.ok(interpretarArgumentos(['--desde', '2026-00-10']).erro);
  // --desde solto no fim, sem data nenhuma depois.
  assert.ok(interpretarArgumentos(['--desde']).erro);
  assert.ok(interpretarArgumentos(['--pausa', '3000', '--desde']).erro);
});

test('--desde convive com --dry e --pausa', () => {
  const a = interpretarArgumentos(['--desde', '2026-07-18', '--pausa', '3000', '--dry']);
  assert.equal(a.desde, '2026-07-18');
  assert.equal(a.pausa, 3000);
  assert.equal(a.dry, true);
  assert.equal(a.erro, null);
});

// ------------------------------------------- a resposta pela metade da Meta

test('resposta em que NENHUMA campanha traz actions não serve', () => {
  // A Meta já devolveu 200 estruturalmente válido com o detalhe faltando neste
  // projeto. Aqui o estrago seria permanente: o script grava a linha UMA vez, e
  // o filtro conversas=is.null tranca a linha contra qualquer conserto depois.
  assert.equal(respostaTemAcoes([{ campaign_id: '1' }, { campaign_id: '2' }]), false);
  assert.equal(respostaTemAcoes([]), false);
  assert.equal(respostaTemAcoes(null), false);
});

test('basta UMA campanha com actions para a resposta servir', () => {
  assert.equal(respostaTemAcoes([{ campaign_id: '1' }, { campaign_id: '2', actions: [{ action_type: 'lead', value: '3' }] }]), true);
});

test('actions vazio é resposta boa: a Meta olhou e não havia ação', () => {
  // Diferente de actions AUSENTE. Lista vazia é um zero de verdade.
  assert.equal(respostaTemAcoes([{ campaign_id: '1', actions: [] }]), true);
});

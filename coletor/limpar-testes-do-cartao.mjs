// APAGA O QUE FOI ENSAIO NO GERADOR DE APPOINTMENT CARD.
//
//   node coletor/limpar-testes-do-cartao.mjs            # mostra e não apaga
//   node coletor/limpar-testes-do-cartao.mjs --apagar
//   node coletor/limpar-testes-do-cartao.mjs --aprovar  # encerra a fase de testes
//
// ⚠️ POR QUE EXISTE UMA MARCA, EM VEZ DE "APAGAR TUDO"
// O gerador foi liberado para algumas pessoas usarem antes da aprovação. Se nada
// distinguisse ensaio de real, apagar significaria apagar TUDO — e no dia em que
// o primeiro atendimento de verdade entrasse no meio, ele iria junto, sem
// ninguém perceber. Cada linha nasce marcada `teste = true`.
//
// ⚠️ ELE NUNCA APAGA LINHA SEM A MARCA. Nem que a tabela inteira esteja marcada,
// nem com `--apagar`. O `where teste` está em todas as consultas, e é o que
// impede esta ferramenta de virar a que destruiu o dado real.
import './lib/carregar-env.mjs';
import pg from 'pg';

const apagar = process.argv.includes('--apagar');
const aprovar = process.argv.includes('--aprovar');

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
try {
  const { rows: [c] } = await cli.query(`
    select
      (select count(*)::int from vessel_pessoas            where teste) as pessoas_teste,
      (select count(*)::int from vessel_pessoas            where not teste) as pessoas_reais,
      (select count(*)::int from vessel_atendimentos       where teste) as atendimentos_teste,
      (select count(*)::int from vessel_atendimentos       where not teste) as atendimentos_reais,
      (select count(*)::int from vessel_convite_aberturas  where teste) as aberturas_teste,
      (select count(*)::int from vessel_convite_aberturas  where not teste) as aberturas_reais,
      (select count(*)::int from vessel_client_advisors    where teste) as advisors_teste,
      (select count(*)::int from vessel_client_advisors    where not teste) as advisors_reais`);

  console.log('\n                        de ensaio    de verdade');
  const linha = (rotulo, t, r) =>
    console.log(`  ${rotulo.padEnd(20)} ${String(t).padStart(9)} ${String(r).padStart(13)}`);
  linha('pessoas', c.pessoas_teste, c.pessoas_reais);
  linha('atendimentos', c.atendimentos_teste, c.atendimentos_reais);
  linha('convites abertos', c.aberturas_teste, c.aberturas_reais);
  linha('client advisors', c.advisors_teste, c.advisors_reais);

  if (aprovar) {
    // ⚠️ APROVAR NÃO APAGA NADA. Ele só faz o que vier DAQUI PARA A FRENTE
    // nascer sem a marca. O ensaio que já existe continua lá até alguém rodar
    // `--apagar` — separar as duas decisões é o que impede "aprovei" de virar
    // "apaguei" por engano.
    for (const t of ['vessel_pessoas', 'vessel_atendimentos',
                     'vessel_convite_aberturas', 'vessel_client_advisors']) {
      await cli.query(`alter table public.${t} alter column teste set default false`);
    }
    console.log('\nFASE DE TESTES ENCERRADA: o que entrar daqui para a frente nasce como real.');
    console.log('⚠️ Nada foi apagado. O ensaio que já existe some com --apagar.');
    console.log('⚠️ E a página precisa parar de carimbar: trocar EM_TESTE para false em');
    console.log('   vessel-brasil/geradorappointmentcard/index.html e publicar.\n');
  } else if (apagar) {
    const total = c.pessoas_teste + c.atendimentos_teste + c.aberturas_teste + c.advisors_teste;
    if (!total) { console.log('\nnão há nada de ensaio para apagar.\n'); }
    else {
      await cli.query('begin');
      // A ordem importa: a abertura aponta para o convite, e o atendimento some
      // junto com a pessoa (em cascata).
      const a = await cli.query('delete from vessel_convite_aberturas where teste');
      const b = await cli.query('delete from vessel_atendimentos where teste');
      const d = await cli.query('delete from vessel_pessoas where teste');
      const e = await cli.query('delete from vessel_client_advisors where teste');
      const { rows: [sobrou] } = await cli.query(`
        select (select count(*)::int from vessel_pessoas where teste) as p,
               (select count(*)::int from vessel_atendimentos where teste) as a`);
      if (sobrou.p || sobrou.a) throw new Error('sobrou linha de ensaio depois de apagar');
      await cli.query('commit');
      console.log(`\napagados: ${d.rowCount} pessoas, ${b.rowCount} atendimentos, `
        + `${a.rowCount} aberturas, ${e.rowCount} client advisors — todos de ensaio.`);
      console.log('nenhuma linha sem a marca foi tocada.\n');
    }
  } else {
    console.log('\n(nada foi apagado — rode com --apagar)\n');
  }
} finally {
  await cli.end();
}

// A FILA DE PAUTA (conteudo_jobs) VISTA PELO VIGIA DA VPS (coletor/vps/conteudo-vigia.sh).
//
// A API só ENFILEIRA (POST /conteudo-trigger). Quem decide o que roda é este arquivo, a cada volta do vigia:
//   node coletor/conteudo-fila.mjs pegar        → expira, descarta repetidos e imprime "<id> <tipo>" do job pego
//                                                 (nada impresso = fila vazia)
//   node coletor/conteudo-fila.mjs falhou <id>  → marca erro se o robô saiu com falha sem fechar o job
// Contrato e prazos: docs/superpowers/plans/2026-10-12-api-go-plano-5-9-conteudo.md, "Robô de Conteúdo na VPS".
import { abrirBanco } from './lib/conteudo-banco.mjs';

export const TIPOS = ['ideias', 'semana']; // lista fechada: o tipo vira nome de arquivo executado pelo vigia

export async function pegarProximo(db) {
  // Clique velho não gasta IA; rodada presa não segura a marca.
  await db.rodar(`update conteudo_jobs set status = 'erro', updated_at = now(),
      erro = 'O pedido esperou mais de 30 minutos na fila e foi descartado. Peça de novo.'
    where status = 'enfileirado' and created_at <= now() - interval '30 minutes'`);
  await db.rodar(`update conteudo_jobs set status = 'erro', updated_at = now(),
      erro = 'A rodada passou de 20 minutos sem terminar e foi interrompida.'
    where status = 'rodando' and updated_at <= now() - interval '20 minutes'`);
  // Só o job MAIS NOVO de cada conta e tipo roda: com o vigia parado cada clique entrou na fila, e rodar todos
  // seria IA paga (Opus) por clique repetido da mesma marca.
  await db.rodar(`update conteudo_jobs j set status = 'erro', updated_at = now(), erro = 'Substituído por um pedido mais novo.'
    where j.status = 'enfileirado' and exists (select 1 from conteudo_jobs n
      where n.account_id = j.account_id and n.tipo = j.tipo and n.status = 'enfileirado' and n.created_at > j.created_at)`);
  // Um por vez na VPS inteira (o `concurrency: conteudo-ideias` do yml antigo).
  const { rows: rodando } = await db.rodar(`select 1 from conteudo_jobs where status = 'rodando' limit 1`);
  if (rodando.length) return null;
  // Atômico: dois vigias, por engano, não pegam o mesmo.
  const { rows } = await db.rodar(`update conteudo_jobs set status = 'rodando', updated_at = now()
    where id = (select id from conteudo_jobs where status = 'enfileirado' order by created_at for update skip locked limit 1)
    returning id, tipo`);
  const job = rows[0];
  if (!job) return null;
  if (!TIPOS.includes(job.tipo)) {
    await falhou(db, job.id, `Tipo de pedido desconhecido (${String(job.tipo).slice(0, 40)}).`);
    return null;
  }
  return job;
}

export const falhou = (db, id, erro = 'A rodada falhou antes de terminar; detalhes no log da VPS.') =>
  db.rodar(`update conteudo_jobs set status = 'erro', erro = $2, updated_at = now() where id = $1 and status = 'rodando'`, [id, erro]);

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, id] = process.argv.slice(2);
  const db = await abrirBanco(process.env.CONTEUDO_DATABASE_URL);
  try {
    if (cmd === 'pegar') { const j = await pegarProximo(db); if (j) console.log(`${j.id} ${j.tipo}`); }
    else if (cmd === 'falhou' && id) await falhou(db, id);
    else { console.error('uso: conteudo-fila.mjs pegar | falhou <id>'); process.exitCode = 2; }
  } finally { await db.fechar(); }
}

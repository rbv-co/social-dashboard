// supabase/functions/vessel-cartoes-trigger/index.ts
//
// ACORDA O ROBÔ DOS CARTÕES EAN assim que um pedido entra na fila (`vessel_cartao_pedidos`).
//
// ⚠️ ELE NÃO GERA CARTÃO. Ele só bate na porta do GitHub Actions (cartoes-ean.yml), que é onde o robô roda:
// gerar o cartão precisa de Chrome, Python e do repositório do site, e nada disso existe numa edge function.
//
// Mesma forma da `vessel-fotos-trigger`, incluindo o token: `GITHUB_PAT_FOTOS` primeiro, `GITHUB_PAT_FABRICA` como
// queda (o da Fábrica respondeu 403 em 07/09/2026). Precisa de "Actions: Read and write" neste repositório.
//
// Se o disparo falhar, o pedido NÃO se perde: a rodada de hora em hora do workflow o pega.
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const barrado = await exigirSegredoDeCron(req, 'vessel-cartoes-trigger');
  if (barrado) return barrado;

  const pat = Deno.env.get('GITHUB_PAT_FOTOS') || Deno.env.get('GITHUB_PAT_FABRICA');
  const repo = Deno.env.get('GITHUB_REPO');
  if (!pat || !repo) {
    return json({ erro: 'sem credencial do GitHub',
      detalhe: 'falta GITHUB_PAT_FOTOS (ou GITHUB_PAT_FABRICA) e GITHUB_REPO' }, 500);
  }

  // O corpo só serve ao registro: saber QUAL pedido acordou o robô ajuda a entender a fila depois.
  const corpo = await req.json().catch(() => ({}));

  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/cartoes-ean.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vessel-cartoes-trigger',
        'Content-Type': 'application/json',
      },
      // `ref` é obrigatório; o GitHub responde 404 (não 400) quando falta ou o ramo não tem o arquivo.
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  // 204 é o sucesso desta rota. Qualquer outra coisa vira erro COM o texto da resposta.
  if (r.status !== 204) {
    const texto = (await r.text()).slice(0, 300);
    const dica = r.status === 403
      ? 'O token não pode disparar ação: venceu, ou falta "Actions: Read and write" no repositório.'
      : r.status === 404
        ? 'O GitHub não achou cartoes-ean.yml em main: o workflow ainda não foi para a main, ou o repositório está errado.'
        : null;
    return json({ erro: 'dispatch_falhou', status: r.status, detalhe: texto, dica }, 502);
  }
  return json({ ok: true, pedido: corpo?.pedido ?? null, acordou: 'cartoes-ean.yml' });
});

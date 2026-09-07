// supabase/functions/vessel-fotos-trigger/index.ts
//
// ACORDA O ROBÔ DAS FOTOS assim que um lote nasce.
//
// ⚠️ POR QUE ISTO EXISTE: o robô rodava uma vez por dia, às 8h05, no Mac do
// dono. Um lote criado às 9h esperava 23 HORAS pela foto — e se a bolsa saísse
// da fábrica antes, a cliente encostava o celular e via o certificado sem foto.
// Aconteceu em 06/09/2026: 64 lotes foram criados à tarde e passaram a noite
// inteira sem foto nenhuma.
//
// ⚠️ ELE NÃO BUSCA FOTO. Ele só bate na porta do GitHub Actions, que é onde o
// robô roda de verdade — buscar foto precisa de git, de ImageMagick e de
// publicar o site, e nada disso existe numa edge function.
//
// ⚠️ E REUSA O `GITHUB_PAT_FABRICA`, de propósito. Ele já existe, já tem
// permissão de disparar ação neste mesmo repositório e já é usado pela Fábrica
// de Anúncios e pela Central de Conteúdo. Criar um segundo token seria mais uma
// coisa para expirar sem ninguém perceber.
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  const barrado = await exigirSegredoDeCron(req, 'vessel-fotos-trigger');
  if (barrado) return barrado;

  const pat = Deno.env.get('GITHUB_PAT_FABRICA');
  const repo = Deno.env.get('GITHUB_REPO');
  if (!pat || !repo) {
    return json({ erro: 'sem credencial do GitHub', detalhe: 'falta GITHUB_PAT_FABRICA ou GITHUB_REPO' }, 500);
  }

  // O corpo é opcional e serve só para o registro: quem chama é um gatilho do
  // banco, e saber QUAL lote acordou o robô ajuda a entender a fila depois.
  const corpo = await req.json().catch(() => ({}));

  const r = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/fotos-do-selo.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'vessel-fotos-trigger',
        'Content-Type': 'application/json',
      },
      // ⚠️ `ref` É OBRIGATÓRIO e tem de ser o ramo onde o arquivo do fluxo mora.
      // O GitHub responde 404 — não 400 — quando ele falta ou aponta para um
      // ramo sem o arquivo, e 404 aqui parece "repositório errado".
      body: JSON.stringify({ ref: 'main' }),
    },
  );

  // 204 é o sucesso desta rota do GitHub. Qualquer outra coisa vira erro COM o
  // texto da resposta: "dispatch falhou" sozinho não diz se é token vencido,
  // arquivo renomeado ou ramo errado.
  if (r.status !== 204) {
    return json({ erro: 'dispatch_falhou', status: r.status, detalhe: (await r.text()).slice(0, 300) }, 502);
  }
  return json({ ok: true, lote: corpo?.lote ?? null, acordou: 'fotos-do-selo.yml' });
});

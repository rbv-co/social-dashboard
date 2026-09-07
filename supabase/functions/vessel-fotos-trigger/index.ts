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

  // ⚠️ TOKEN PRÓPRIO PRIMEIRO, o da Fábrica como queda.
  //
  // A ideia era reusar o `GITHUB_PAT_FABRICA` — ele já existia e já disparava
  // ação neste repositório. Só que ele RESPONDE 403 hoje: "Resource not
  // accessible by personal access token". Medido em 07/09/2026, e o último
  // disparo da Fábrica que funcionou foi em 29/07 — ou seja, ele venceu (ou
  // perdeu a permissão de Actions) em algum momento e NINGUÉM PERCEBEU, porque
  // a Fábrica é acordada sob demanda e ninguém a acordou desde então.
  //
  // Por isso `GITHUB_PAT_FOTOS` vem primeiro: trocar o da Fábrica consertaria os
  // dois de uma vez, mas também mexeria num robô que não é meu, sem eu saber o
  // que mais depende dele.
  const pat = Deno.env.get('GITHUB_PAT_FOTOS') || Deno.env.get('GITHUB_PAT_FABRICA');
  const repo = Deno.env.get('GITHUB_REPO');
  if (!pat || !repo) {
    return json({ erro: 'sem credencial do GitHub',
      detalhe: 'falta GITHUB_PAT_FOTOS (ou GITHUB_PAT_FABRICA) e GITHUB_REPO' }, 500);
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
    const texto = (await r.text()).slice(0, 300);
    // 403 aqui é quase sempre token vencido ou sem `Actions: Read and write`.
    // Dizer isso poupa a próxima pessoa de procurar no lugar errado.
    const dica = r.status === 403
      ? 'O token não pode disparar ação. Ele venceu, ou falta a permissão '
        + '"Actions: Read and write" no repositório. Crie um token novo e guarde '
        + 'como GITHUB_PAT_FOTOS nos segredos do Supabase.'
      : null;
    return json({ erro: 'dispatch_falhou', status: r.status, detalhe: texto, dica }, 502);
  }
  return json({ ok: true, lote: corpo?.lote ?? null, acordou: 'fotos-do-selo.yml' });
});

// ler-documento — tira o TEXTO de um PDF que o dono soltou na tela.
//
// PEDIDO DO DONO (12/08/2026): "deixe em algum local para fazer upload da persona
// como pdf, word, enfim". O .docx e o .txt são lidos no próprio navegador, sem
// dependência nenhuma (ver `ler-arquivo-de-texto.js`). O PDF não dá: extrair texto
// de PDF exige lidar com a codificação de fonte de cada arquivo, e a extração
// ingênua devolveu tabela de fonte no PDF real da curadoria da Vessel. Um
// extrator que acerta às vezes é pior que nenhum — enche o campo de lixo calado.
//
// Então quem lê o PDF é a IA, que já tem chave neste servidor. É a mesma divisão
// do resto do projeto: a conta é do módulo puro, o julgamento é da IA.
//
// SEGURANÇA (idêntica à do `sugerir-publico-ia`, e pelo mesmo motivo — isto gasta
// dinheiro da conta de IA):
//  - verify_jwt + a MESMA permissão do resto da Gestão de Tráfego;
//  - a chave vive em `segredos_de_cron` (RLS ligada, ZERO políticas) e é lida
//    aqui. Ela NUNCA vai para o navegador.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MODELO = 'claude-opus-5';
// O campo da persona corta em 4.000 caracteres, então não adianta pedir mais —
// o teto aqui dá folga pro modelo pensar e ainda devolver o texto inteiro.
const MAX_TOKENS = 8000;
// 4,5 MB de base64 ≈ 3,3 MB de PDF. O teto da Anthropic é 32 MB de REQUISIÇÃO;
// este é bem menor de propósito: documento de marca não passa disso, e um PDF
// gigante viraria uma conta alta sem ninguém perceber.
const MAX_BASE64 = 4_500_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return json({ error: 'sem_credencial' }, 401);

  const sbUsuario = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await sbUsuario.auth.getUser();
  if (!user) return json({ error: 'nao_autenticado' }, 401);

  const sbServico = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data: perfil } = await sbServico
    .from('profiles').select('role, is_superadmin, features').eq('id', user.id).single();
  const pode = !!perfil && (perfil.role === 'admin' || perfil.is_superadmin
    || (Array.isArray(perfil.features) && perfil.features.includes('meta.gestor')));
  if (!pode) return json({ error: 'sem_permissao' }, 403);

  let corpo: any = {};
  try { corpo = await req.json(); } catch { return json({ error: 'corpo_invalido' }, 400); }

  // O base64 vem SEM o prefixo `data:` e SEM quebra de linha — a API recusa os dois.
  const base64 = typeof corpo.base64 === 'string' ? corpo.base64.replace(/\s/g, '') : '';
  if (!base64) return json({ error: 'sem_arquivo' }, 400);
  if (base64.length > MAX_BASE64) {
    return json({
      error: 'arquivo_grande_demais',
      detalhe: `O PDF tem cerca de ${Math.round(base64.length * 0.75 / 1024 / 1024)} MB e o limite aqui é ${Math.round(MAX_BASE64 * 0.75 / 1024 / 1024)} MB.`,
    }, 413);
  }
  const limite = Number.isFinite(Number(corpo.limite)) ? Math.min(Number(corpo.limite), 8000) : 4000;

  const { data: seg } = await sbServico
    .from('segredos_de_cron').select('segredo').eq('nome', 'anthropic_api_key_trafego').single();
  const chave = seg?.segredo;
  if (!chave) {
    return json({
      error: 'chave_nao_configurada',
      comoResolver: 'Rode uma vez o robô "Guardar a chave da IA onde o servidor alcança" nas Actions do repositório.',
    }, 503);
  }

  // O DOCUMENTO VEM ANTES DO TEXTO no conteúdo — é a ordem que a API pede.
  const pedido = [
    'Este documento descreve PARA QUEM uma marca vende (persona, público-alvo, curadoria de marca).',
    '',
    'Devolva o conteúdo dele como TEXTO CORRIDO em português, para ser colado num campo de formulário:',
    `- no máximo ${limite} caracteres;`,
    '- preserve a estrutura em parágrafos e tópicos que o documento usa;',
    '- NÃO invente nada que não esteja no documento, e não acrescente comentário seu;',
    '- se o documento tiver faixa etária, renda, cidade, o que a pessoa procura e o que NÃO combina com a marca, esses pontos são os mais importantes e não podem ficar de fora;',
    '- se não couber tudo, corte o que é decoração (história da marca, missão, visão) e mantenha o que descreve a PESSOA.',
    '',
    'Responda SÓ com o texto, sem preâmbulo e sem markdown de cabeçalho.',
  ].join('\n');

  let r: Response;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        // Extrair texto não é julgamento: esforço baixo economiza sem custar qualidade.
        output_config: { effort: 'low' },
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: pedido },
          ],
        }],
      }),
    });
  } catch (e) {
    return json({ error: 'anthropic_inacessivel', detalhe: String(e) }, 502);
  }

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    // A MENSAGEM INTEIRA da Anthropic vai junto. Truncar erro já custou três
    // investigações neste projeto.
    return json({ error: 'anthropic_recusou', status: r.status, detalhe: d?.error?.message || JSON.stringify(d).slice(0, 500) }, 502);
  }
  // O modelo pode recusar por segurança: aí `content` vem vazio e ler [0] quebra.
  if (d?.stop_reason === 'refusal') return json({ error: 'recusado_pela_ia' }, 502);

  const texto = (d?.content || []).map((c: any) => (c?.type === 'text' ? c.text : '')).join('').trim();
  if (!texto) return json({ error: 'sem_texto', detalhe: 'a IA não devolveu texto para este PDF' }, 502);

  return json({ ok: true, texto: texto.slice(0, limite), uso: d?.usage || null });
});

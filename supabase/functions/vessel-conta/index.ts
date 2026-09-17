// supabase/functions/vessel-conta/index.ts
// A PORTA DAS CONTAS DA CLIENTE (Registered Pieces).
//
// A página pública chama AQUI, com a chave anônima. As funções `vessel_conta_*`
// não são concedidas a `anon`: só esta edge as chama, com a chave de serviço.
//
// ⚠️ A SENHA GERADA SÓ SAI POR E-MAIL. A resposta devolve o e-mail mascarado.
//
// ⚠️ UMA EDGE SÓ, e não seis como a spec original desenhou. Publicar edge é o
// ponto frágil deste projeto (mais de uma pessoa publica, e quem publica por
// último vence — ver CLAUDE.md). Seis funções seriam seis publicações e seis
// cópias de `_shared`. O portão é o mesmo em todas as ações: a chave de
// serviço mora só aqui.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { gerarSenha } from '../_shared/senha-gerada.js';
import { textoDoPrimeiroAcesso, textoDaSenhaNova, mascararEmail } from '../_shared/email-textos.js';
import { mandarEmail } from '../_shared/email-zeptomail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false, motivo: 'metodo' }, 405);

  const corpo = await req.json().catch(() => null);
  if (!corpo?.acao) return responder({ ok: false, motivo: 'dados_invalidos' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const agente = req.headers.get('user-agent') ?? '';

  if (corpo.acao === 'criar') {
    const senha = gerarSenha();
    const { data } = await sb.rpc('vessel_conta_criar', {
      p_nome: corpo.nome, p_cpf: corpo.cpf, p_email: corpo.email,
      p_whatsapp: corpo.whatsapp ?? null, p_nascimento: corpo.nascimento ?? null,
      p_senha: senha,
    });
    if (!data?.ok) return responder(data ?? { ok: false, motivo: 'falhou' });
    const enviou = await mandarEmail(data.email, textoDoPrimeiroAcesso(corpo.nome, senha));
    // ⚠️ E-mail que não sai deixaria a cliente com perfil e sem senha. Nesse
    // caso a conta é apagada e ela tenta de novo, em vez de ficar travada.
    if (!enviou) {
      await sb.rpc('vessel_conta_apagar_recem_criada', { p_cliente_id: data.cliente_id });
      return responder({ ok: false, motivo: 'email_nao_saiu' });
    }
    return responder({ ok: true, email_mascarado: mascararEmail(data.email) });
  }

  if (corpo.acao === 'entrar') {
    const { data } = await sb.rpc('vessel_conta_entrar', {
      p_login: corpo.login, p_senha: corpo.senha, p_lembrar: corpo.lembrar === true,
      p_agente: agente, p_ip_hash: null,
    });
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'eu') {
    const { data } = await sb.rpc('vessel_conta_da_sessao', { p_token: corpo.token });
    return responder(data ?? { ok: false });
  }

  if (corpo.acao === 'sair') {
    const { data } = await sb.rpc('vessel_conta_sair', {
      p_token: corpo.token, p_todas: corpo.todas === true });
    return responder(data ?? { ok: true });
  }

  if (corpo.acao === 'esqueci') {
    const senha = gerarSenha();
    const { data } = await sb.rpc('vessel_conta_nova_senha', {
      p_login: corpo.login, p_senha: senha });
    // ⚠️ A RESPOSTA É IGUAL EXISTINDO OU NÃO O PERFIL. A função do banco
    // devolve o e-mail real quando o perfil existe (é assim que a gente sabe
    // para onde mandar a senha nova) — mas esse e-mail para AQUI. A página
    // recebe só {ok:true}, sempre, senão "esqueci minha senha" vira um jeito
    // de descobrir se um CPF/e-mail é cliente da marca. Há teste em
    // porta.test.mjs que reprova qualquer `email` ou `motivo` neste retorno.
    if (data?.email) await mandarEmail(data.email, textoDaSenhaNova('', senha));
    return responder({ ok: true });
  }

  if (corpo.acao === 'editar') {
    const { data } = await sb.rpc('vessel_conta_editar', {
      p_token: corpo.token, p_nome: corpo.nome ?? null, p_whatsapp: corpo.whatsapp ?? null,
      p_senha_atual: corpo.senha_atual ?? null, p_senha_nova: corpo.senha_nova ?? null,
    });
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  return responder({ ok: false, motivo: 'acao_desconhecida' }, 400);
});

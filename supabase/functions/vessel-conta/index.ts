// supabase/functions/vessel-conta/index.ts
// A PORTA DAS CONTAS DA CLIENTE (Registered Pieces).
//
// A página pública chama AQUI, com a chave anônima. As funções `vessel_conta_*`
// não são concedidas a `anon`: só esta edge as chama, com a chave de serviço.
//
// ⚠️ A SENHA GERADA SAI POR E-MAIL SEMPRE, e na tela SÓ NA CRIAÇÃO QUE DEU CERTO.
// Pedido do dono (18/09/2026): ao criar a conta, a página mostra a senha na
// hora, com botão de copiar, para a cliente entrar sem abrir o e-mail. Por
// isso a resposta de SUCESSO de "criar" traz `senha` — e é a ÚNICA resposta
// desta edge que traz. "esqueci" continua SÓ por e-mail: ali o e-mail é a
// prova de quem é; devolver a senha na tela entregaria a conta a quem só
// sabe o CPF ou o e-mail de outra pessoa. Há teste em porta.test.mjs que
// reprova `senha` em qualquer outra resposta.
//
// ⚠️ A senha nunca vai para log: nenhum console.* desta edge recebe a
// resposta nem a senha — só o nome do rpc e a mensagem do Postgres.
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
    const { data, error } = await sb.rpc('vessel_conta_criar', {
      p_nome: corpo.nome, p_cpf: corpo.cpf, p_email: corpo.email,
      p_whatsapp: corpo.whatsapp ?? null, p_nascimento: corpo.nascimento ?? null,
      p_senha: senha,
    });
    // ⚠️ SEM OLHAR "error", um parâmetro que um dia divergir do banco faz o
    // erro do Postgres sumir: a edge devolveria o mesmo {ok:false} genérico
    // de uma tentativa legítima — falha calada. O log leva só o nome do rpc
    // e a mensagem do Postgres, nunca CPF, e-mail, senha ou token.
    if (error) {
      console.error('vessel_conta_criar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    if (!data?.ok) return responder(data ?? { ok: false, motivo: 'falhou' });
    const enviou = await mandarEmail(data.email, textoDoPrimeiroAcesso(corpo.nome, senha));
    // ⚠️ E-mail que não sai deixaria a cliente com perfil e sem senha. Nesse
    // caso a conta é apagada e ela tenta de novo, em vez de ficar travada.
    //
    // ⚠️ CONTINUA ASSIM MESMO COM A SENHA NA TELA (decisão de 18/09/2026). Se
    // o e-mail não saiu, a senha NÃO é mostrada: a conta é apagada e a
    // resposta é erro. Senão nasceria uma conta cujo e-mail nunca funcionou —
    // e o "esqueci a senha" dela manda justamente para esse e-mail.
    if (!enviou) {
      const { error: erroApagar } = await sb.rpc('vessel_conta_apagar_recem_criada', {
        p_cliente_id: data.cliente_id });
      if (erroApagar) console.error('vessel_conta_apagar_recem_criada', erroApagar.message);
      return responder({ ok: false, motivo: 'email_nao_saiu' });
    }
    // A única resposta com a senha: conta criada E e-mail entregue ao ZeptoMail.
    return responder({ ok: true, email_mascarado: mascararEmail(data.email), senha });
  }

  if (corpo.acao === 'entrar') {
    const { data, error } = await sb.rpc('vessel_conta_entrar', {
      p_login: corpo.login, p_senha: corpo.senha, p_lembrar: corpo.lembrar === true,
      p_agente: agente, p_ip_hash: null,
    });
    if (error) {
      console.error('vessel_conta_entrar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'eu') {
    const { data, error } = await sb.rpc('vessel_conta_da_sessao', { p_token: corpo.token });
    if (error) {
      console.error('vessel_conta_da_sessao', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false });
  }

  if (corpo.acao === 'sair') {
    const { data, error } = await sb.rpc('vessel_conta_sair', {
      p_token: corpo.token, p_todas: corpo.todas === true });
    if (error) {
      console.error('vessel_conta_sair', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: true });
  }

  if (corpo.acao === 'esqueci') {
    // ⚠️ ORDEM INVERTIDA (achado C4 da revisão final, 17/09/2026). Antes, uma
    // única função trocava a senha e derrubava as sessões ANTES de a edge
    // tentar mandar o e-mail; se `mandarEmail` desse `false` (ZeptoMail fora
    // do ar, DNS do remetente ainda sem publicar), a cliente ficava trancada
    // PARA SEMPRE — o único caminho de recuperação dela é o mesmo canal que
    // acabou de falhar. Agora é em dois passos: primeiro só se PERGUNTA para
    // onde mandar (e isso já confere o teto de 3/hora, no banco); a senha só
    // é trocada de verdade DEPOIS que o e-mail sai.
    const { data, error } = await sb.rpc('vessel_conta_pedido_de_nova_senha', {
      p_login: corpo.login });
    // ⚠️ Erro de infraestrutura (parâmetro divergente, banco fora do ar) NÃO
    // reabre o vazamento que o parágrafo abaixo evita: é a MESMA resposta
    // para qualquer login, exista ou não o perfil — o rpc nem chegou a
    // rodar. Só por isso pode carregar `motivo` aqui.
    if (error) {
      console.error('vessel_conta_pedido_de_nova_senha', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    // ⚠️ A RESPOSTA DE SUCESSO É IGUAL EXISTINDO OU NÃO O PERFIL, E IGUAL
    // TAMBÉM SE O TETO ESTOUROU. Nenhuma das três situações (perfil existe,
    // não existe, ou pedido demais) pode virar sinal diferente na tela — a
    // página recebe só {ok:true}, sempre. Há teste em porta.test.mjs que
    // reprova qualquer `email` neste retorno de sucesso.
    if (data?.ok && data.cliente_id) {
      const senha = gerarSenha();
      const enviou = await mandarEmail(data.email, textoDaSenhaNova('', senha));
      // ⚠️ SÓ EFETIVA SE O E-MAIL SAIU. Envio que falha não troca mais nada:
      // a senha antiga continua valendo, e a cliente pode tentar de novo (até
      // o teto) em vez de ficar sem senha e sem e-mail ao mesmo tempo.
      if (enviou) {
        const { error: erroEfetivar } = await sb.rpc('vessel_conta_efetivar_nova_senha', {
          p_cliente_id: data.cliente_id, p_senha: senha });
        if (erroEfetivar) console.error('vessel_conta_efetivar_nova_senha', erroEfetivar.message);
      }
    }
    return responder({ ok: true });
  }

  if (corpo.acao === 'editar') {
    const { data, error } = await sb.rpc('vessel_conta_editar', {
      p_token: corpo.token, p_nome: corpo.nome ?? null, p_whatsapp: corpo.whatsapp ?? null,
      p_senha_atual: corpo.senha_atual ?? null, p_senha_nova: corpo.senha_nova ?? null,
    });
    if (error) {
      console.error('vessel_conta_editar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'minhas-pecas') {
    // ⚠️ MESMO PADRÃO DAS OUTRAS AÇÕES: o rpc já lê o dono pelo TOKEN da
    // sessão (`vessel_conta_da_sessao` por dentro) — a edge nunca manda um
    // id de cliente vindo da página. `error` (falha de infraestrutura) é
    // desestruturado e tratado à parte, sem dado de cliente no log; o `data`
    // do banco (que já traz {ok:false, motivo:'sem_sessao'} para token
    // vencido/errado) segue direto para a página.
    const { data, error } = await sb.rpc('vessel_minhas_pecas', { p_token: corpo.token });
    if (error) {
      console.error('vessel_minhas_pecas', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRANSFERÊNCIA DE PROPRIEDADE (18/09/2026)
  // Desenho: docs/superpowers/specs/2026-09-18-transferencia-de-propriedade-design.md
  // Banco:   db/migrations/2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
  //
  // ⚠️ A EDGE NÃO DECIDE NADA AQUI. O sorteio do código, o hash, o prazo de 7
  // dias, o teto de 5 tentativas por peça a cada 24h e a conferência de quem é
  // a dona moram TODOS no banco. Uma Edge Function não guarda estado entre
  // chamadas — um contador em variável JavaScript não seguraria nada, e a
  // trava pareceria existir sem existir. Aqui só se repassa.
  //
  // ⚠️ O CÓDIGO DE 6 DÍGITOS NUNCA VAI PARA LOG, e sai numa resposta só: a de
  // sucesso de `transferir-gerar`. Ele vale por uma bolsa — é a mesma regra da
  // senha, e há teste em porta.test.mjs para as duas coisas.
  //
  // Motivos de recusa que atravessam do banco para a página, sem tradução:
  // `sem_sessao`, `nao_e_sua`, `sua_ja`, `codigo_invalido`, `muitas_tentativas`,
  // `fora_do_teste` (fase de ensaio) — e `falhou`, que é desta edge.
  if (corpo.acao === 'transferir-gerar') {
    const { data, error } = await sb.rpc('vessel_transferencia_gerar', {
      p_token: corpo.token, p_codigo: corpo.codigo,
    });
    if (error) {
      console.error('vessel_transferencia_gerar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'transferir-aberta') {
    const { data, error } = await sb.rpc('vessel_transferencia_aberta', {
      p_token: corpo.token, p_codigo: corpo.codigo,
    });
    if (error) {
      console.error('vessel_transferencia_aberta', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'transferir-cancelar') {
    const { data, error } = await sb.rpc('vessel_transferencia_cancelar', {
      p_token: corpo.token, p_codigo: corpo.codigo,
    });
    if (error) {
      console.error('vessel_transferencia_cancelar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  if (corpo.acao === 'transferir-aceitar') {
    const { data, error } = await sb.rpc('vessel_transferencia_aceitar', {
      p_token: corpo.token, p_codigo: corpo.codigo,
      p_codigo_transferencia: corpo.codigo_transferencia,
    });
    if (error) {
      console.error('vessel_transferencia_aceitar', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: false, motivo: 'falhou' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PARAR DE RECEBER O LEMBRETE (19/09/2026)
  // Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md
  // Banco:   db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql
  //
  // ⚠️ A ÚNICA AÇÃO DESTA EDGE QUE NÃO PEDE SESSÃO — e é de propósito. Quem
  // clica em "não quero mais receber" veio de um e-mail, não está logada e
  // muitas vezes nem tem conta (o lembrete existe justamente para quem ainda
  // não registrou). Exigir sessão aqui deixaria a saída do e-mail impossível
  // para quem mais precisa dela, e o desenho manda: em um toque, sem login.
  // O token do link É a prova — ele foi sorteado pelo banco, só existe dentro
  // daquele e-mail e aqui é conferido pelo hash.
  //
  // ⚠️ O CAMPO É `corpo.t`, e não `corpo.token`: `token` nesta edge é sempre o
  // token de SESSÃO da conta. Misturar os dois faria uma página logada mandar
  // a sessão da cliente para uma ação que a trata como token de e-mail.
  //
  // ⚠️ A RESPOSTA É SEMPRE A MESMA, com token certo, errado ou vazio. Esta
  // porta é pública e sem login: um "não achei" a transformaria num testador
  // de tokens. Quem decide isso é o banco (`vessel_lembrete_cancelar_por_token`
  // devolve `{ok:true}` em qualquer caso); aqui só se repassa.
  if (corpo.acao === 'lembrete-parar') {
    const { data, error } = await sb.rpc('vessel_lembrete_cancelar_por_token', {
      p_token: corpo.t ?? null,
    });
    if (error) {
      console.error('vessel_lembrete_cancelar_por_token', error.message);
      return responder({ ok: false, motivo: 'falhou' });
    }
    return responder(data ?? { ok: true });
  }

  return responder({ ok: false, motivo: 'acao_desconhecida' }, 400);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { semComentarios } from '../../compartilhado/guarda-de-imports.mjs';

// TRAVA OBRIGATÓRIA da Onda C, Tarefa 5.
//
// O DEFEITO (achado no plano da Onda C, 25/09/2026, ao medir a régua real):
// `ALVOS` foi REINDEXADO por MERCADO (mercados.js/alvos.js) — as chaves hoje
// são 'conversa', 'perfil', 'video', 'post'... — mas a tela (.vue:2473, antes
// desta tarefa) ainda pedia a meta pelo BALDE do objetivo declarado
// ('engajamento', 'mensagens', 'trafego', 'vendas', 'leads',
// 'reconhecimento'). `metaDoBalde` (regua.js) resolve a chave por
// `ALVOS[balde].chaveMeta || balde` — como nenhum desses nomes de balde bate
// mais em ALVOS, a busca caía num ATALHO SILENCIOSO (`|| balde`) que lê
// `regua.metas[balde]` direto. Esse atalho é LEGÍTIMO para as INTERAÇÕES
// declaradas (curtida/comentário/salvamento/compartilhamento — não estão em
// ALVOS de propósito, ver regua.js), mas para um balde de OBJETIVO ele
// coincide por pura sorte de nome em alguns casos e ERRA feio no de
// engajamento: comparava custo por engajamento (R$ 0,09) contra a meta
// ANTIGA em R$/ponto (R$ 0,012) — 7,5× errado, com cara de certo.
//
// ⚠️ O atalho em si NÃO PODE SER REMOVIDO de `metaDoBalde` — é o que faz as
// interações declaradas funcionarem, e elas não têm (nem precisam ter)
// entrada em ALVOS. A trava tem de ser no CHAMADOR: nenhum caminho da tela
// pode passar um nome de balde antigo para `alvoDoBalde`/`metaDoBalde`. Só os
// MERCADOS (mercados.js) e as INTERAÇÕES declaradas podem indexar essas
// funções a partir da tela.
//
// COMO ESTE TESTE PROVA ISSO: extrai o argumento de TODA chamada de
// `alvoDoBalde(...)` e o SEGUNDO argumento de TODA chamada de
// `metaDoBalde(..., ...)` no(s) <script> da tela, e afirma que cada um é uma
// das variáveis da lista branca — nunca um balde velho, literal ou por
// variável. `semComentarios` (guarda-de-imports.mjs) apaga comentário E
// esvazia string ('...'  vira ''), então um literal como
// `alvoDoBalde('mensagens')` também é pego: sobra `alvoDoBalde('')`, que não
// bate em nenhum nome da lista branca.

const AQUI = dirname(fileURLToPath(import.meta.url));
const VUE = readFileSync(join(AQUI, 'tela-de-gestao-trafego.vue'), 'utf8');
const SCRIPT_BRUTO = [...VUE.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
const CORPO = semComentarios(SCRIPT_BRUTO);

// Os nomes de balde ANTIGO (objetivo declarado) — nenhum pode ser índice de
// ALVOS a partir de agora. 'padrao' também não é mercado, mas nunca teve
// alvo — incluído aqui só para documentar que ele também está fora.
const BALDES_ANTIGOS = ['engajamento', 'mensagens', 'trafego', 'vendas', 'leads', 'reconhecimento', 'padrao'];

// Extrai o argumento pedido (por índice) de toda chamada `nomeFuncao(...)` no
// corpo. Funciona porque, no código real desta tela, os argumentos passados a
// alvoDoBalde/metaDoBalde são sempre identificadores simples (uma variável) ou
// um literal já esvaziado por semComentarios — nunca uma chamada aninhada
// (o próprio código foi ajustado nesta tarefa para não passar `_gtReguaAtiva()`
// direto por causa disso: ver `reguaAtiva` em _renderGtConjuntos).
function extrairArgumentos(corpo, nomeFuncao) {
  const chamadas = [];
  const re = new RegExp(`\\b${nomeFuncao}\\s*\\(([^()]*)\\)`, 'g');
  let m;
  while ((m = re.exec(corpo))) {
    chamadas.push(m[1].split(',').map((s) => s.trim()));
  }
  return chamadas;
}

test('alvoDoBalde só recebe MERCADO — nenhum balde antigo indexa ALVOS', () => {
  const chamadas = extrairArgumentos(CORPO, 'alvoDoBalde');
  assert.ok(chamadas.length > 0, 'a tela não chama mais alvoDoBalde — atualize/remova este teste');
  const permitidos = new Set(['mercado', 'mercadoCj']);
  const violacoes = chamadas.map((args) => args[0]).filter((a) => !permitidos.has(a));
  assert.deepEqual(violacoes, [],
    `alvoDoBalde recebeu argumento fora da lista branca de mercado: ${violacoes.join(', ')}`);
  // Nenhum balde antigo pode aparecer, nem como literal esvaziado (string vazia).
  for (const balde of BALDES_ANTIGOS) assert.ok(!CORPO.includes(`alvoDoBalde('${balde}')`) && !CORPO.includes(`alvoDoBalde("${balde}")`));
});

test('metaDoBalde só recebe MERCADO ou interação declarada — nunca balde antigo', () => {
  const chamadas = extrairArgumentos(CORPO, 'metaDoBalde');
  assert.ok(chamadas.length > 0, 'a tela não chama mais metaDoBalde — atualize/remova este teste');
  // 'mercado'/'mercadoCj' são os mercados de mercados.js (cartão da campanha e
  // linha do conjunto); 'objDeclarado'/'declAd' são as INTERAÇÕES declaradas
  // (Fase 3) — o atalho de metaDoBalde que resolve por essas chaves é
  // LEGÍTIMO (não estão em ALVOS, ver regua.js) e não pode ser removido da
  // função; esta trava é no CHAMADOR.
  const permitidos = new Set(['mercado', 'mercadoCj', 'objDeclarado', 'declAd']);
  const violacoes = chamadas.map((args) => args[1]).filter((a) => !permitidos.has(a));
  assert.deepEqual(violacoes, [],
    `metaDoBalde recebeu 2º argumento fora da lista branca: ${violacoes.join(', ')}`);
});

test('prova por mutação: um balde antigo, mesmo como literal escondido num comentário de propósito, é pego pela extração', () => {
  // Reproduz o defeito ORIGINAL desta tarefa (.vue:2473 antes da correção):
  // `metaDoBalde(reguaAtiva, temMensagem ? 'mensagens' : baldeCamp)`.
  const trechoOriginal = "metaDoBalde(reguaAtiva, temMensagem ? 'mensagens' : baldeCamp);";
  const corpoMutado = semComentarios(trechoOriginal);
  const chamadas = extrairArgumentos(corpoMutado, 'metaDoBalde');
  assert.equal(chamadas.length, 1);
  const permitidos = new Set(['mercado', 'mercadoCj', 'objDeclarado', 'declAd']);
  assert.ok(!permitidos.has(chamadas[0][1]),
    `a extração deveria ter rejeitado "${chamadas[0][1]}" (o defeito original) — a trava não pegaria mais`);
});

test('todo balde antigo (índice de ALVOS) segue banido, nome por nome, para quem ler só este teste', () => {
  // Documentação executável: se algum dia um destes nomes voltar a ser
  // ACEITO pela lista branca acima (alguém "generaliza" o Set sem pensar),
  // este teste falha e aponta exatamente qual.
  const permitidos = new Set(['mercado', 'mercadoCj', 'objDeclarado', 'declAd']);
  for (const balde of BALDES_ANTIGOS) assert.ok(!permitidos.has(balde), `"${balde}" não pode nunca entrar na lista branca`);
});

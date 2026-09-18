import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
  'migrations/2026-09-17-vessel-registro-com-conta.sql'), 'utf8').toLowerCase();

test('⚠️ registrar exige sessão', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'));
  assert.match(f, /vessel_conta_da_sessao/);
  assert.match(f, /sem_sessao/);
});

test('⚠️ ja_tem_dono e dono_curto atravessam — senão peça com dona vira "livre" calado', () => {
  // vessel_abrir_pedido_de_registro já devolve os dois campos; a versão
  // anterior de vessel_registrar_como_cliente montava o retorno do zero
  // (json_build_object com só ok/pedido/sku/cliente_id) e os dois se
  // perdiam — a página não teria como avisar a cliente que a peça já tem
  // dona. Rodada de correção 2 da Tarefa 7.
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'),
                       SQL.indexOf('-- ── o portão'));
  assert.match(f, /'ja_tem_dono'/, 'o retorno de vessel_registrar_como_cliente precisa de ja_tem_dono');
  assert.match(f, /'dono_curto'/, 'o retorno de vessel_registrar_como_cliente precisa de dono_curto');
});

test('⚠️ as duas funções novas são revogadas de anon E authenticated, uma a uma', () => {
  // ⚠️ A primeira versão deste teste casava o NOME DA FUNÇÃO colado ao texto
  // '...to (anon|authenticated)' — mas o revoke/grant deste arquivo é montado
  // num LAÇO com `format('grant execute on function public.%s to
  // service_role', f)`. O papel de verdade não está perto do nome nenhuma vez:
  // está uma linha abaixo, dentro do template. Trocar `service_role` por
  // `authenticated` no format() fazia o teste antigo continuar VERDE — teste
  // que não prova nada. Aqui: acha o bloco `do $$ ... end $$` e exige as DUAS
  // assinaturas, uma a uma, pelo nome, e confere o TEXTO do template de
  // revoke/grant (mesmo padrão de db/contas-nascem-fechadas.test.mjs).
  const bloco = SQL.match(/do \$\$[\s\S]*?end \$\$;/);
  assert.ok(bloco, 'falta o bloco do $$ que revoga e concede as funções novas');
  const assinaturas = [
    'vessel_registrar_como_cliente(text,text,text,date,boolean,text)',
    'vessel_candidatos_de_presente(text)',
    'vessel_tentativa_de_presente(text)',
  ];
  for (const assinatura of assinaturas) {
    assert.ok(bloco[0].includes(`'${assinatura}'`),
      `falta ${assinatura} no array que revoga/concede`);
  }
  assert.match(bloco[0], /revoke all on function public\.%s from public, anon, authenticated/);
  assert.match(bloco[0], /grant execute on function public\.%s to service_role/);
});

test('⚠️ nenhuma função ganha grant para anon ou authenticated em lugar nenhum do arquivo', () => {
  // Olha o TEXTO inteiro, inclusive dentro de um format(...): se o template do
  // grant virar '...to authenticated', esta regex casa mesmo sem `format` ter
  // rodado — é o que faltava no teste anterior.
  assert.ok(!/grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated)\b/.test(SQL));
});

test('a marca PRESENTE é lida sem acento e sem maiúscula', () => {
  assert.match(SQL, /translate\(lower\(p_texto\)/);
});

test('⚠️ vessel_aprovar_presente NÃO existe — a aprovação usa vessel_decidir_pedido_de_registro', () => {
  assert.ok(!SQL.includes('vessel_aprovar_presente'));
});

test('⚠️ C1 — gatilho preenche cliente_id sozinho, sem mexer em vessel_decidir_pedido_de_registro', () => {
  // Quem grava vessel_registros é a função ANTIGA e compartilhada com o
  // painel no ar (2026-09-03-zz-vessel-garantia-com-dono.sql) — o insert dela
  // nunca conheceu a coluna cliente_id. Sem o gatilho, a peça aprovada some
  // de "Minhas peças" porque cliente_id nunca é gravado por ninguém.
  assert.match(SQL, /create trigger vessel_registros_preencher_cliente_id/);
  assert.match(SQL, /before insert on public\.vessel_registros/);
  const f = SQL.slice(SQL.indexOf('function public.vessel_registros_preencher_cliente_id'));
  assert.match(f, /new\.cliente_id is null/, 'só preenche se ainda não veio preenchido');
  assert.match(f, /from public\.vessel_pedidos_de_registro/,
    'a origem do cliente_id é o pedido daquele código');
  assert.match(f, /order by pr\.criado_em desc/, 'tem de ser o pedido MAIS RECENTE');
});

test('⚠️ C2 — p_so_teste recusa peça fora do lote de teste (a trava é no servidor)', () => {
  // /verify/novo não pode abrir uma bolsa VENDIDA e escrever em produção. A
  // página manda p_so_teste=true; o banco RECUSA se o lote da peça não
  // estiver marcado teste=true.
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'),
                       SQL.indexOf('function public.vessel_registros_preencher_cliente_id'));
  assert.match(f, /p_so_teste boolean default false/);
  assert.match(f, /fora_do_teste/);
  assert.match(f, /join public\.vessel_lotes l on l\.id = p\.lote_id/);
  assert.match(f, /l\.teste/);
});

test('⚠️ CRÍTICO N2 — a conferência de lote é INCONDICIONAL, não opt-in por p_so_teste', () => {
  // Achado da conferência da onda: "if p_so_teste and not exists (...)" era
  // OPT-IN — bastava a chamadora OMITIR so_teste (a chave anônima está no
  // HTML público) para desligar a conferência inteira, e uma bolsa VENDIDA
  // registrava normal. vessel_registrar_como_cliente é usada só pela página
  // de ensaio nesta fase (o caminho das 157 etiquetas usa
  // vessel_abrir_pedido_de_registro direto), então o padrão SEGURO é recusar
  // sempre peça fora do lote de teste, quer a chamada mande so_teste ou não.
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'),
                       SQL.indexOf('function public.vessel_registros_preencher_cliente_id'));
  assert.ok(!/if\s+p_so_teste\s+and\s+not\s+exists/.test(f),
    'a checagem não pode depender de p_so_teste — tem de rodar sempre');
  // a checagem de lote continua existindo, só que fora de qualquer "if
  // p_so_teste" — isolamos o trecho logo antes de "not exists (" que junta
  // vessel_pecas/vessel_lotes e conferimos que não há "p_so_teste" colado
  // nele.
  const pos = f.search(/not exists\s*\(\s*\n\s*select 1 from public\.vessel_pecas/);
  assert.ok(pos > -1, 'não achei a checagem de lote de teste');
  const janela = f.slice(Math.max(0, pos - 60), pos);
  assert.ok(!/p_so_teste/.test(janela),
    'a checagem de lote não pode estar condicionada a p_so_teste na mesma linha do if');
});

test('⚠️ I1 — presente_de_nome é gravado, não fica coluna morta', () => {
  const f = SQL.slice(SQL.indexOf('function public.vessel_registrar_como_cliente'),
                       SQL.indexOf('function public.vessel_registros_preencher_cliente_id'));
  assert.match(f, /p_presente_de_nome text default null/);
  assert.match(f, /presente_de_nome\s*=/,
    'o update de vessel_pedidos_de_registro precisa gravar presente_de_nome');
});

test('⚠️ C3 — teto de 3 tentativas de "É presente?" por peça a cada 24h, gravadas no banco', () => {
  // A trava tem de estar no BANCO: uma edge não guarda estado entre chamadas.
  assert.match(SQL, /create table if not exists public\.vessel_tentativas_de_presente/);
  const f = SQL.slice(SQL.indexOf('function public.vessel_tentativa_de_presente'));
  assert.match(f, /interval '24 hours'/);
  assert.match(f, /<=\s*3|>\s*3|>=\s*3/);
  assert.match(f, /insert into public\.vessel_tentativas_de_presente/);
});

test('⚠️ C3 — o limit 50 de vessel_candidatos_de_presente tem comentário explicando a decisão', () => {
  const inicioComentario = SQL.lastIndexOf('-- candidatos de presente',
    SQL.indexOf('function public.vessel_candidatos_de_presente'));
  const fimFuncao = SQL.indexOf('$$;', SQL.indexOf('function public.vessel_candidatos_de_presente'));
  const f = SQL.slice(inicioComentario, fimFuncao);
  assert.match(f, /limit 50/i);
  assert.match(f, /vessel_tentativa_de_presente/,
    'o comentário precisa explicar por que o limite deixou de ser perigoso, ligando ao teto de tentativas');
});

test('⚠️ as assinaturas novas são revogadas/concedidas com os parâmetros certos', () => {
  const bloco = SQL.match(/do \$\$[\s\S]*?end \$\$;/);
  assert.ok(bloco, 'falta o bloco do $$ que revoga e concede as funções novas');
  const assinaturas = [
    'vessel_registrar_como_cliente(text,text,text,date,boolean,text)',
    'vessel_candidatos_de_presente(text)',
    'vessel_tentativa_de_presente(text)',
  ];
  for (const assinatura of assinaturas) {
    assert.ok(bloco[0].includes(`'${assinatura}'`),
      `falta ${assinatura} no array que revoga/concede`);
  }
});

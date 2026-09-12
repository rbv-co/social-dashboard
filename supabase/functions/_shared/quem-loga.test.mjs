import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginDaPessoa, pessoaDoUsuario, pessoasSemLogin } from './quem-loga.js';

// O caso que motivou este arquivo, medido em producao em 2026-08-11.
// A Raissa tem login e a ficha dela traz o e-mail corporativo certo, mas o
// profile_id nunca foi ligado. A tela a reconhecia (casava por e-mail) e o
// aviso das 7h30 a pulava em silencio (exigia profile_id). Duas respostas
// diferentes pra mesma pergunta.
const RAISSA = { id: 'p-raissa', nome: 'Raissa Herculano', profile_id: null, email_corporativo: 'raissaherculano@rbvcompany.com' };
const BRENO = { id: 'p-breno', nome: 'Breno', profile_id: 'u-breno', email_corporativo: 'breno@rbvcompany.com' };
const BARBARA = { id: 'p-barbara', nome: 'Barbara Franco', profile_id: null, email_corporativo: 'barbara.franco@vesselbrasil.com.br' };

const USUARIOS = [
  { id: 'u-breno', email: 'breno@rbvcompany.com' },
  { id: 'u-raissa', email: 'raissaherculano@rbvcompany.com' },
];

test('o elo direto continua valendo, e vem na frente', () => {
  assert.equal(loginDaPessoa(BRENO, USUARIOS), 'u-breno');
});

test('sem o elo, o e-mail resolve — o caso da Raissa', () => {
  // Era exatamente aqui que o aviso desistia com um `continue` mudo.
  assert.equal(loginDaPessoa(RAISSA, USUARIOS), 'u-raissa');
});

test('quem nao tem login mesmo continua sem login', () => {
  // A Barbara nao tem conta nenhuma: a resposta certa e nulo, nao um chute.
  assert.equal(loginDaPessoa(BARBARA, USUARIOS), null);
});

test('o e-mail casa ignorando caixa e espaco em volta', () => {
  const p = { id: 'x', profile_id: null, email_corporativo: '  RaissaHerculano@RBVcompany.com ' };
  assert.equal(loginDaPessoa(p, USUARIOS), 'u-raissa');
});

test('ficha sem e-mail e sem elo nao casa com usuario sem e-mail', () => {
  // O perigo de comparar vazio com vazio: duas ausencias nao sao a mesma pessoa.
  const p = { id: 'x', profile_id: null, email_corporativo: null };
  const us = [{ id: 'u-vazio', email: null }, { id: 'u-outro', email: '' }];
  assert.equal(loginDaPessoa(p, us), null);
});

test('elo apontando pra usuario que nao existe mais nao inventa login', () => {
  // Usuario removido: o profile_id fica pendurado na ficha. Cair no e-mail
  // aqui e o certo — e se nem o e-mail achar, e nulo.
  const p = { id: 'x', profile_id: 'u-apagado', email_corporativo: 'breno@rbvcompany.com' };
  assert.equal(loginDaPessoa(p, USUARIOS), 'u-breno');
  const semNada = { id: 'y', profile_id: 'u-apagado', email_corporativo: 'ninguem@rbvcompany.com' };
  assert.equal(loginDaPessoa(semNada, USUARIOS), null);
});

test('sem pessoa, sem lista, sem estouro', () => {
  assert.equal(loginDaPessoa(null, USUARIOS), null);
  assert.equal(loginDaPessoa(BRENO, null), null);
  assert.equal(loginDaPessoa(undefined, undefined), null);
});

// --- o caminho inverso: quem esta logado, qual ficha e a dele ---

test('a tela acha a ficha pelo e-mail de quem entrou', () => {
  const eu = { id: 'u-raissa', email: 'raissaherculano@rbvcompany.com' };
  assert.equal(pessoaDoUsuario(eu, [RAISSA, BRENO, BARBARA]).id, 'p-raissa');
});

test('a tela tambem acha pelo elo, quando o e-mail da ficha esta vazio', () => {
  // O espelho do defeito: ficha ligada ao login mas sem e-mail preenchido. A
  // tela antiga so olhava e-mail e nao achava ninguem.
  const semEmail = { id: 'p-x', profile_id: 'u-breno', email_corporativo: null };
  const eu = { id: 'u-breno', email: 'breno@rbvcompany.com' };
  assert.equal(pessoaDoUsuario(eu, [semEmail]).id, 'p-x');
});

test('quem entrou e nao tem ficha recebe nulo, nao a ficha de outro', () => {
  const eu = { id: 'u-novo', email: 'novo@rbvcompany.com' };
  assert.equal(pessoaDoUsuario(eu, [RAISSA, BRENO]), null);
});

test('usuario sem e-mail nao casa com ficha sem e-mail', () => {
  const p = { id: 'p-x', profile_id: null, email_corporativo: null };
  assert.equal(pessoaDoUsuario({ id: 'u-x', email: null }, [p]), null);
});

// --- o que torna a falha VISIVEL, que era o pior do defeito ---

test('a lista de quem ficaria sem aviso sai nomeada', () => {
  // O `continue` mudo nao deixava rastro: ninguem descobria que a Raissa
  // estava fora. Agora quem chama consegue dizer QUEM ficou de fora e por que.
  const fora = pessoasSemLogin([BRENO, RAISSA, BARBARA], USUARIOS);
  assert.deepEqual(fora.map((p) => p.nome), ['Barbara Franco']);
});

test('com todo mundo ligado, a lista de fora fica vazia', () => {
  assert.deepEqual(pessoasSemLogin([BRENO, RAISSA], USUARIOS), []);
});

test('a mesma pessoa nao aparece duas vezes na lista de fora', () => {
  // quemFaltaHoje pode trazer a mesma pessoa em dois carros.
  const fora = pessoasSemLogin([BARBARA, BARBARA], USUARIOS);
  assert.equal(fora.length, 1);
});

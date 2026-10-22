// Pré-carregado por `npm test` (node --test --import). O Supabase da Central foi
// desligado: nenhum teste pode logar nele nem abrir conexão com ele. Em 22/10/2026
// o contador de logins mexeu porque `npm test` no Mac lia `coletor/.env` e os
// testes da Fábrica logavam de verdade (achado 08-7 do POS-VIRADA).
//
// 1) zera as credenciais e impede o carregar-env de recolocá-las;
// 2) recusa DNS/conexão para *.supabase.co/.com e para o host-placeholder
//    `supabase-desligado.invalid` (o padrão dos scripts sem SUPABASE_URL).
import dns from 'node:dns';

for (const k of Object.keys(process.env)) {
  if (/^(SUPABASE_|GESTOR_USER_)/.test(k)) delete process.env[k];
}
process.env.COLETOR_ENV = '/nao-existe/coletor.env';   // carregar-env não acha o arquivo: teste é hermético

const PROIBIDO = /(^|\.)supabase\.(co|com)$|(^|\.)supabase-desligado\.invalid$/i;
const erro = (host) => new Error(`teste tentou falar com o Supabase desligado (${host}): use servidor falso`);

const lookup = dns.lookup;
dns.lookup = function (host, ...resto) {
  if (PROIBIDO.test(String(host))) {
    const cb = resto.find((x) => typeof x === 'function');
    return cb ? process.nextTick(cb, erro(host)) : undefined;
  }
  return lookup.call(this, host, ...resto);
};
const lookupP = dns.promises.lookup;
dns.promises.lookup = (host, ...resto) =>
  PROIBIDO.test(String(host)) ? Promise.reject(erro(host)) : lookupP.call(dns.promises, host, ...resto);

const fetchOriginal = globalThis.fetch;
globalThis.fetch = async function (entrada, ...resto) {
  const url = typeof entrada === 'string' ? entrada : entrada?.url ?? String(entrada);
  let host = '';
  try { host = new URL(url).hostname; } catch { /* URL relativa: deixa o fetch reclamar */ }
  if (PROIBIDO.test(host)) throw erro(host);
  return fetchOriginal.call(this, entrada, ...resto);
};
globalThis.fetch.guardaSemSupabase = true;

// Confere, pela MESMA via dos robôs (host -> IP do api-db na api_net, driver `pg`), que cada papel do env conecta com a senha gravada.
// Uso (na VPS, Node 22 de /opt/cartoes-ean/node/bin, de dentro de coletor/ para achar o `pg`):
//   node ../ops/virada/janela/conferir-papeis.mjs /etc/robos.env [/etc/cartoes-ean.env]
// Lê o env como TEXTO (nunca `source`). Confere toda `*_DATABASE_URL` com `@api-db:` e as senhas soltas (COPIA_DB_SENHA, CONTEUDO_DB_SENHA,
// CARTOES_DB_SENHA). Imprime só `ok <papel>` ou `FALHOU <papel>: <mensagem>`; senha e URL nunca saem. Saída 0 só se todos conectarem.
// Variáveis: API_DB_IP (pula o docker inspect), BANCO (força o banco, para ensaiar no clone api_corte).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const SOLTAS = [['COPIA_DB_SENHA', 'copia'], ['CONTEUDO_DB_SENHA', 'conteudo_robo'], ['CARTOES_DB_SENHA', 'robo_cartoes']];

export function lerEnv(texto) {
  const env = {};
  for (const l of texto.split('\n')) {
    const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

/** Lista de conexões a testar: [{rotulo, config}]. `ip` troca `api-db`; `banco` (opcional) força o banco. */
export function alvos(env, ip, banco) {
  const out = [];
  for (const [k, v] of Object.entries(env)) {
    if (!/_DATABASE_URL$/.test(k) || !v.includes('@api-db:')) continue;
    const u = new URL(v.replace('@api-db:', `@${ip}:`));
    out.push({ rotulo: decodeURIComponent(u.username), esperado: decodeURIComponent(u.username),
      config: { host: u.hostname, port: Number(u.port) || 5432, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: banco || u.pathname.slice(1) } });
  }
  const base = out[0]?.config;
  for (const [k, papel] of SOLTAS) {
    if (!env[k]) continue;
    if (!base) throw new Error(`${k} sem nenhuma *_DATABASE_URL para saber o banco`);
    out.push({ rotulo: papel, esperado: papel, config: { ...base, user: papel, password: env[k] } });
  }
  return out;
}

async function main() {
  const pg = createRequire(`${process.cwd()}/`)('pg'); // o `pg` mora em coletor/node_modules: rode de dentro de coletor/
  const [envPath, ...outros] = process.argv.slice(2);
  if (!envPath) { console.error('uso: conferir-papeis.mjs <robos.env> [outro.env ...]'); process.exit(2); }
  const env = lerEnv(readFileSync(envPath, 'utf8'));
  for (const f of outros) Object.assign(env, lerEnv(readFileSync(f, 'utf8')));
  const ip = process.env.API_DB_IP || execFileSync('docker', ['inspect', '-f', '{{(index .NetworkSettings.Networks "api_net").IPAddress}}', 'api-db']).toString().trim();
  if (!ip) { console.error('FALHOU: sem IP do api-db na api_net'); process.exit(1); }
  const lista = alvos(env, ip, process.env.BANCO);
  if (!lista.length) { console.error('FALHOU: nenhuma URL do api-db no env'); process.exit(1); }
  let ruins = 0;
  for (const a of lista) {
    const c = new pg.Client({ ...a.config, connectionTimeoutMillis: 8000, ssl: false });
    try {
      await c.connect();
      const { rows: [r] } = await c.query('select current_user as u');
      if (r.u !== a.esperado) throw new Error(`conectou como ${r.u}`);
      console.log(`ok ${a.rotulo}`);
    } catch (e) { ruins++; console.log(`FALHOU ${a.rotulo}: ${String(e.message).replace(a.config.password, '***')}`); }
    finally { await c.end().catch(() => {}); }
  }
  console.log(`${lista.length - ruins}/${lista.length} papéis conectam`);
  process.exit(ruins ? 1 : 0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('FALHOU:', e.code || e.name); process.exit(1); }); // nunca imprime e.message/input (poderia ter a senha)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* A VIRADA DO SUPABASE PARA A CENTRAL (API em Go + Postgres próprio): QUAIS ROBÔS TÊM DESTINO.
 *
 * Depois da virada não existe PostgREST. O robô que fala com o banco por `pg` (DATABASE_URL) segue com a URL nova; o que fala
 * por REST (`rest/v1` + SUPABASE_SERVICE_KEY) encontra o Supabase CONGELADO (leitura velha, escrita 42501) e para de
 * trabalhar. Trocar `CENTRAL_API_URL`/`CENTRAL_API_TOKEN` no /etc/robos.env NÃO muda isso: essas duas variáveis só servem às
 * edges portadas (`/bling-proxy`, `/meta-proxy`) e às rotas da Fábrica. Achado 06-1 (REVISAO-TESTES-2026-10/ACHADOS-06.md).
 *
 * Este arquivo trava o que foi LIDO do código em 15/10/2026, robô por robô:
 *   'pg'          nenhum acesso REST: a troca da DATABASE_URL basta;
 *   'pg-ou-rest'  tem o caminho `pg` por uma variável própria (COPIA_/VIGIA_DATABASE_URL) e o REST como fallback;
 *   'rest'        só REST: SEM DESTINO até o achado 06-1 ser decidido.
 * Robô novo na agenda da VPS sem linha aqui reprova; robô migrado de 'rest' para 'pg' reprova até a linha mudar (e o achado
 * fechar). Não prova que o robô FUNCIONA no banco novo: prova que a classificação do inventário é a do código. */

const AQUI = dirname(fileURLToPath(import.meta.url));
const ler = (f) => readFileSync(join(AQUI, f), 'utf8');

// Como o robô chega ao banco: REST direto, ou uma função que o faz por REST.
const USA_REST = /rest\/v1|SUPABASE_SERVICE_KEY|\$\{REST\}|\bREST\s*\+|\b(?:ajustesDeValor|linhasDaJanela|conexaoZoho|blingPedidos|subirStorageResiliente|salvarVisitasPerfilDoDia)\(/;

// agenda da VPS (coletor/vps/robos.cron): nome -> scripts que a linha roda
const AGENDADOS = {
  'publicar-o-site': { arquivos: [], acesso: 'pg' },                       // só `git pull` + deploy do site; não toca banco
  'fotos-do-selo': { arquivos: ['fotos-do-selo-do-bling.mjs'], acesso: 'pg' },
  'notas-dos-pedidos': { arquivos: ['notas-dos-pedidos.mjs'], acesso: 'rest' },
  'pedidos-da-vessel': { arquivos: ['trazer-vendedores-do-bling.mjs', 'trazer-pedidos-do-bling.mjs'], acesso: 'pg' },
  'pedidos-da-shopify': { arquivos: ['trazer-pedidos-da-shopify.mjs'], acesso: 'pg' },
  'copia-do-banco': { arquivos: ['guardar-copia-do-banco.mjs', 'restaurar-copia.mjs'], acesso: 'pg-ou-rest', variavel: 'COPIA_DATABASE_URL' },
  'faxina-storage': { arquivos: ['faxina-fabrica.mjs', 'vigia-armazenamento.mjs'], acesso: 'rest' },
  'meta-ads-no-zoho': { arquivos: ['meta-ads-no-zoho.mjs'], acesso: 'pg' },
  'cards-comercial-diario': { arquivos: ['atualizar-cards-comercial.mjs'], acesso: 'rest' },
  'relatorios-comerciais': { arquivos: ['relatorios-comerciais.mjs'], acesso: 'rest' },
  'vigia-problemas-meta': { arquivos: ['vigia-problemas-meta.mjs'], acesso: 'pg-ou-rest', variavel: 'VIGIA_DATABASE_URL' },
  'coletor-noticias': {
    arquivos: ['passo-lojas.mjs', 'ig-coletor.mjs', 'agente-noticias.mjs', 'passo-enriquece.mjs', 'panorama-mercado.mjs', 'passo-faxina.mjs', 'passo-verifica.mjs'],
    acesso: 'rest',
  },
  'gestor-comercial': { arquivos: ['gestor-comercial.mjs'], acesso: 'rest' },
  'sugerir-interesses': { arquivos: ['sugerir-interesses.mjs'], acesso: 'rest' },
  'opr-diario': { arquivos: ['gerar-opr-diario.mjs'], acesso: 'rest' },
  'budget-ia': { arquivos: ['budget-ia.mjs'], acesso: 'rest' },
};

// o que roda fora do `robos.cron` (serviço da VPS, agenda nova da virada, retaguarda do Actions)
const FORA_DA_AGENDA = {
  'cartoes-ean (serviço)': { arquivos: ['robo-de-cartoes.mjs'], acesso: 'rest' },
  'espelho da Vessel (serviço, Plano 6)': { arquivos: ['espelho-da-vessel-na-vps.mjs'], acesso: 'pg' },
  'lembretes da Vessel (Plano 6)': { arquivos: ['lembretes-da-vessel-na-vps.mjs'], acesso: 'pg' },
  'log de caroços (Plano 6)': { arquivos: ['log-de-carocos.mjs'], acesso: 'pg' },
  'conteúdo (serviço)': { arquivos: ['conteudo-ideias.mjs', 'conteudo-semana.mjs', 'conteudo-fila.mjs'], acesso: 'pg' },
  'fábrica (Actions)': { arquivos: ['fabrica-job-runner.mjs'], acesso: 'rest' },  // fabrica_* pela API; gc_*, vessel_lotes e Storage por REST
};

const todos = { ...AGENDADOS, ...FORA_DA_AGENDA };

test('todo robô da agenda da VPS está classificado, e só eles', () => {
  const nomes = [...ler('vps/robos.cron').matchAll(/rodar-robo\.sh (\S+) /g)].map((m) => m[1]);
  assert.deepEqual([...new Set(nomes)].sort(), Object.keys(AGENDADOS).sort(),
    'robô novo (ou removido) na agenda: classifique-o aqui e no MATRIZ-06');
});

test('a coletor-noticias.sh roda exatamente os passos classificados', () => {
  const passos = [...ler('vps/coletor-noticias.sh').matchAll(/node coletor\/(\S+\.mjs)/g)].map((m) => m[1]);
  const conhecidos = AGENDADOS['coletor-noticias'].arquivos;
  for (const p of passos) assert.ok(conhecidos.includes(p), `passo novo ${p} sem classificação`);
});

for (const [nome, r] of Object.entries(todos)) {
  test(`${nome}: acesso '${r.acesso}' é o que o código faz`, () => {
    for (const arquivo of r.arquivos) {
      const t = ler(arquivo);
      const rest = USA_REST.test(t);
      if (r.acesso === 'pg') {
        assert.equal(rest, false, `${arquivo} usa REST do Supabase: vira 'rest' ou 'pg-ou-rest' (e abre achado)`);
        assert.ok(/pg\b|conteudo-banco/.test(t), `${arquivo} não fala com o banco por pg`);
      } else if (r.acesso === 'pg-ou-rest') {
        assert.ok(t.includes(r.variavel), `${arquivo} perdeu o caminho pg por ${r.variavel}`);
        assert.equal(rest, true, `${arquivo} não tem mais o fallback REST: vire 'pg'`);
      } else {
        assert.equal(rest, true, `${arquivo} não usa mais REST: vire 'pg' e feche o achado 06-1`);
      }
    }
  });
}

test('robô só-REST é a lacuna 06-1: o conjunto é o do inventário (muda de propósito, nunca por acidente)', () => {
  const soRest = Object.entries(todos).filter(([, r]) => r.acesso === 'rest').map(([n]) => n).sort();
  assert.deepEqual(soRest, [
    'budget-ia', 'cards-comercial-diario', 'cartoes-ean (serviço)', 'coletor-noticias', 'faxina-storage', 'fábrica (Actions)',
    'gestor-comercial', 'notas-dos-pedidos', 'opr-diario', 'relatorios-comerciais', 'sugerir-interesses',
  ]);
});

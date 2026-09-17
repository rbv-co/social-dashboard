// FALAR COM O ZOHO WORKDRIVE USANDO A CONEXÃO DA CENTRAL.
//
// ⚠️ NÃO CONFUNDIR COM `coletor/lib/zoho-workdrive.mjs`, QUE JÁ EXISTIA.
// São duas portas diferentes para o mesmo Zoho, e a diferença é de onde vem a
// credencial:
//
//   zoho-workdrive.mjs  → secrets do CI (ZOHO_REFRESH_TOKEN, ZOHO_CLIENT_ID…).
//                         É o caminho da FÁBRICA, que sobe criativo e roda sem
//                         banco. Se os secrets não existem, ela vira no-op.
//   zoho-da-central.mjs → a conexão guardada em `acessos_conexoes`, que é a que
//                         o dono liga na tela Acessos → Zoho. É o caminho dos
//                         robôs que já leem o banco (espelho, cópia de
//                         segurança), e é a mesma credencial que o robô da
//                         lista de espera usa há semanas.
//
// Juntar as duas num módulo só daria uma função com dois jeitos de entrar e um
// `if` no meio — e o `if` erraria no dia em que os dois estivessem presentes.
//
// (Este arquivo nasceu em 17/09/2026 porque eu escrevi por cima do outro sem
// olhar que ele existia. O nome errado custou o susto; o aviso acima fica.)
const WD = 'https://www.zohoapis.com/workdrive/api/v1';

/** O espaço "01. RBV and Company". ⚠️ Caminho vai por NOME; só a raiz é id. */
export const RAIZ_RBV = 'wbp6sefe483fe7da14c6ebe53225105f1f389';

export async function conexaoZoho(rest, cab) {
  const r = await fetch(`${rest}/acessos_conexoes?provedor=eq.zoho`
    + '&select=client_id,client_secret,refresh_token,data_center&limit=1', { headers: cab });
  const [c] = await r.json();
  if (!c?.refresh_token) {
    throw new Error('A Central não está conectada ao Zoho. Abra Acessos → Zoho e clique em conectar.');
  }
  return c;
}

/** ⚠️ O refresh_token do Zoho NÃO rotaciona (o do Bling sim). Não regravar. */
export async function tokenZoho(c) {
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const r = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) throw new Error('Não consegui entrar no Zoho.');
  return j.access_token;
}

export const cabZoho = (t) => ({
  Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json',
});

export async function pastasDe(t, paiId) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(paiId)}/folders?page%5Blimit%5D=200`,
    { headers: cabZoho(t) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return (j?.data ?? []).map((f) => ({
    id: String(f.id), nome: String(f?.attributes?.name ?? '').trim(),
  }));
}

export async function acharOuCriarPasta(t, paiId, nome) {
  const jaTem = (await pastasDe(t, paiId)).find((p) => p.nome === nome);
  if (jaTem) return jaTem.id;
  const r = await fetch(`${WD}/files`, {
    method: 'POST',
    headers: { ...cabZoho(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: nome, parent_id: paiId }, type: 'files' } }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`não consegui criar a pasta "${nome}" no Zoho (HTTP ${r.status})`);
  const nova = Array.isArray(j?.data) ? j.data[0] : j?.data;
  const id = nova?.id ?? nova?.attributes?.resource_id;
  if (!id) throw new Error(`o Zoho criou a pasta "${nome}" e não disse o identificador dela`);
  return String(id);
}

/** Percorre um caminho de pastas por NOME, criando o que faltar. */
export async function caminhoDePastas(t, raiz, nomes) {
  let pasta = raiz;
  for (const nome of nomes) pasta = await acharOuCriarPasta(t, pasta, nome);
  return pasta;
}

export async function arquivosDe(t, pastaId) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=500`,
    { headers: cabZoho(t) });
  if (!r.ok) return [];
  const j = await r.json().catch(() => null);
  return (j?.data ?? []).map((f) => ({
    id: String(f.id), nome: String(f?.attributes?.name ?? '').trim(),
  }));
}

export async function baixarArquivo(t, pastaId, nome) {
  const achado = (await arquivosDe(t, pastaId)).find((a) => a.nome === nome);
  if (!achado) return null;
  const r = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  return r.ok ? (await r.text()).replace(/^﻿/, '') : null;
}

/**
 * Sobe um arquivo, substituindo o que já estiver lá com o mesmo nome.
 *
 * ⚠️ `override-name-exist=true` é obrigatório: com `false` o Zoho NÃO versiona —
 * ele cria um arquivo novo com data e hora no nome, e em uma semana a pasta tem
 * sete planilhas parecidas e ninguém sabe qual vale.
 *
 * ⚠️ Sem `Content-Type` de propósito: quem monta a fronteira do multipart é o
 * próprio fetch, a partir do FormData. Escrever à mão quebra o envio.
 */
export async function subirArquivo(t, pastaId, nome, texto, tipo = 'text/csv', bom = true) {
  const fd = new FormData();
  // BOM no começo dos CSV: sem ele o Excel abre "Ana" como "AnÃ¡".
  fd.append('content', new Blob([(bom ? '﻿' : '') + texto], { type: tipo }), nome);
  const r = await fetch(`${WD}/upload?filename=${encodeURIComponent(nome)}`
    + `&parent_id=${encodeURIComponent(pastaId)}&override-name-exist=true`, {
    method: 'POST', headers: cabZoho(t), body: fd,
  });
  if (!r.ok) throw new Error(`o Zoho recusou ${nome} (HTTP ${r.status})`);
}

export async function mandarParaLixeira(t, id) {
  const r = await fetch(`${WD}/files/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...cabZoho(t), 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { status: '51' }, type: 'files' } }),
  });
  return r.ok;
}

/**
 * Uma célula de CSV.
 * ⚠️ Aspas, vírgula, ponto-e-vírgula e quebra de linha dentro do campo quebram
 * a planilha se não forem escapados. Nome de gente tem vírgula.
 */
export function celula(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function montarCsv(cabecalho, linhas) {
  return [cabecalho.map(celula).join(','), ...linhas.map((l) => l.map(celula).join(','))]
    .join('\n') + '\n';
}

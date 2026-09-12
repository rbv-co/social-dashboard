// Supabase Edge Function: acessos-oauth
// OAuth callback for the Zoho AND Microsoft OneDrive connect flows of
// "Controle de Acesso e Colaboradores".
//
// Routes (both verify_jwt:false — state in acessos_conexoes is the CSRF guard):
//   GET .../acessos-oauth/callback/zoho?code=...&state=...
//   GET .../acessos-oauth/callback/microsoft?code=...&state=...
//   The authorize URL (with `state`) is minted by the ADMIN-GATED proxy (acessos-proxy
//   action `zoho.authUrl`), which stores the state in acessos_conexoes.oauth_state.
//   This callback rejects any code whose `state` does not match the stored one (CSRF /
//   connection-fixation protection) and whose state is older than 10 minutes.
//   There is intentionally NO public `/start` route — initiation requires an authenticated
//   admin via the proxy, so an attacker cannot fixate our org's Zoho connection.
//
// Verified Zoho endpoints (June 2026):
//   * OAuth token: https://accounts.zoho<dc>/oauth/v2/token  (POST, form-urlencoded)
//   * Org id (zoid): GET https://mail.zoho<dc>/api/organization -> data.zoid
//   * Data center stored in acessos_conexoes.data_center, spliced into the host.
// Security: client_id/client_secret/refresh_token live in the service-role table
// public.acessos_conexoes and NEVER leak into any redirect URL or response body.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ENDERECO_PADRAO } from "../_shared/enderecos-do-app.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Para onde a volta do Zoho / do OneDrive joga a pessoa.
//
// Aqui NÃO dá para descobrir de onde ela saiu: quem bate nesta rota é o Zoho,
// não o navegador dela — não vem cabeçalho `Origin` nenhum. Então o retorno é
// sempre o endereço padrão do app, que mora em `_shared/enderecos-do-app.js`.
// Consequência enquanto a Central atende em dois endereços: quem começa a
// conexão pelo endereço NOVO volta no ANTIGO. Não quebra (os dois servem o
// mesmo app), e conserta sozinho quando o padrão virar.
const APP_RETURN = `${ENDERECO_PADRAO}/`;
const CALLBACK_URI =
  "https://kounqtdoioootxqegkij.supabase.co/functions/v1/acessos-oauth/callback/zoho";
// Microsoft (personal/consumer account) — redirect URI registered in Azure.
const MS_CALLBACK_URI =
  "https://kounqtdoioootxqegkij.supabase.co/functions/v1/acessos-oauth/callback/microsoft";
// VERIFIED (Microsoft Learn — Microsoft identity platform v2 OAuth, June 2026):
//   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
//   The "/consumers" tenant is for personal Microsoft accounts (MSA) only.
const MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const STATE_TTL_MS = 10 * 60 * 1000;

function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}
function fail(reason: string, detail?: unknown): Response {
  console.error("[acessos-oauth] erro:", reason, detail ?? "");
  return redirect(`${APP_RETURN}?zoho=erro&msg=${encodeURIComponent(reason)}`);
}
function failMs(reason: string, detail?: unknown): Response {
  console.error("[acessos-oauth] microsoft erro:", reason, detail ?? "");
  return redirect(`${APP_RETURN}?onedrive=erro&msg=${encodeURIComponent(reason)}`);
}
function dcSuffix(raw: unknown): string {
  let dc = (typeof raw === "string" ? raw : "").trim();
  if (!dc) return ".com";
  if (!dc.startsWith(".")) dc = "." + dc;
  return dc;
}
// constant-time string compare
function ctEq(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function handleCallback(reqUrl: URL): Promise<Response> {
  const oauthErr = reqUrl.searchParams.get("error");
  if (oauthErr) return fail(oauthErr);
  const code = reqUrl.searchParams.get("code");
  const qState = reqUrl.searchParams.get("state");
  if (!code) return fail("sem_code");
  if (!qState) return fail("sem_state");

  const sb = admin();
  // Read creds + the stored state in one go.
  const { data: row, error: readErr } = await sb
    .from("acessos_conexoes")
    .select("client_id, client_secret, data_center, oauth_state, oauth_state_em")
    .eq("provedor", "zoho")
    .single();
  if (readErr || !row) return fail("falha_ao_ler_credenciais", readErr?.message);

  // Verify state (CSRF): must match the one minted by the admin-gated proxy, and be fresh.
  if (!row.oauth_state || !ctEq(qState, row.oauth_state)) return fail("state_invalido");
  if (row.oauth_state_em && Date.now() - new Date(row.oauth_state_em).getTime() > STATE_TTL_MS) {
    await sb.from("acessos_conexoes").update({ oauth_state: null }).eq("provedor", "zoho");
    return fail("state_expirado");
  }
  // One-time use: clear the state immediately.
  await sb.from("acessos_conexoes").update({ oauth_state: null }).eq("provedor", "zoho");

  const dc = dcSuffix(row.data_center);

  // 1) Exchange code -> tokens.
  let tokenJson: any;
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: row.client_id,
      client_secret: row.client_secret,
      redirect_uri: CALLBACK_URI,
      code,
    });
    const resp = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    tokenJson = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[acessos-oauth] token http", resp.status, tokenJson);
      return fail("falha_token", `http ${resp.status}`);
    }
  } catch (e) {
    return fail("falha_token", e instanceof Error ? e.message : e);
  }
  if (tokenJson?.error) return fail("falha_token", tokenJson.error);

  const refreshToken = tokenJson?.refresh_token;
  const accessToken = tokenJson?.access_token;
  if (!refreshToken) {
    console.error("[acessos-oauth] sem refresh_token. resposta:", tokenJson);
    return fail("sem_refresh_token");
  }

  // 2) Fetch zoid (defensive — store token even if org lookup fails).
  let zoid: string | null = null;
  if (accessToken) {
    try {
      const orgResp = await fetch(`https://mail.zoho${dc}/api/organization`, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      const rawOrg = await orgResp.text();
      if (!orgResp.ok) {
        console.error("[acessos-oauth] org http", orgResp.status, rawOrg);
      } else {
        const orgJson = JSON.parse(rawOrg);
        const candidate =
          orgJson?.data?.zoid ??
          (Array.isArray(orgJson?.data) ? orgJson.data[0]?.zoid : undefined) ??
          orgJson?.zoid;
        if (candidate !== undefined && candidate !== null) zoid = String(candidate);
        else console.error("[acessos-oauth] zoid nao encontrado:", rawOrg);
      }
    } catch (e) {
      console.error("[acessos-oauth] falha ao buscar org:", e);
    }
  }

  // 3) Persist.
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb
    .from("acessos_conexoes")
    .update({ refresh_token: refreshToken, org_id: zoid, conectado_em: nowIso, atualizado_em: nowIso })
    .eq("provedor", "zoho");
  if (upErr) return fail("falha_ao_salvar", upErr.message);

  return redirect(`${APP_RETURN}?zoho=ok`);
}

// ---------------------------------------------------------------------------
// Microsoft OneDrive (personal account) callback.
// Token exchange at the consumers endpoint — VERIFIED form params (Microsoft Learn,
// v2 auth-code flow): client_id, scope, code, redirect_uri,
// grant_type=authorization_code, client_secret -> { access_token, refresh_token,
// expires_in }. Secrets stay server-side; never appear in any redirect.
async function handleCallbackMicrosoft(reqUrl: URL): Promise<Response> {
  const oauthErr = reqUrl.searchParams.get("error");
  if (oauthErr) {
    return failMs(oauthErr, reqUrl.searchParams.get("error_description"));
  }
  const code = reqUrl.searchParams.get("code");
  const qState = reqUrl.searchParams.get("state");
  if (!code) return failMs("sem_code");
  if (!qState) return failMs("sem_state");

  const sb = admin();
  const { data: row, error: readErr } = await sb
    .from("acessos_conexoes")
    .select("client_id, client_secret, escopos, oauth_state, oauth_state_em")
    .eq("provedor", "microsoft")
    .single();
  if (readErr || !row) return failMs("falha_ao_ler_credenciais", readErr?.message);

  // Verify state (CSRF / connection-fixation): must match the one minted by the
  // admin-gated proxy, constant-time, and be fresh (<=10 min).
  if (!row.oauth_state || !ctEq(qState, row.oauth_state)) return failMs("state_invalido");
  if (row.oauth_state_em && Date.now() - new Date(row.oauth_state_em).getTime() > STATE_TTL_MS) {
    await sb.from("acessos_conexoes").update({ oauth_state: null }).eq("provedor", "microsoft");
    return failMs("state_expirado");
  }
  // One-time use: clear the state immediately.
  await sb.from("acessos_conexoes").update({ oauth_state: null }).eq("provedor", "microsoft");

  // Exchange code -> tokens (form-urlencoded).
  let tokenJson: any;
  try {
    const scope = (row.escopos && String(row.escopos).trim()) ||
      "Files.ReadWrite offline_access User.Read";
    const body = new URLSearchParams({
      client_id: row.client_id,
      scope,
      code,
      redirect_uri: MS_CALLBACK_URI,
      grant_type: "authorization_code",
      client_secret: row.client_secret,
    });
    const resp = await fetch(MS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    tokenJson = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("[acessos-oauth] microsoft token http", resp.status, tokenJson);
      return failMs("falha_token", `http ${resp.status}`);
    }
  } catch (e) {
    return failMs("falha_token", e instanceof Error ? e.message : e);
  }
  if (tokenJson?.error) return failMs("falha_token", tokenJson.error_description ?? tokenJson.error);

  const refreshToken = tokenJson?.refresh_token;
  if (!refreshToken) {
    console.error("[acessos-oauth] microsoft sem refresh_token. resposta:", tokenJson);
    return failMs("sem_refresh_token");
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb
    .from("acessos_conexoes")
    .update({ refresh_token: refreshToken, conectado_em: nowIso, atualizado_em: nowIso })
    .eq("provedor", "microsoft");
  if (upErr) return failMs("falha_ao_salvar", upErr.message);

  return redirect(`${APP_RETURN}?onedrive=ok`);
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.includes("/callback/microsoft")) return await handleCallbackMicrosoft(url);
  if (url.pathname.includes("/callback/zoho")) return await handleCallback(url);
  return new Response("not found", { status: 404 });
});

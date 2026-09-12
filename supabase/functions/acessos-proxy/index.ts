// Supabase Edge Function: acessos-proxy
// The ONLY caller-facing endpoint for the Zoho integration of
// "Controle de Acesso e Colaboradores". verify_jwt is TRUE at the platform level,
// but we ALSO re-verify the caller and gate to admins here (defense in depth).
//
// Auth gate (every request):
//   1) Read caller JWT from Authorization header; resolve user via a user-scoped client.
//   2) With a SERVICE-ROLE client, read public.profiles for that uid and allow only if
//      role='admin' OR 'acessos' = any(features)  (mirrors SQL is_acessos_admin()).
//
// Body: POST JSON { action, ...args }. Actions:
//   - zoho.status   -> { connected, org_id, conectado_em }  (never leaks secrets)
//   - zoho.authUrl  -> mints+stores random state, returns consent { url }
//   - zoho.users    -> lists org accounts (normalized)
//   - zoho.import   -> upserts acessos_pessoas + best-effort avatars
//   Zoho WorkDrive (pastas):
//   - zoho.pastas         -> lista as pastas do WorkDrive ao vivo, marcando o que já
//                            foi importado. NÃO grava nada.
//   - zoho.importarPastas -> grava em acessos_recursos (tipo=workdrive, provedor=zoho)
//                            o que ainda não está lá. Idempotente por external_id.
//   Microsoft OneDrive (personal account, via Microsoft Graph):
//   - microsoft.status       -> { connected, conectado_em }  (never leaks secrets)
//   - microsoft.authUrl      -> mints+stores state, returns consumers consent { url }
//   - microsoft.browse       -> folder picker: lists child FOLDERS of itemId|root
//   - microsoft.addFolder    -> insert acessos_recursos (tipo=onedrive), dedup by external_id
//   - microsoft.folders      -> lists managed acessos_recursos (tipo=onedrive)
//   - microsoft.removeFolder -> deletes an acessos_recursos row
//   - microsoft.shares       -> lists driveItem permissions normalized
//   - microsoft.allShares    -> all managed folders x permissions (flat, for Auditoria)
//   - microsoft.share        -> POST /invite (read|write)
//   - microsoft.unshare      -> DELETE a permission
//   - microsoft.revokeForEmail -> offboarding: remove email from ALL managed OneDrive folders
//
// ---------------------------------------------------------------------------
// VERIFIED Zoho endpoints / fields (June 2026), with sources:
//
// * OAuth token (refresh): POST https://accounts.zoho<dc>/oauth/v2/token
//     form: grant_type=refresh_token, client_id, client_secret, refresh_token
//     -> { access_token, ... }
//     Source: https://www.zoho.com/mail/help/api/using-oauth-2.html
//
// * List org accounts: GET https://mail.zoho<dc>/api/organization/<zoid>/accounts
//     ?start=<n>&limit=<n>  (default start=0, limit=10 -> we page explicitly)
//     Header: Authorization: Zoho-oauthtoken <access>
//     Response: { status:{...}, data:[ { accountId, zuid, firstName, lastName,
//       displayName, accountDisplayName, primaryEmailAddress, mailboxAddress,
//       emailAddress:[{ mailId, isPrimary, isAlias, isConfirmed }], ... ~70 fields } ] }
//     Sources:
//       https://www.zoho.com/mail/help/api/get-org-users-details.html
//       https://www.zoho.com/mail/help/api/organization-api.html
//   CONFIRMED field names: accountId, zuid, displayName, firstName, lastName,
//   primaryEmailAddress, mailboxAddress, emailAddress[].mailId. We read defensively
//   and fall back across these in case a tenant returns a subset.
//
// * USER PHOTO: NOT documented in the Zoho Mail REST API (index/account-api pages
//   list no photo endpoint as of June 2026). We attempt, defensively and best-effort:
//       GET https://mail.zoho<dc>/api/accounts/<accountId>/photo
//     and accept the body ONLY if the response is ok AND content-type is image/*.
//   Anything else (404 / HTML / JSON error) is treated as "no photo" and skipped
//   (NOT fatal). The raw status/content-type is logged so we can validate the real
//   endpoint shape against a live connection and adjust the path if Zoho differs.
//   Sources (absence of a documented endpoint):
//     https://www.zoho.com/mail/help/api/   https://www.zoho.com/mail/help/api/account-api.html
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Lógica pura de tradução da resposta do WorkDrive -> linhas de acessos_recursos.
// Fica num arquivo separado porque é a parte testável com `node --test` (ver
// src/ferramentas/acessos/normalizar-pastas-do-workdrive.test.mjs).
import {
  normalizarPastasDoWorkdrive,
  montarLinhasDeRecursos,
  separarNovasDasExistentes,
} from "./normalizar-pastas-do-workdrive.js";
// A lista dos endereços em que o app atende (a Central mudou de endereço).
import { ENDERECO_PADRAO, corsDoPedido } from "../_shared/enderecos-do-app.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const AVATAR_BUCKET = "acessos-avatars";

// Hash curto e determinístico dos bytes de uma imagem (FNV-1a). Serve só de "impressão
// digital" pra cache-busting da URL da foto — não é criptografia. Mesmos bytes -> mesmo
// hash (URL estável, não rebusca à toa); bytes diferentes -> hash diferente (foto nova
// aparece). Síncrono e sem dependência, de propósito.
function hashDeBytes(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
const CALLBACK_URI =
  "https://kounqtdoioootxqegkij.supabase.co/functions/v1/acessos-oauth/callback/zoho";
// Microsoft OneDrive (personal/consumer account).
// VERIFIED (Microsoft Learn — Microsoft identity platform v2 OAuth, June 2026:
//   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow ;
//   https://learn.microsoft.com/en-us/graph/auth-v2-user ): the "/consumers" tenant
// serves personal Microsoft accounts (MSA). Graph base + driveItem endpoints verified at
//   https://learn.microsoft.com/en-us/graph/api/driveitem-invite
//   https://learn.microsoft.com/en-us/graph/api/driveitem-list-permissions
//   https://learn.microsoft.com/en-us/graph/api/driveitem-list-children
const MS_CALLBACK_URI =
  "https://kounqtdoioootxqegkij.supabase.co/functions/v1/acessos-oauth/callback/microsoft";
const MS_AUTH_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const MS_TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// O CORS que `json()` carimba é o PADRÃO. A origem certa de cada pedido é
// escrita por cima na saída (ver o Deno.serve no fim do arquivo) — fazer isso
// no fim, e não numa variável de módulo, é o que evita o cruzamento entre dois
// pedidos de endereços diferentes atendidos ao mesmo tempo.
const CORS = {
  "Access-Control-Allow-Origin": ENDERECO_PADRAO,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function admin() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function dcSuffix(raw: unknown): string {
  let dc = (typeof raw === "string" ? raw : "").trim();
  if (!dc) return ".com";
  if (!dc.startsWith(".")) dc = "." + dc;
  return dc;
}
function randomState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Fresh access token from the stored refresh_token. No caching.
async function freshAccessToken(row: {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  data_center: string;
}): Promise<string> {
  const dc = dcSuffix(row.data_center);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: row.client_id,
    client_secret: row.client_secret,
    refresh_token: row.refresh_token,
  });
  const resp = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !j?.access_token) {
    throw new Error(`token_refresh_falhou http ${resp.status} ${JSON.stringify(j)}`);
  }
  return j.access_token as string;
}

// Page through the org accounts and normalize.
async function listZohoUsers(
  conn: any,
  access: string,
): Promise<{ users: Array<{ accountId: string; zuid: string | null; name: string; email: string }>; rawCount: number }> {
  const dc = dcSuffix(conn.data_center);
  const out: Array<{ accountId: string; zuid: string | null; name: string; email: string }> = [];
  let start = 0;
  const limit = 50;
  let rawCount = 0;

  // The /api/organization/accounts endpoint (WITHOUT a zoid in the path) returns the
  // CURRENT org's accounts and works with the ZohoMail.organization.accounts scope.
  // (Getting the zoid itself requires the partner scope, which a regular org admin
  // can't grant — and we don't need it: the zoid-less path is the current org.)
  // Page until a short page is returned.
  for (let page = 0; page < 200; page++) {
    const url = `https://mail.zoho${dc}/api/organization/accounts?start=${start}&limit=${limit}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${access}` },
    });
    const raw = await resp.text();
    if (!resp.ok) {
      console.error("[acessos-proxy] users http", resp.status, raw.slice(0, 800));
      throw new Error(`zoho_users_http_${resp.status}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[acessos-proxy] users parse falhou:", raw.slice(0, 800));
      throw new Error("zoho_users_parse");
    }
    const data: any[] = Array.isArray(parsed?.data) ? parsed.data : [];
    rawCount += data.length;

    for (const u of data) {
      try {
        const accountId =
          u?.accountId ?? u?.zuid ?? u?.account_id ?? u?.zid ?? null;
        if (accountId == null) {
          console.error("[acessos-proxy] usuario sem accountId/zuid:", JSON.stringify(u).slice(0, 400));
          continue;
        }
        const name =
          (u?.displayName && String(u.displayName).trim()) ||
          (u?.accountDisplayName && String(u.accountDisplayName).trim()) ||
          [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() ||
          "";
        let email =
          (u?.primaryEmailAddress && String(u.primaryEmailAddress)) ||
          (u?.mailboxAddress && String(u.mailboxAddress)) ||
          "";
        if (!email && Array.isArray(u?.emailAddress)) {
          const primary = u.emailAddress.find((e: any) => e?.isPrimary) ?? u.emailAddress[0];
          email = primary?.mailId ?? primary?.emailAddress ?? "";
        }
        out.push({ accountId: String(accountId), zuid: u?.zuid != null ? String(u.zuid) : null, name: name || String(email), email: String(email) });
      } catch (e) {
        console.error("[acessos-proxy] falha ao normalizar usuario:", e, JSON.stringify(u).slice(0, 400));
      }
    }

    if (data.length < limit) break; // last page
    start += limit;
  }
  return { users: out, rawCount };
}

// Best-effort fetch of a user's photo bytes. Returns null if unavailable / not an image.
// Fetch a user's photo from the Zoho Contacts thumbnail endpoint, keyed by zuid.
// CONFIRMED working: GET https://contacts.zoho<dc>/file?ID=<zuid>&fs=thumb  -> image/png
// (the documented Mail /accounts/<id>/photo path 404s; this contacts path returns the avatar).
async function fetchZohoPhoto(
  conn: any,
  access: string,
  zuid: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const dc = dcSuffix(conn.data_center);
  const url = `https://contacts.zoho${dc}/file?ID=${encodeURIComponent(zuid)}&fs=thumb`;
  try {
    const resp = await fetch(url, {
      headers: { Authorization: `Zoho-oauthtoken ${access}` },
    });
    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok || !ct.toLowerCase().startsWith("image/")) {
      console.warn("[acessos-proxy] photo skip", resp.status, "ct", ct, "zuid", zuid);
      return null;
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.byteLength === 0) return null;
    return { bytes: buf, contentType: ct.split(";")[0].trim() };
  } catch (e) {
    console.warn("[acessos-proxy] photo erro", zuid, e instanceof Error ? e.message : e);
    return null;
  }
}

async function readZohoConn(sb: any) {
  const { data, error } = await sb
    .from("acessos_conexoes")
    .select(
      "client_id, client_secret, refresh_token, org_id, data_center, escopos, conectado_em",
    )
    .eq("provedor", "zoho")
    .single();
  if (error || !data) throw new Error(error?.message || "conexao_zoho_inexistente");
  return data;
}

// --- Microsoft OneDrive helpers ---

async function readMsConn(sb: any) {
  const { data, error } = await sb
    .from("acessos_conexoes")
    .select("client_id, client_secret, refresh_token, escopos, conectado_em")
    .eq("provedor", "microsoft")
    .single();
  if (error || !data) throw new Error(error?.message || "conexao_microsoft_inexistente");
  return data;
}

// Fresh Graph access token from the stored refresh_token. No caching.
// VERIFIED form params (Microsoft Learn, v2 auth-code flow): client_id, scope,
// refresh_token, grant_type=refresh_token, client_secret -> { access_token }.
async function freshMsToken(conn: {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  escopos?: string | null;
}): Promise<string> {
  const scope = (conn.escopos && String(conn.escopos).trim()) ||
    "Files.ReadWrite offline_access User.Read";
  const body = new URLSearchParams({
    client_id: conn.client_id,
    scope,
    refresh_token: conn.refresh_token,
    grant_type: "refresh_token",
    client_secret: conn.client_secret,
  });
  const resp = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !j?.access_token) {
    throw new Error(`ms_token_refresh_falhou http ${resp.status} ${JSON.stringify(j)}`);
  }
  return j.access_token as string;
}

// Thin Graph fetch wrapper. Returns { ok, status, json } — never throws on HTTP errors,
// so callers can translate to a clean { error:'graph_http_<status>', detalhe }.
async function graphFetch(
  access: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; json: any }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${access}` };
  const opts: RequestInit = { method: init?.method || "GET", headers };
  if (init?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(init.body);
  }
  const resp = await fetch(`${GRAPH_BASE}${path}`, opts);
  // DELETE returns 204 with empty body.
  let j: any = null;
  const text = await resp.text();
  if (text) {
    try {
      j = JSON.parse(text);
    } catch {
      j = { raw: text.slice(0, 800) };
    }
  }
  return { ok: resp.ok, status: resp.status, json: j };
}

function graphErr(status: number, detalhe: unknown) {
  return json({ error: `graph_http_${status}`, detalhe });
}

async function logMs(
  sb: any,
  quem: string | null,
  acao: string,
  alvo: string | null,
  resultado: string,
  detalhe: unknown,
) {
  try {
    await sb.from("acessos_log").insert({
      quem,
      acao,
      provedor: "microsoft",
      alvo,
      resultado,
      detalhe: typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe),
    });
  } catch (e) {
    console.warn("[acessos-proxy] log microsoft falhou", acao, e instanceof Error ? e.message : e);
  }
}

// Parse a Graph permission into { name, email } defensively across the shapes that
// personal-account OneDrive returns: grantedToV2 (direct), grantedToIdentitiesV2[]
// (link/invite targets), invitation.email, link (sharing link, no identity).
function parsePermIdentity(p: any): { name: string; email: string } {
  const fromIdentitySet = (idset: any): { name: string; email: string } | null => {
    if (!idset) return null;
    const u = idset.user || idset.siteUser || idset.group || idset.application;
    if (u) {
      return {
        name: (u.displayName && String(u.displayName)) || "",
        email: (u.email && String(u.email)) || (u.loginName && String(u.loginName)) || "",
      };
    }
    return null;
  };
  let id = fromIdentitySet(p?.grantedToV2);
  if (!id && Array.isArray(p?.grantedToIdentitiesV2) && p.grantedToIdentitiesV2.length) {
    id = fromIdentitySet(p.grantedToIdentitiesV2[0]);
  }
  if (!id && p?.invitation?.email) {
    id = { name: p.invitation.invitedBy?.user?.displayName || "", email: String(p.invitation.email) };
  }
  // Consumer OneDrive: acessos DIRETOS (membership) vêm como permissão de "link" com
  // grantedTo* VAZIO — o e-mail está codificado no id (base64 de "i:0#.f|membership|<email>").
  // Sem isso a Auditoria perdia quem tem acesso direto.
  if (!id || !id.email) {
    try {
      const dec = atob(String(p?.id || ""));
      const k = "|membership|";
      const i = dec.indexOf(k);
      if (i >= 0) {
        const email = dec.slice(i + k.length).trim();
        if (email && email.includes("@")) id = { name: (id && id.name) || "", email };
      }
    } catch (_) { /* id não é base64 */ }
  }
  if (!id && p?.link) {
    // Sharing link with no specific identity.
    id = { name: p.link.scope ? `Link (${p.link.scope})` : "Link de compartilhamento", email: "" };
  }
  return id || { name: "", email: "" };
}

// ---- actions ----

async function actStatus(sb: any) {
  const conn = await readZohoConn(sb);
  return json({
    connected: !!conn.refresh_token,
    org_id: conn.org_id ?? null,
    conectado_em: conn.conectado_em ?? null,
  });
}

async function actAuthUrl(sb: any) {
  const conn = await readZohoConn(sb);
  const dc = dcSuffix(conn.data_center);
  const state = randomState();
  const { error } = await sb
    .from("acessos_conexoes")
    .update({ oauth_state: state, oauth_state_em: new Date().toISOString() })
    .eq("provedor", "zoho");
  if (error) return json({ error: "falha_ao_gravar_state", detalhe: error.message }, 500);

  const scope = (conn.escopos && String(conn.escopos).trim()) || "ZohoMail.organization.accounts.READ";
  const params = new URLSearchParams({
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    client_id: conn.client_id,
    scope,
    redirect_uri: CALLBACK_URI,
    state,
  });
  const url = `https://accounts.zoho${dc}/oauth/v2/auth?${params.toString()}`;
  return json({ url });
}

async function actUsers(sb: any) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshAccessToken(conn);
  const { users, rawCount } = await listZohoUsers(conn, access);
  return json({ count: rawCount, users });
}

async function actImport(sb: any, quem: string | null) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshAccessToken(conn);
  const { users } = await listZohoUsers(conn, access);

  let criados = 0;
  let atualizados = 0;
  let com_foto = 0;
  let fotos_falhas = 0;
  let erros = 0;

  for (const u of users) {
    try {
      // Upsert keyed by zoho_account_id.
      const { data: existing, error: selErr } = await sb
        .from("acessos_pessoas")
        .select("id")
        .eq("zoho_account_id", u.accountId)
        .maybeSingle();
      if (selErr) throw selErr;

      let pessoaId: string;
      if (existing?.id) {
        const { error: upErr } = await sb
          .from("acessos_pessoas")
          .update({
            nome: u.name || undefined,
            email_corporativo: u.email || undefined,
            atualizado_em: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (upErr) throw upErr;
        pessoaId = existing.id;
        atualizados++;
      } else {
        const { data: ins, error: insErr } = await sb
          .from("acessos_pessoas")
          .insert({
            nome: u.name || u.email || "Sem nome",
            email_corporativo: u.email || null,
            status: "ativo",
            setor_id: null,
            zoho_account_id: u.accountId,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        pessoaId = ins.id;
        criados++;
      }

      // Best-effort avatar (Zoho contacts thumbnail, keyed by zuid).
      try {
        const photo = u.zuid ? await fetchZohoPhoto(conn, access, u.zuid) : null;
        if (photo) {
          const ext = photo.contentType.includes("png") ? "png" : "jpg";
          const path = `${pessoaId}.${ext}`;
          const { error: stErr } = await sb.storage
            .from(AVATAR_BUCKET)
            .upload(path, photo.bytes, { contentType: photo.contentType, upsert: true });
          if (stErr) {
            fotos_falhas++;
          } else {
            // ?v={hash dos bytes} é o que FAZ a foto atualizar de verdade. O caminho no
            // bucket é fixo (pessoaId.jpg), então sem isto a URL nunca muda e o navegador/
            // CDN servem a foto VELHA em cache pra sempre — foi exatamente a queixa (perfil
            // congelado). Hash dos bytes: foto trocou -> URL nova -> o navegador rebusca.
            const v = hashDeBytes(photo.bytes);
            const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${path}?v=${v}`;
            await sb.from("acessos_pessoas").update({ avatar_url: publicUrl }).eq("id", pessoaId);
            com_foto++;
          }
        }
      } catch (e) {
        // Falha de foto vira número no resumo (fotos_falhas), não console.warn invisível:
        // "0 fotos" com 0 falhas é "ninguém tem foto"; com 12 falhas é "não consegui buscar".
        fotos_falhas++;
      }
    } catch (e) {
      erros++;
      console.error("[acessos-proxy] import erro usuario", u.accountId, e instanceof Error ? e.message : e);
    }
  }

  const resumo = { criados, atualizados, com_foto, fotos_falhas, erros, total: users.length };
  try {
    await sb.from("acessos_log").insert({
      quem,
      acao: "zoho.import",
      provedor: "zoho",
      alvo: "acessos_pessoas",
      resultado: erros > 0 ? "parcial" : "ok",
      detalhe: JSON.stringify(resumo),
    });
  } catch (e) {
    console.warn("[acessos-proxy] log import falhou", e instanceof Error ? e.message : e);
  }

  return json(resumo);
}

// Suspend / reactivate a Zoho mailbox by the person's email.
// CONFIRMED live (June 2026): PUT https://mail.zoho<dc>/api/organization/accounts/<accountId>
//   header Authorization: Zoho-oauthtoken <access>; body { mode:'disableUser'|'enableUser', zuid }
//   -> 200 with { status:{ code:200, ... } } on success.
// The accountId + zuid are resolved by listing the org accounts (zoid-less path) and
// matching the email against primaryEmailAddress / mailboxAddress.
async function actZohoSetUser(sb: any, email: string | null, mode: string) {
  try {
    if (!email) return json({ error: "sem_email" });
    const conn = await readZohoConn(sb);
    if (!conn.refresh_token) return json({ error: "nao_conectado" });
    const access = await freshAccessToken(conn);
    const dc = dcSuffix(conn.data_center);
    const base = `https://mail.zoho${dc}/api/organization/accounts`;

    // Find the account by email.
    const listResp = await fetch(`${base}?limit=200`, {
      headers: { Authorization: `Zoho-oauthtoken ${access}` },
    });
    const listRaw = await listResp.text();
    if (!listResp.ok) {
      console.error("[acessos-proxy] zoho.setUser list http", listResp.status, listRaw.slice(0, 800));
      return json({ error: "zoho_" + mode + "_falhou", detalhe: `list http ${listResp.status}` });
    }
    let data: any;
    try {
      data = JSON.parse(listRaw);
    } catch {
      return json({ error: "zoho_" + mode + "_falhou", detalhe: "list parse" });
    }
    const target = email.toLowerCase();
    const u = (data.data || []).find(
      (x: any) =>
        String(x.primaryEmailAddress || "").toLowerCase() === target ||
        String(x.mailboxAddress || "").toLowerCase() === target,
    );
    if (!u) return json({ error: "usuario_zoho_nao_encontrado" });

    const accountId = u.accountId;
    const zuid = String(u.zuid);

    const putResp = await fetch(`${base}/${accountId}`, {
      method: "PUT",
      headers: {
        Authorization: "Zoho-oauthtoken " + access,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode, zuid }),
    });
    const putRaw = await putResp.text();
    let parsed: any = null;
    try {
      parsed = putRaw ? JSON.parse(putRaw) : null;
    } catch {
      parsed = null;
    }
    const ok =
      putResp.ok && (parsed?.status?.code === 200 || parsed?.status?.code === 201);
    if (!ok) {
      console.error("[acessos-proxy] zoho.setUser put falhou", mode, putResp.status, putRaw.slice(0, 800));
      return json({
        error: "zoho_" + mode + "_falhou",
        detalhe: parsed?.status ?? `http ${putResp.status} ${putRaw.slice(0, 300)}`,
      });
    }

    const acao = mode === "disableUser" ? "zoho.suspend" : "zoho.reactivate";
    try {
      await sb.from("acessos_log").insert({
        quem: null,
        acao,
        provedor: "zoho",
        alvo: email,
        resultado: "ok",
        detalhe: JSON.stringify({ accountId: String(accountId), zuid, mode }),
      });
    } catch (e) {
      console.warn("[acessos-proxy] log " + acao + " falhou", e instanceof Error ? e.message : e);
    }

    return json({ ok: true, accao: mode });
  } catch (e) {
    console.error("[acessos-proxy] zoho.setUser erro", mode, e instanceof Error ? e.message : e);
    return json({ error: "zoho_" + mode + "_falhou", detalhe: e instanceof Error ? e.message : String(e) });
  }
}

// Create a new Zoho mailbox (onboarding).
// CONFIRMED live (June 2026): POST https://mail.zoho<dc>/api/organization/accounts (zoid-less)
//   body { primaryEmailAddress, password, firstName, lastName, role:'member' }
//   -> 200 with { status:{ code:201, description:'Created' }, data:{ accountId, zuid, ... } }
async function actZohoCreate(sb: any, args: any) {
  try {
    const email = (args.email || "").trim();
    const password = args.password || "";
    if (!email || !password) return json({ error: "email_e_senha_obrigatorios" });

    const conn = await readZohoConn(sb);
    if (!conn.refresh_token) return json({ error: "nao_conectado" });

    const access = await freshAccessToken(conn);
    const dc = dcSuffix(conn.data_center);
    const base = `https://mail.zoho${dc}/api/organization/accounts`;

    const resp = await fetch(base, {
      method: "POST",
      headers: {
        Authorization: "Zoho-oauthtoken " + access,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        primaryEmailAddress: email,
        password,
        firstName: args.firstName || "",
        lastName: args.lastName || "",
        role: "member",
      }),
    });

    const raw = await resp.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    const ok = resp.ok && (parsed?.status?.code === 201 || parsed?.status?.code === 200);
    if (ok) {
      const d = parsed?.data || {};
      try {
        await sb.from("acessos_log").insert({
          quem: null,
          acao: "zoho.create",
          provedor: "zoho",
          alvo: email,
          resultado: "ok",
          detalhe: JSON.stringify({ accountId: d.accountId ? String(d.accountId) : null, zuid: d.zuid ? String(d.zuid) : null }),
        });
      } catch (e) {
        console.warn("[acessos-proxy] log zoho.create falhou", e instanceof Error ? e.message : e);
      }
      return json({
        ok: true,
        email,
        accountId: d.accountId ? String(d.accountId) : null,
        zuid: d.zuid ? String(d.zuid) : null,
      });
    }

    console.error("[acessos-proxy] zoho.create falhou", resp.status, raw.slice(0, 800));
    return json({
      error: "zoho_create_falhou",
      detalhe: parsed?.data?.moreInfo || ("http " + resp.status),
    });
  } catch (e) {
    console.error("[acessos-proxy] zoho.create erro", e instanceof Error ? e.message : e);
    return json({ error: "zoho_create_falhou", detalhe: e instanceof Error ? e.message : String(e) });
  }
}

// ---- Microsoft OneDrive actions ----

async function msStatus(sb: any) {
  const conn = await readMsConn(sb);
  return json({
    connected: !!conn.refresh_token,
    conectado_em: conn.conectado_em ?? null,
  });
}

async function msAuthUrl(sb: any) {
  const conn = await readMsConn(sb);
  const state = randomState();
  const { error } = await sb
    .from("acessos_conexoes")
    .update({ oauth_state: state, oauth_state_em: new Date().toISOString() })
    .eq("provedor", "microsoft");
  if (error) return json({ error: "falha_ao_gravar_state", detalhe: error.message }, 500);

  const scope = (conn.escopos && String(conn.escopos).trim()) ||
    "Files.ReadWrite offline_access User.Read";
  const params = new URLSearchParams({
    client_id: conn.client_id,
    response_type: "code",
    redirect_uri: MS_CALLBACK_URI,
    response_mode: "query",
    scope,
    state,
  });
  return json({ url: `${MS_AUTH_URL}?${params.toString()}` });
}

async function msBrowse(sb: any, itemId: string | null) {
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const path = itemId
    ? `/me/drive/items/${encodeURIComponent(itemId)}/children`
    : `/me/drive/root/children`;
  const r = await graphFetch(access, path);
  if (!r.ok) return graphErr(r.status, r.json);
  const value: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
  // FILTER to folders only (item.folder != null).
  const folders = value
    .filter((it) => it && it.folder != null)
    .map((it) => ({
      id: String(it.id),
      name: String(it.name ?? ""),
      childCount: it.folder?.childCount ?? 0,
    }));
  return json({ folders, parentId: itemId || null });
}

// Recursive crawl of a brand root: returns ALL descendant folders (flattened) up to maxDepth,
// each with its ancestor trail (folder names from the root down to its parent). One token refresh,
// many Graph calls server-side. Bounded by depth, node cap and call cap to stay fast/safe.
async function actMsTree(sb: any, rootId: string, maxDepth: unknown) {
  if (!rootId) return json({ error: "sem_itemId" }, 400);
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const depth = Math.max(1, Math.min(5, Number(maxDepth) || 2));
  const NODE_CAP = 1500;
  const CALL_CAP = 400;
  const out: Array<{ id: string; name: string; depth: number; childCount: number; trail: string[] }> = [];
  let calls = 0;
  let truncated = false;
  let frontier: Array<{ id: string; trail: string[] }> = [{ id: rootId, trail: [] }];
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: Array<{ id: string; trail: string[] }> = [];
    for (const node of frontier) {
      if (calls >= CALL_CAP || out.length >= NODE_CAP) { truncated = true; break; }
      calls++;
      const r = await graphFetch(
        access,
        `/me/drive/items/${encodeURIComponent(node.id)}/children?$top=200&$select=id,name,folder`,
      );
      if (!r.ok) continue;
      const kids = (Array.isArray(r.json?.value) ? r.json.value : []).filter((it: any) => it && it.folder != null);
      for (const k of kids) {
        if (out.length >= NODE_CAP) { truncated = true; break; }
        const childCount = k.folder?.childCount ?? 0;
        out.push({ id: String(k.id), name: String(k.name ?? ""), depth: d, childCount, trail: node.trail, parentId: String(node.id) });
        if (d < depth && childCount) next.push({ id: String(k.id), trail: node.trail.concat(String(k.name ?? "")) });
      }
    }
    frontier = next;
  }
  return json({ folders: out, truncated, depth, total: out.length });
}

async function msAddFolder(
  sb: any,
  quem: string | null,
  itemId: string,
  name: string,
  caminho: string | null,
) {
  if (!itemId) return json({ error: "sem_itemId" }, 400);
  // Avoid duplicates: same external_id already managed -> return it.
  // Sem filtro de arquivado_em de propósito: é checagem de duplicata, não
  // listagem. Pasta arquivada já está gravada e tem que contar como existente.
  const { data: existing } = await sb
    .from("acessos_recursos")
    .select("*")
    .eq("external_id", itemId)
    .maybeSingle();
  if (existing) return json({ recurso: existing, jaExistia: true });

  const { data: inserted, error: insErr } = await sb
    .from("acessos_recursos")
    .insert({
      tipo: "onedrive",
      provedor: "microsoft",
      nome: name || "(sem nome)",
      external_id: itemId,
      caminho: caminho ?? null,
    })
    .select("*")
    .single();
  if (insErr) return json({ error: "falha_ao_inserir", detalhe: insErr.message }, 500);

  await logMs(sb, quem, "onedrive.addFolder", inserted.id, "ok", { itemId, name });
  return json({ recurso: inserted });
}

async function msFolders(sb: any) {
  const { data, error } = await sb
    .from("acessos_recursos")
    .select("*")
    .eq("tipo", "onedrive")
    // Pasta arquivada não aparece: arquivado_em preenchido = fora de uso.
    // NULL = ativa. Arquivar não apaga nada, só some da tela (é reversível
    // limpando a coluna no banco).
    .is("arquivado_em", null)
    .order("nome", { ascending: true });
  if (error) return json({ error: "falha_ao_listar", detalhe: error.message }, 500);
  return json({ folders: data ?? [] });
}

async function msRemoveFolder(sb: any, quem: string | null, recursoId: string) {
  if (!recursoId) return json({ error: "sem_recursoId" }, 400);
  const { error } = await sb.from("acessos_recursos").delete().eq("id", recursoId);
  if (error) return json({ error: "falha_ao_remover", detalhe: error.message }, 500);
  await logMs(sb, quem, "onedrive.removeFolder", recursoId, "ok", { recursoId });
  return json({ ok: true });
}

// Link compartilhável da pasta (1drv.ms/...). É o link que respeita requireSignIn:
// só quem tem grant (foi convidado) consegue abrir. Vem nas permissões da pasta.
function pickItemLink(value: any[]): string | null {
  const p = (Array.isArray(value) ? value : []).find((x: any) => x?.link?.webUrl);
  return p?.link?.webUrl || null;
}
async function msItemLink(access: string, itemId: string): Promise<string | null> {
  const r = await graphFetch(access, `/me/drive/items/${encodeURIComponent(itemId)}/permissions`);
  if (!r.ok) return null;
  return pickItemLink(Array.isArray(r.json?.value) ? r.json.value : []);
}
async function msShares(sb: any, itemId: string) {
  if (!itemId) return json({ error: "sem_itemId" }, 400);
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const r = await graphFetch(access, `/me/drive/items/${encodeURIComponent(itemId)}/permissions`);
  if (!r.ok) return graphErr(r.status, r.json);
  const value: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
  const shares = value
    // Skip the owner permission (not a "share" to manage).
    .filter((p) => !(Array.isArray(p?.roles) && p.roles.includes("owner")))
    .map((p) => {
      const roles: string[] = Array.isArray(p?.roles) ? p.roles : [];
      const role = roles.includes("write") ? "edição" : "leitura";
      const ident = parsePermIdentity(p);
      return { permId: String(p.id), name: ident.name, email: ident.email, role };
    });
  return json({ shares, link: pickItemLink(value) });
}

async function msShare(
  sb: any,
  quem: string | null,
  itemId: string,
  email: string,
  role: string,
) {
  if (!itemId || !email) return json({ error: "sem_itemId_ou_email" }, 400);
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const graphRole = role === "edição" ? "write" : "read";
  // VERIFIED invite body (Microsoft Learn driveItem:invite). sendInvitation:TRUE so the
  // recipient actually RECEIVES an email with a working link. (sendInvitation:false criava uma
  // permissão de LINK sem URL entregue → a pessoa não recebia nada e não via em "Compartilhado
  // comigo".) requireSignIn:true força login na conta convidada.
  const r = await graphFetch(access, `/me/drive/items/${encodeURIComponent(itemId)}/invite`, {
    method: "POST",
    body: {
      recipients: [{ email }],
      roles: [graphRole],
      requireSignIn: true,
      sendInvitation: true,
      message: "Você recebeu acesso a uma pasta compartilhada da RBV. Entre com sua conta Microsoft para acessar.",
    },
  });
  if (!r.ok) {
    await logMs(sb, quem, "onedrive.share", itemId, "erro", { email, role, status: r.status, detalhe: r.json });
    return json({ error: `graph_http_${r.status}`, detalhe: r.json });
  }
  await logMs(sb, quem, "onedrive.share", itemId, "ok", { email, role: graphRole });
  // link da pasta p/ enviar direto ao colaborador (não depender do e-mail da Microsoft)
  const link = pickItemLink(Array.isArray(r.json?.value) ? r.json.value : []) || await msItemLink(access, itemId);
  // conta Microsoft REAL p/ onde o convite resolveu (pode ser diferente do e-mail convidado = apelido/alias)
  const v0 = Array.isArray(r.json?.value) ? r.json.value[0] : null;
  const account = v0?.grantedToV2?.user?.email || v0?.grantedTo?.user?.email || v0?.grantedToV2?.siteUser?.email || null;
  return json({ ok: true, link, invited: email, account });
}

// Share MANY folders to MANY recipients in one call (used by "Liberar setor"). One token
// refresh, server-side loop, bounded by an op cap. Sends notification (sendInvitation:true).
async function actShareMany(sb: any, quem: string | null, items: unknown, emails: unknown, role: string) {
  // items pode ser array de strings (ids) OU de {id,name}. Normaliza.
  const norm = (Array.isArray(items) ? items : [])
    .map((x: any) => typeof x === "string" ? { id: x, name: null } : (x && x.id ? { id: String(x.id), name: x.name ? String(x.name) : null } : null))
    .filter((x: any) => x && x.id);
  const its = norm.map((x: any) => x.id);
  const ems = Array.isArray(emails) ? emails.filter((x) => typeof x === "string" && x) : [];
  if (!its.length || !ems.length) return json({ error: "sem_items_ou_emails" }, 400);
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const graphRole = role === "edição" ? "write" : "read";
  // Registra as pastas em acessos_recursos (pra Auditoria refletir o que o Drive compartilhou).
  for (const it of norm) {
    try {
      // Sem filtro de arquivado_em: checagem de duplicata, não listagem.
      const { data: ex } = await sb.from("acessos_recursos").select("id").eq("external_id", it.id).maybeSingle();
      if (!ex) await sb.from("acessos_recursos").insert({ tipo: "onedrive", provedor: "microsoft", nome: it.name || "(sem nome)", external_id: it.id });
    } catch (_) { /* dedup best-effort */ }
  }
  const CAP = 600;
  let ok = 0, fail = 0, ops = 0, truncated = false;
  const linkByItem: Record<string, string | null> = {};
  const acctByEmail: Record<string, string | null> = {}; // conta real resolvida por e-mail convidado
  for (const itemId of its) {
    if (ops >= CAP) { truncated = true; break; }
    for (const email of ems) {
      if (ops >= CAP) { truncated = true; break; }
      ops++;
      const r = await graphFetch(access, `/me/drive/items/${encodeURIComponent(itemId)}/invite`, {
        method: "POST",
        body: {
          recipients: [{ email }],
          roles: [graphRole],
          requireSignIn: true,
          sendInvitation: true,
          message: "Você recebeu acesso a uma pasta compartilhada da RBV. Entre com sua conta Microsoft para acessar.",
        },
      });
      if (r.ok) {
        ok++;
        const v0 = Array.isArray(r.json?.value) ? r.json.value[0] : null;
        if (!(itemId in linkByItem)) linkByItem[itemId] = pickItemLink(Array.isArray(r.json?.value) ? r.json.value : []);
        if (!(email in acctByEmail)) acctByEmail[email] = v0?.grantedToV2?.user?.email || v0?.grantedTo?.user?.email || v0?.grantedToV2?.siteUser?.email || null;
      } else fail++;
    }
  }
  const resolved = ems.map((e) => ({ invited: e, account: acctByEmail[e] ?? null }));
  // link por pasta p/ enviar direto ao colaborador (fallback: lê das permissões se o invite não trouxe)
  const links: { id: string; name: string | null; link: string | null }[] = [];
  for (const it of norm) {
    if (!(it.id in linkByItem)) continue; // pulou (truncado) → sem link
    let lk = linkByItem[it.id];
    if (!lk) lk = await msItemLink(access, it.id);
    links.push({ id: it.id, name: it.name, link: lk });
  }
  await logMs(sb, quem, "onedrive.shareMany", null, fail ? "parcial" : "ok", { items: its.length, emails: ems.length, ok, fail });
  return json({ ok, fail, ops, truncated, links, resolved });
}

// Varredura COMPLETA: percorre a árvore de CADA marca (acessos_drive_marcas) e coleta os
// acessos DEFINIDOS (não herdados) em cada pasta — pega todo mundo, em qualquer marca/pasta,
// sem depender de acessos_recursos. Bounded por profundidade + teto de chamadas.
async function actAccessScan(sb: any, maxDepth: unknown) {
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const depth = Math.max(1, Math.min(5, Number(maxDepth) || 2));
  const CALL_CAP = 900;
  let calls = 0;
  let truncated = false;
  const items: Array<{ email: string; name: string; role: string; marca: string; pasta: string }> = [];

  const { data: marcas } = await sb.from("acessos_drive_marcas").select("nome, external_id").order("ordem");
  for (const m of (marcas ?? [])) {
    if (!m.external_id) continue;
    let frontier: Array<{ id: string; name: string }> = [{ id: m.external_id, name: m.nome }];
    for (let d = 0; d <= depth && frontier.length; d++) {
      const next: Array<{ id: string; name: string }> = [];
      for (const node of frontier) {
        if (calls >= CALL_CAP) { truncated = true; break; }
        calls++;
        const pr = await graphFetch(access, `/me/drive/items/${encodeURIComponent(node.id)}/permissions`);
        if (pr.ok) {
          for (const p of (Array.isArray(pr.json?.value) ? pr.json.value : [])) {
            if (Array.isArray(p?.roles) && p.roles.includes("owner")) continue;
            if (p?.inheritedFrom) continue; // só o grant DEFINIDO aqui (evita duplicar herdados)
            const ident = parsePermIdentity(p);
            if (!ident.email) continue;
            const role = (Array.isArray(p?.roles) && p.roles.includes("write")) ? "edição" : "leitura";
            items.push({ email: ident.email.toLowerCase(), name: ident.name, role, marca: m.nome, pasta: node.name });
          }
        }
        if (d < depth && calls < CALL_CAP) {
          calls++;
          const cr = await graphFetch(access, `/me/drive/items/${encodeURIComponent(node.id)}/children?$top=200&$select=id,name,folder`);
          if (cr.ok) {
            for (const k of (Array.isArray(cr.json?.value) ? cr.json.value : [])) {
              if (k && k.folder != null) next.push({ id: String(k.id), name: String(k.name ?? "") });
            }
          }
        }
      }
      frontier = next;
    }
  }
  return json({ items, truncated, depth });
}

// Quem já tem acesso a um CONJUNTO de pastas (agregado por pessoa). Usado pelo modal
// "Liberar setor" pra mostrar "quem já tem acesso" como nos outros modais.
async function actSharesMany(sb: any, items: unknown) {
  const its = (Array.isArray(items) ? items : [])
    .map((x: any) => typeof x === "string" ? x : (x && x.id ? String(x.id) : null))
    .filter((x: any) => x);
  if (!its.length) return json({ shares: [], total: 0 });
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const byPerson: Record<string, { name: string; email: string; role: string; folders: number }> = {};
  for (const id of its) {
    const r = await graphFetch(access, `/me/drive/items/${encodeURIComponent(id)}/permissions`);
    if (!r.ok) continue;
    const value: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
    for (const p of value) {
      if (Array.isArray(p?.roles) && p.roles.includes("owner")) continue;
      const ident = parsePermIdentity(p);
      const key = (ident.email || ident.name || "").toLowerCase();
      if (!key) continue;
      const role = Array.isArray(p?.roles) && p.roles.includes("write") ? "edição" : "leitura";
      if (!byPerson[key]) byPerson[key] = { name: ident.name, email: ident.email, role, folders: 0 };
      byPerson[key].folders++;
      if (role === "edição") byPerson[key].role = "edição";
    }
  }
  return json({ shares: Object.values(byPerson).sort((a, b) => b.folders - a.folders), total: its.length });
}
async function actAllShares(sb: any) {
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);

  const { data: recursos } = await sb
    .from("acessos_recursos")
    .select("id, nome, external_id")
    .eq("tipo", "onedrive");
  // DE PROPÓSITO sem filtro de arquivado_em, ao contrário das listagens.
  //
  // Arquivar é decisão de ORGANIZAÇÃO (some do painel); não tira o acesso real de
  // ninguém no OneDrive. A Auditoria existe justamente pra mostrar quem tem acesso
  // DE VERDADE. Se ela pulasse a pasta arquivada, o dia em que alguém arquivasse o
  // OneDrive a tela passaria a dizer "ninguém tem acesso" enquanto as pessoas
  // continuariam entrando nas pastas — ponto cego de segurança, não economia.
  //
  // Medido em 2026-07-17: 370 compartilhamentos ativos, 15 pessoas. Nada disso sai
  // do ar por arquivar. Pasta arquivada com acesso vivo é EXATAMENTE o que a
  // Auditoria precisa gritar.
  const { data: marcas } = await sb
    .from("acessos_drive_marcas")
    .select("id, nome, external_id");

  // Varre as RAÍZES das marcas + as pastas registradas (dedup por external_id). Barato e cobre
  // o acesso por pessoa concedido no topo de cada marca (ex.: Moto Easy Brasil) que não estava
  // em acessos_recursos.
  const folders: Array<{ id: string; nome: string; external_id: string; isRoot: boolean; marca: string | null }> = [];
  const seen = new Set<string>();
  for (const m of (marcas ?? [])) {
    if (m.external_id && !seen.has(m.external_id)) { seen.add(m.external_id); folders.push({ id: String(m.id), nome: m.nome, external_id: m.external_id, isRoot: true, marca: m.nome }); }
  }
  for (const r of (recursos ?? [])) {
    if (r.external_id && !seen.has(r.external_id)) { seen.add(r.external_id); folders.push({ id: String(r.id), nome: r.nome, external_id: r.external_id, isRoot: false, marca: null }); }
  }

  const items: Array<{
    recursoId: string;
    pasta: string;
    name: string;
    email: string;
    role: string;
    isRoot: boolean;
    marca: string | null;
    inherited: boolean;
  }> = [];
  // Pastas que não deu pra ler. Vai na resposta junto com os acessos.
  const falhas: Array<{ pasta: string; motivo: string }> = [];

  for (const recurso of folders) {
    if (!recurso.external_id) continue;
    try {
      const r = await graphFetch(
        access,
        `/me/drive/items/${encodeURIComponent(recurso.external_id)}/permissions`,
      );
      if (!r.ok) {
        // A pasta que falhou vai na resposta, não só no log.
        //
        // Antes isto era um console.warn + continue: a pasta sumia da contagem e quem
        // chamava recebia uma lista a menos SEM SABER. Se falhasse em todas, a resposta
        // era uma lista vazia — idêntica a "ninguém tem acesso". Falha silenciosa que
        // devolve zero é pior que erro: o zero é lido como fato.
        falhas.push({ pasta: String(recurso.nome ?? ""), motivo: `HTTP ${r.status}` });
        continue;
      }
      const value: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
      for (const p of value) {
        if (Array.isArray(p?.roles) && p.roles.includes("owner")) continue;
        const ident = parsePermIdentity(p);
        const role =
          Array.isArray(p?.roles) && p.roles.includes("write") ? "edição" : "leitura";
        items.push({
          recursoId: String(recurso.id),
          pasta: String(recurso.nome ?? ""),
          name: ident.name,
          email: (ident.email || "").toLowerCase(),
          role,
          isRoot: recurso.isRoot,
          marca: recurso.marca,
          inherited: !!p?.inheritedFrom,
        });
      }
    } catch (e) {
      falhas.push({
        pasta: String(recurso.nome ?? ""),
        motivo: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // "falhas" sempre vai junto. Quem lê a Auditoria precisa saber se está vendo o
  // quadro inteiro ou um pedaço: 0 acessos com 0 falhas é "ninguém tem acesso";
  // 0 acessos com 32 falhas é "não consegui olhar". São coisas opostas.
  return json({ items, falhas });
}

async function actRevokeForEmail(sb: any, email: string | null) {
  if (!email) return json({ error: "sem_email" });
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);

  // DE PROPÓSITO sem filtro de arquivado_em (diferente das listagens acima).
  // Aqui não estamos MOSTRANDO pasta, estamos TIRANDO acesso de uma pessoa.
  // Arquivar é uma decisão do painel; não apaga a pasta no OneDrive nem o
  // acesso real que a pessoa tem nela. Se filtrássemos, alguém desligado
  // continuaria enxergando a pasta arquivada de verdade — buraco de segurança.
  // Revogar tem que varrer tudo.
  const { data: recursos } = await sb
    .from("acessos_recursos")
    .select("id, nome, external_id")
    .eq("tipo", "onedrive");

  const target = email.toLowerCase();
  let removed = 0;
  const folders: string[] = [];

  for (const recurso of (recursos ?? [])) {
    if (!recurso.external_id) continue;
    try {
      const r = await graphFetch(
        access,
        `/me/drive/items/${encodeURIComponent(recurso.external_id)}/permissions`,
      );
      if (!r.ok) {
        console.warn(
          "[acessos-proxy] revokeForEmail: falha ao ler permissoes da pasta",
          recurso.nome,
          r.status,
          r.json,
        );
        continue;
      }
      const value: any[] = Array.isArray(r.json?.value) ? r.json.value : [];
      for (const p of value) {
        if (Array.isArray(p?.roles) && p.roles.includes("owner")) continue;
        const ident = parsePermIdentity(p);
        if ((ident.email || "").toLowerCase() !== target) continue;
        const del = await graphFetch(
          access,
          `/me/drive/items/${encodeURIComponent(recurso.external_id)}/permissions/${encodeURIComponent(p.id)}`,
          { method: "DELETE" },
        );
        if (del.ok) {
          removed++;
          folders.push(String(recurso.nome ?? ""));
        } else {
          console.warn(
            "[acessos-proxy] revokeForEmail: DELETE falhou",
            recurso.nome,
            p.id,
            del.status,
            del.json,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[acessos-proxy] revokeForEmail: erro ao processar pasta",
        recurso.nome,
        e instanceof Error ? e.message : e,
      );
    }
  }

  await logMs(sb, null, "onedrive.revoke", email, "ok", removed + " acessos");
  return json({ removed, folders });
}

async function msUnshare(sb: any, quem: string | null, itemId: string, permId: string) {
  if (!itemId || !permId) return json({ error: "sem_itemId_ou_permId" }, 400);
  const conn = await readMsConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshMsToken(conn);
  const r = await graphFetch(
    access,
    `/me/drive/items/${encodeURIComponent(itemId)}/permissions/${encodeURIComponent(permId)}`,
    { method: "DELETE" },
  );
  if (!r.ok) {
    await logMs(sb, quem, "onedrive.unshare", itemId, "erro", { permId, status: r.status, detalhe: r.json });
    return json({ error: `graph_http_${r.status}`, detalhe: r.json });
  }
  await logMs(sb, quem, "onedrive.unshare", itemId, "ok", { permId });
  return json({ ok: true });
}

// --- Zoho WorkDrive: listar e importar pastas ---
//
// Endpoints CONFIRMADOS CONTRA A API REAL em 2026-07-17 (conta RBV & Company),
// não copiados da documentação — a doc oficial é uma página JavaScript e não
// responde a fetch. Cada um foi chamado de verdade e o status anotado:
//
//   1) GET {WD_BASE}/users/me                          -> 200
//      Dá o "org_id" em attributes.last_viewed_org_info.org_id. Esse org_id é o
//      que os endpoints de equipe chamam de teamId.
//   2) GET {WD_BASE}/teams/<org_id>/teamfolders        -> 200  (type: "teamfolders")
//   3) GET {WD_BASE}/teamfolders/<tf_id>/folders       -> 200  (só pastas filhas)
//
// TENTADO E REJEITADO pelo próprio Zoho (não usar — deixa registrado pra ninguém
// tentar de novo achando que é o caminho certo):
//   - GET /users/<zuid>/teams        -> 500 {"errors":[{"id":"F7007","title":"Invalid OAuth scope."}]}
//   - GET /teams/<org_id>/workspaces -> 500 idem
//   Esses dois são o caminho que as bibliotecas de terceiro usam, mas exigem escopo
//   que esta conexão não tem (temos WorkDrive.teamfolders.ALL + WorkDrive.files.ALL).
//   Por isso o org_id vem do /users/me, e não do /users/<zuid>/teams.
//
// O header Accept: application/vnd.api+json é OBRIGATÓRIO: sem ele o Zoho responde
// vazio. A autorização é "Zoho-oauthtoken <token>" (o mesmo esquema do Mail).
const WD_BASE = "https://www.zohoapis.com/workdrive/api/v1";

async function wdFetch(
  access: string,
  path: string,
): Promise<{ ok: boolean; status: number; json: any; raw: string }> {
  const resp = await fetch(WD_BASE + path, {
    headers: {
      Authorization: `Zoho-oauthtoken ${access}`,
      Accept: "application/vnd.api+json",
    },
  });
  const raw = await resp.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!resp.ok) {
    // O corpo de erro do Zoho é { errors:[{id,title}] } — não tem segredo, é seguro logar.
    console.error("[acessos-proxy] workdrive http", resp.status, path, raw.slice(0, 500));
  }
  return { ok: resp.ok, status: resp.status, json: parsed, raw };
}

// Descobre o id da equipe (org). Vem do /users/me — ver o bloco acima.
async function wdOrgId(access: string): Promise<string> {
  const r = await wdFetch(access, "/users/me");
  if (!r.ok) throw new Error(`workdrive_users_me_http_${r.status}`);
  const attrs = r.json?.data?.attributes ?? {};
  const orgId = attrs?.last_viewed_org_info?.org_id ?? attrs?.preferred_org_info?.org_id ?? null;
  if (!orgId) throw new Error("workdrive_sem_org_id");
  return String(orgId);
}

// Varre a árvore: cada pasta de equipe + as pastas de dentro dela.
// Só um nível pra dentro de propósito: a pasta de equipe da RBV tem ~2000 pastas
// no fundo dela. Descer tudo seria centenas de chamadas e um catálogo ilegível.
// O nível de cima é o que interessa pra dar acesso a alguém (uma pasta por cliente).
async function wdColetarPastas(access: string) {
  const orgId = await wdOrgId(access);
  const rTf = await wdFetch(access, `/teams/${encodeURIComponent(orgId)}/teamfolders`);
  if (!rTf.ok) throw new Error(`workdrive_teamfolders_http_${rTf.status}`);

  const pastasDeEquipe = normalizarPastasDoWorkdrive(rTf.json);
  const linhas: any[] = [];

  for (const tf of pastasDeEquipe) {
    // A própria pasta de equipe entra no catálogo: ela é o espaço raiz do cliente.
    linhas.push(
      ...montarLinhasDeRecursos([tf], { driveId: tf.externalId, prefixoDoCaminho: null }),
    );
    const rFilhas = await wdFetch(
      access,
      `/teamfolders/${encodeURIComponent(tf.externalId)}/folders`,
    );
    if (!rFilhas.ok) {
      // Uma pasta de equipe que falha não pode derrubar a listagem inteira.
      console.warn("[acessos-proxy] workdrive: filhas falharam", tf.nome, rFilhas.status);
      continue;
    }
    const filhas = normalizarPastasDoWorkdrive(rFilhas.json);
    linhas.push(
      ...montarLinhasDeRecursos(filhas, { driveId: tf.externalId, prefixoDoCaminho: tf.nome }),
    );
  }
  return { orgId, linhas, totalPastasDeEquipe: pastasDeEquipe.length };
}

async function wdExternalIdsJaGravados(sb: any): Promise<string[]> {
  // DE PROPÓSITO sem filtro de arquivado_em. Esta consulta não é uma listagem
  // pra tela: é a checagem "já importei esta pasta?". Uma pasta arquivada
  // CONTINUA gravada, então ela tem que contar como "já existe" — senão a
  // importação tentaria inserir de novo, esbarraria no índice único do
  // external_id e a importação inteira quebraria. Filtrar aqui mataria a
  // idempotência (rodar 2x não pode duplicar).
  const { data, error } = await sb
    .from("acessos_recursos")
    .select("external_id")
    .eq("tipo", "workdrive");
  if (error) throw new Error("falha_ao_ler_recursos: " + error.message);
  return (data ?? []).map((r: any) => String(r.external_id)).filter(Boolean);
}

// Traduz o "type" de uma permissão do WorkDrive pra algo que uma pessoa entende.
// Descoberto na sondagem real de 2026-07-17: os valores que aparecem na conta da RBV
// são "workspace" (todo o time), "everyone" (qualquer um do time) e "user" (uma pessoa).
// Deixo o cru junto (campo "escopo") pra nunca esconder um valor novo que apareça depois.
function wdTraduzirEscopo(tipo: string): string {
  if (tipo === "user") return "Pessoa específica";
  if (tipo === "workspace") return "Todo o time (workspace)";
  if (tipo === "everyone") return "Qualquer um do time";
  if (tipo === "team") return "Equipe";
  // Valor que a Zoho devolveu e a gente ainda não mapeou (ex.: "folder", visto na sondagem).
  // Mostra o cru rotulado como "Outro" — honesto: não invento um sentido que não confirmei,
  // e fica claro que é caso não previsto, não um bug de tela em branco.
  return tipo ? `Outro (${tipo})` : "?";
}

// zoho.acessoDaPasta -> LÊ (não muda nada) quem tem acesso a UMA pasta e os links dela.
// Funciona com os escopos de hoje — provado na sondagem. É a base da auditoria do WorkDrive.
async function actZohoAcessoDaPasta(sb: any, resourceId: unknown) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const rid = typeof resourceId === "string" && resourceId ? resourceId : null;
  if (!rid) return json({ error: "faltou_resourceId" }, 400);
  const access = await freshAccessToken(conn);

  // Duas leituras independentes: quem tem acesso, e quais links existem. Uma pode falhar
  // sem derrubar a outra — e a falha vai na resposta (campo "falhas"), nunca em silêncio.
  const falhas: Array<{ o_que: string; status: number }> = [];

  let pessoas: any[] = [];
  const rp = await wdFetch(access, `/files/${encodeURIComponent(rid)}/permissions`);
  if (rp.ok) {
    pessoas = (Array.isArray(rp.json?.data) ? rp.json.data : []).map((p: any) => {
      const a = p?.attributes ?? {};
      const info = a?.share_to_entity_info ?? {};
      return {
        // id da PERMISSÃO (recurso JSON:API tem id no topo, igual aos links). É o
        // que a UI precisa pra revogar o acesso do time (zoho.revogarWorkspace).
        // Sem ele, o botão "Remover" de uma permissão de workspace não teria alvo.
        id: p?.id ?? null,
        nome: info.display_name || a.shared_by || a.email_id || "?",
        email: (info.email_id || a.email_id || "").toLowerCase(),
        escopo: wdTraduzirEscopo(String(a.type ?? "")),
        escopo_cru: a.type ?? null,
        compartilhado_por: a.shared_by ?? null,
        expira_em_millis: a.expiry_in_millis ?? 0,
      };
    });
  } else {
    falhas.push({ o_que: "quem tem acesso", status: rp.status });
  }

  let links: any[] = [];
  const rl = await wdFetch(access, `/files/${encodeURIComponent(rid)}/links`);
  if (rl.ok) {
    links = (Array.isArray(rl.json?.data) ? rl.json.data : []).map((l: any) => {
      const a = l?.attributes ?? {};
      return {
        id: l?.id ?? null,
        url: a.link ?? a.download_url ?? null,
        nome: a.link_name ?? null,
        permite_download: a.allow_download ?? null,
        tem_senha: !!(a.is_password_protected ?? a.password_protected),
        expira_em: a.expiration_date || null,
      };
    });
  } else {
    falhas.push({ o_que: "links da pasta", status: rl.status });
  }

  return json({ resourceId: rid, pessoas, links, falhas });
}

// ---------------------------------------------------------------------------
// ESCRITA do WorkDrive. Ações CONSTRANGIDAS: cada uma faz UMA coisa específica com entrada
// validada. NÃO é relay genérico (aquilo era sonda temporária, já removida). O escopo de
// escrita foi provado em 2026-07-18: LINK e WORKSPACE funcionam. "Dar acesso a pessoa
// específica" fica de fora por ora (formato do corpo ainda não confirmado).
//
// role_id do WorkDrive p/ PASTA: 6 = leitura (view), 5 = edição. Traduzido de "papel".
function wdRoleId(papel: unknown): string {
  return papel === "edicao" || papel === "edição" ? "5" : "6";
}

// wdEscrever: POST/DELETE no WorkDrive, só pras ações de escrita abaixo. Corpo opcional.
async function wdEscrever(access: string, metodo: string, path: string, corpo?: unknown) {
  const resp = await fetch(WD_BASE + path, {
    method: metodo,
    headers: {
      Authorization: `Zoho-oauthtoken ${access}`,
      Accept: "application/vnd.api+json",
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const raw = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  return { ok: resp.ok, status: resp.status, json: parsed, raw };
}

// zoho.criarLink -> cria um link de compartilhamento da pasta. Corpo COMPLETO de propósito
// (corpo mínimo dá 500 — descoberto na sondagem). Devolve a URL e o id (pra poder apagar).
async function actZohoCriarLink(sb: any, resourceId: unknown, papel: unknown) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const rid = typeof resourceId === "string" && resourceId ? resourceId : null;
  if (!rid) return json({ error: "faltou_resourceId" }, 400);
  const access = await freshAccessToken(conn);
  const corpo = {
    data: {
      attributes: {
        resource_id: rid,
        role_id: wdRoleId(papel),
        link_name: "Link de compartilhamento",
        allow_download: true,
        request_user_data: false,
      },
      type: "links",
    },
  };
  const r = await wdEscrever(access, "POST", "/links", corpo);
  if (!r.ok) return json({ error: "falha_ao_criar_link", status: r.status, detalhe: (r.raw || "").slice(0, 300) }, 502);
  return json({ ok: true, id: r.json?.data?.id ?? null, url: r.json?.data?.attributes?.link ?? null });
}

// zoho.apagarLink -> tira um link de compartilhamento (revoga o acesso público por ele).
async function actZohoApagarLink(sb: any, linkId: unknown) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const lid = typeof linkId === "string" && linkId ? linkId : null;
  if (!lid) return json({ error: "faltou_linkId" }, 400);
  const access = await freshAccessToken(conn);
  const r = await wdEscrever(access, "DELETE", `/links/${encodeURIComponent(lid)}`);
  // A listagem do Zoho fica desatualizada por um tempo depois de apagar (visto na sondagem):
  // a UI deve confiar neste ok, não na listagem imediata.
  if (!r.ok) return json({ error: "falha_ao_apagar_link", status: r.status, detalhe: (r.raw || "").slice(0, 300) }, 502);
  return json({ ok: true });
}

// zoho.compartilharWorkspace -> dá acesso à pasta pra TODO o time (workspace). Confirmado 201.
async function actZohoCompartilharWorkspace(sb: any, resourceId: unknown, papel: unknown) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const rid = typeof resourceId === "string" && resourceId ? resourceId : null;
  if (!rid) return json({ error: "faltou_resourceId" }, 400);
  const access = await freshAccessToken(conn);
  const corpo = {
    data: { attributes: { resource_id: rid, shared_type: "everyone", role_id: wdRoleId(papel) }, type: "permissions" },
  };
  const r = await wdEscrever(access, "POST", "/permissions", corpo);
  if (!r.ok) return json({ error: "falha_ao_compartilhar", status: r.status, detalhe: (r.raw || "").slice(0, 300) }, 502);
  return json({ ok: true, id: r.json?.data?.id ?? null });
}

// zoho.revogarWorkspace -> tira o acesso do time (apaga a permissão "everyone").
async function actZohoRevogarWorkspace(sb: any, permissaoId: unknown) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const pid = typeof permissaoId === "string" && permissaoId ? permissaoId : null;
  if (!pid) return json({ error: "faltou_permissaoId" }, 400);
  const access = await freshAccessToken(conn);
  const r = await wdEscrever(access, "DELETE", `/permissions/${encodeURIComponent(pid)}`);
  if (!r.ok) return json({ error: "falha_ao_revogar", status: r.status, detalhe: (r.raw || "").slice(0, 300) }, 502);
  return json({ ok: true });
}

// zoho.pastas -> lista o que existe no WorkDrive AGORA, dizendo o que já foi importado.
// Não grava nada. É o "olhar antes de importar".
async function actZohoPastas(sb: any) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshAccessToken(conn);
  const { linhas, totalPastasDeEquipe } = await wdColetarPastas(access);
  const jaGravados = await wdExternalIdsJaGravados(sb);
  const { novas } = separarNovasDasExistentes(linhas, jaGravados);
  const idsNovas = new Set(novas.map((l: any) => l.external_id));

  return json({
    pastasDeEquipe: totalPastasDeEquipe,
    total: linhas.length,
    novas: novas.length,
    jaImportadas: linhas.length - novas.length,
    pastas: linhas.map((l: any) => ({
      nome: l.nome,
      caminho: l.caminho,
      external_id: l.external_id,
      drive_id: l.drive_id,
      jaImportada: !idsNovas.has(l.external_id),
    })),
  });
}

// zoho.importarPastas -> grava em acessos_recursos o que ainda não está lá.
// Rodar duas vezes não duplica: a chave é o external_id (e o banco tem índice único
// pra garantir isso mesmo se dois cliques chegarem juntos).
async function actZohoImportarPastas(sb: any, quem: string | null) {
  const conn = await readZohoConn(sb);
  if (!conn.refresh_token) return json({ error: "nao_conectado" });
  const access = await freshAccessToken(conn);
  const { linhas } = await wdColetarPastas(access);
  const jaGravados = await wdExternalIdsJaGravados(sb);
  const { novas, existentes } = separarNovasDasExistentes(linhas, jaGravados);

  let criadas = 0;
  let erros = 0;
  if (novas.length > 0) {
    const { data, error } = await sb.from("acessos_recursos").insert(novas).select("id");
    if (error) {
      erros = novas.length;
      console.error("[acessos-proxy] workdrive: insert falhou", error.message);
      await logZohoPastas(sb, quem, "erro", { detalhe: error.message, tentadas: novas.length });
      return json({ error: "falha_ao_inserir", detalhe: error.message }, 500);
    }
    criadas = (data ?? []).length;
  }

  const resumo = {
    criadas,
    jaExistiam: existentes.length,
    total: linhas.length,
    erros,
  };
  await logZohoPastas(sb, quem, "ok", resumo);
  return json(resumo);
}

async function logZohoPastas(sb: any, quem: string | null, resultado: string, detalhe: unknown) {
  try {
    await sb.from("acessos_log").insert({
      quem,
      acao: "zoho.importarPastas",
      provedor: "zoho",
      alvo: "acessos_recursos",
      resultado,
      detalhe: typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe),
    });
  } catch (e) {
    console.warn("[acessos-proxy] log importarPastas falhou", e instanceof Error ? e.message : e);
  }
}

async function tratarPedido(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "metodo_invalido" }, 405);

  // --- Auth gate ---
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "sem_token" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) return json({ error: "nao_autenticado" }, 401);

  const sb = admin();
  const { data: prof, error: profErr } = await sb
    .from("profiles")
    .select("role, features")
    .eq("id", user.id)
    .single();
  if (profErr || !prof) return json({ error: "perfil_inexistente" }, 403);
  const isAdmin =
    prof.role === "admin" || (Array.isArray(prof.features) && prof.features.includes("acessos"));
  if (!isAdmin) return json({ error: "sem_permissao" }, 403);

  // --- Dispatch ---
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "json_invalido" }, 400);
  }
  const action = body?.action;
  try {
    switch (action) {
      case "zoho.status":
        return await actStatus(sb);
      case "zoho.authUrl":
        return await actAuthUrl(sb);
      case "zoho.users":
        return await actUsers(sb);
      case "zoho.import":
        return await actImport(sb, user.id);
      case "zoho.suspend":
        return await actZohoSetUser(sb, body.email, "disableUser");
      case "zoho.reactivate":
        return await actZohoSetUser(sb, body.email, "enableUser");
      case "zoho.create":
        return await actZohoCreate(sb, body);
      case "zoho.pastas":
        return await actZohoPastas(sb);
      case "zoho.importarPastas":
        return await actZohoImportarPastas(sb, user.id);
      case "zoho.acessoDaPasta":
        return await actZohoAcessoDaPasta(sb, body?.resourceId);
      case "zoho.criarLink":
        return await actZohoCriarLink(sb, body?.resourceId, body?.papel);
      case "zoho.apagarLink":
        return await actZohoApagarLink(sb, body?.linkId);
      case "zoho.compartilharWorkspace":
        return await actZohoCompartilharWorkspace(sb, body?.resourceId, body?.papel);
      case "zoho.revogarWorkspace":
        return await actZohoRevogarWorkspace(sb, body?.permissaoId);
      case "microsoft.status":
        return await msStatus(sb);
      case "microsoft.authUrl":
        return await msAuthUrl(sb);
      case "microsoft.browse":
        return await msBrowse(sb, body?.itemId ?? null);
      case "microsoft.tree":
        return await actMsTree(sb, body?.itemId, body?.depth);
      case "microsoft.shareMany":
        return await actShareMany(sb, user.id, body?.items, body?.emails, body?.role);
      case "microsoft.addFolder":
        return await msAddFolder(sb, user.id, body?.itemId, body?.name, body?.caminho ?? null);
      case "microsoft.folders":
        return await msFolders(sb);
      case "microsoft.removeFolder":
        return await msRemoveFolder(sb, user.id, body?.recursoId);
      case "microsoft.shares":
        return await msShares(sb, body?.itemId);
      case "microsoft.sharesMany":
        return await actSharesMany(sb, body?.items);
      case "microsoft.accessScan":
        return await actAccessScan(sb, body?.depth);
      case "microsoft.allShares":
        return await actAllShares(sb);
      case "microsoft.share":
        return await msShare(sb, user.id, body?.itemId, body?.email, body?.role);
      case "microsoft.unshare":
        return await msUnshare(sb, user.id, body?.itemId, body?.permId);
      case "microsoft.revokeForEmail":
        return await actRevokeForEmail(sb, body?.email ?? null);
      default:
        return json({ error: "acao_desconhecida", action: action ?? null }, 400);
    }
  } catch (e) {
    console.error("[acessos-proxy] erro acao", action, e instanceof Error ? e.message : e);
    return json({ error: "falha_interna", detalhe: e instanceof Error ? e.message : String(e) }, 500);
  }
}

// A PORTA. Aqui, e só aqui, a resposta recebe a origem certa.
//
// Antes o CORS era um endereço só, escrito na mão. Com a Central atendendo em
// DOIS endereços, uma origem fixa faria o navegador barrar o módulo inteiro no
// endereço que não fosse o escolhido — e o Controle de Acessos simplesmente
// não abriria, sem erro visível na tela.
Deno.serve(async (req: Request) => {
  const cors = corsDoPedido(req, "POST, OPTIONS");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const resp = await tratarPedido(req);
  const headers = new Headers(resp.headers);
  for (const [chave, valor] of Object.entries(cors)) headers.set(chave, valor);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
});

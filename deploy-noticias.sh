#!/usr/bin/env bash
# Deploy do módulo Portal de Notícias.
# Uso:  cd ~/iamundi && bash deploy-noticias.sh
# Roda na SUA máquina (tem internet + keychain do git). Seguro re-rodar.
set -uo pipefail
cd "$(dirname "$0")"

echo "==> Limpando lock antigo (se houver)"
rm -f .git/index.lock 2>/dev/null || true

echo "==> Commit + push"
git add index.html db/migrations/007_noticias_concorrentes.sql \
        db/migrations/008_noticias_seed_2026-06-11.sql coletor/.env.exemplo deploy-noticias.sh 2>/dev/null
if git diff --cached --quiet; then
  echo "    (nada novo para commitar)"
else
  git commit -m "feat(noticias): Portal de Notícias por concorrente" && echo "    commit OK"
fi
git push && echo "    push OK — só o preview da Vercel atualiza; a produção sobe com: ssh op /root/deploy-central.sh"

echo "==> Migrations no Supabase"
# Carrega DATABASE_URL do coletor/.env, se existir.
# Pegue em: Supabase > Project Settings > Database > Connection string (URI).
[ -f coletor/.env ] && set -a && . coletor/.env && set +a
if [ -n "${DATABASE_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  psql "$DATABASE_URL" -f db/migrations/007_noticias_concorrentes.sql && echo "    007 OK"
  psql "$DATABASE_URL" -f db/migrations/008_noticias_seed_2026-06-11.sql && echo "    008 OK (seed)"
else
  echo "    PULADO. Para automatizar, adicione DATABASE_URL no coletor/.env e instale o psql."
  echo "    Ou rode os 2 arquivos .sql manualmente no SQL Editor do Supabase."
fi

echo "==> Pronto."

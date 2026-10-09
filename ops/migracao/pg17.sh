#!/bin/sh
# Ferramentas do Postgres 17 (o servidor de produção é 17.6; o pg_dump 16 do Mac recusa).
# Uso: sh ops/migracao/pg17.sh pg_dump --version
# No macOS o Docker ignora --network host e "localhost" dentro do contêiner não é o Mac:
# por isso URLs locais (127.0.0.1/localhost) são reescritas para host.docker.internal
# (no Linux, o --add-host=...:host-gateway faz o mesmo nome funcionar).
set -eu
for a in "$@"; do
  shift
  set -- "$@" "$(printf '%s' "$a" | sed -E 's#(@|//)(127\.0\.0\.1|localhost)([:/])#\1host.docker.internal\3#')"
done
exec docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$PWD:/work" -w /work postgres:17 "$@"

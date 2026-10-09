#!/bin/sh
# Ferramentas do Postgres 17 (o servidor de produção é 17.6; o pg_dump 16 do Mac recusa).
# Uso: sh ops/migracao/pg17.sh pg_dump --version
# macOS: o Docker Desktop ignora --network host e "localhost" dentro do contêiner não é o Mac;
# por isso, só no Darwin, URLs locais (127.0.0.1/localhost) viram host.docker.internal.
# Linux: --network host faz o localhost do contêiner ser o da máquina, sem reescrever nada.
set -eu
if [ "$(uname -s)" = Darwin ]; then
  for a in "$@"; do
    shift
    set -- "$@" "$(printf '%s' "$a" | sed -E 's#(@|//)(127\.0\.0\.1|localhost)([:/])#\1host.docker.internal\3#')"
  done
  REDE=
else
  REDE=--network=host
fi
# shellcheck disable=SC2086
exec docker run --rm -i $REDE -v "$PWD:/work" -w /work postgres:17 "$@"

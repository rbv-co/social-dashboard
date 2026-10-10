#!/usr/bin/env bash
# Faxina do Storage + vigia de armazenamento (era .github/workflows/faxina-storage.yml). Chamado por rodar-robo.sh.
# O vigia roda MESMO que a faxina falhe (no Actions era `if: always()`); o código de saída é o pior dos dois.
# DRY=1 na chamada (ex.: DRY=1 faxina-storage.sh) faz a faxina só simular.
set -u
DRY="${DRY:-0}" node coletor/faxina-fabrica.mjs; a=$?
node coletor/vigia-armazenamento.mjs; b=$?
[ "$a" -ne 0 ] && exit "$a"
exit "$b"

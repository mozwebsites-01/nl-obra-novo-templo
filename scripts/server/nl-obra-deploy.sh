#!/bin/bash
# Publica o sistema NL Obra a partir do GitHub (corre de 5 em 5 minutos pelo cron).
SRC="$HOME/nl-obra-src"
DST="$HOME/domains/nataniellitsure.tr/public_html"
LOG="$HOME/nl-obra-deploy.log"
cd "$SRC" || exit 1
git fetch -q origin main || { echo "$(date '+%F %T') ERRO: git fetch" >> "$LOG"; exit 1; }
if [ "$1" != "force" ] && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then exit 0; fi
git reset -q --hard origin/main
rsync -rlt --checksum --exclude=.git --exclude-from=.deployignore ./ "$DST"/
echo "$(date '+%F %T') publicado: $(git log --oneline -1)" >> "$LOG"

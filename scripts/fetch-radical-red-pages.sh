#!/bin/sh
# sh scripts/fetch-radical-red-pages.sh <cache dir>: saves the boss pages listed on radicalredtracker.com, one per second.
set -e
mkdir -p "$1"
UA="PokemonTeamBuilderDataBuild/1.0 (https://github.com/Enrique-Perez-H/pokemon-team-builder; one-off data build)"
for s in $(curl -sS -A "$UA" https://radicalredtracker.com/bosses | grep -o '/bosses/[a-z0-9-]*' | sort -u | sed 's#/bosses/##'); do
  curl -sS -A "$UA" -o "$1/$s.html" "https://radicalredtracker.com/bosses/$s"; sleep 1
done

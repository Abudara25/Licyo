#!/usr/bin/env bash
# Télécharge la référence visuelle Linux officielle, produite par le workflow « visual » sur main (phase 4B.2).
# Une branche ou une PR ne fabrique JAMAIS sa propre référence : sans référence de main disponible (jamais
# générée, ou artefact expiré après 90 jours), ce script échoue et la CI visuelle est rouge.
#
# Variables : GITHUB_REPOSITORY (fournie par GitHub Actions), GH_TOKEN, GITHUB_ENV (facultative),
# VISUAL_BASELINE_BRANCH (défaut : main ; sert uniquement à démontrer le cas « référence absente »).
set -euo pipefail

BRANCH="${VISUAL_BASELINE_BRANCH:-main}"
DEST=".baseline/linux"

fail() {
  echo "::error title=Baseline visuelle ${BRANCH} introuvable::$1"
  echo "Baseline visuelle ${BRANCH} introuvable : $1" >&2
  echo "Exécuter le workflow « visual » sur ${BRANCH} (push sur ${BRANCH}, ou « Run workflow » depuis l'onglet Actions) pour générer une référence officielle avant de valider cette PR." >&2
  exit 1
}

run_id=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow visual.yml --branch "$BRANCH" --status success --limit 20 \
  --json databaseId,event --jq '[.[] | select(.event == "push" or .event == "workflow_dispatch")][0].databaseId // empty')
[ -n "$run_id" ] || fail "aucune exécution réussie du workflow visual sur ${BRANCH}."

rm -rf "$DEST"
gh run download "$run_id" --repo "$GITHUB_REPOSITORY" --name visual-baseline-linux --dir "$DEST" \
  || fail "l'artefact visual-baseline-linux de l'exécution ${run_id} est absent ou expiré (conservation 90 jours)."

count=$(find "$DEST" -name '*.png' | wc -l | tr -d ' ')
# Référence vide = échec ; une capture manquante fait de toute façon échouer la comparaison Playwright.
[ "$count" -gt 0 ] || fail "référence vide dans l'exécution ${run_id}."

echo "Référence visuelle : ${BRANCH}, exécution ${run_id} (${count} captures)."
if [ -n "${GITHUB_ENV:-}" ]; then echo "VISUAL_BASELINE=${BRANCH} (run ${run_id})" >> "$GITHUB_ENV"; fi

#!/usr/bin/env bash
set -euo pipefail

RAW_BASE="https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/roxifyCrypt"
VENCORD_DIR="$HOME/Vencord"
ROXIFY_LIB="$HOME/roxify-lib"
SKIP_INJECT=0

while [ $# -gt 0 ]; do
    case "$1" in
        --vencord-dir) VENCORD_DIR="$2"; shift 2 ;;
        --roxify-lib) ROXIFY_LIB="$2"; shift 2 ;;
        --skip-inject) SKIP_INJECT=1; shift ;;
        -h|--help)
            echo "Usage: install.sh [--vencord-dir DIR] [--roxify-lib DIR] [--skip-inject]"
            exit 0 ;;
        *)
            echo "Option inconnue : $1" >&2
            exit 1 ;;
    esac
done

if [ -t 1 ]; then
    C_STEP=$'\033[36m'; C_OK=$'\033[32m'; C_NOTE=$'\033[33m'; C_ERR=$'\033[31m'; C_TITLE=$'\033[35m'; C_OFF=$'\033[0m'
else
    C_STEP=""; C_OK=""; C_NOTE=""; C_ERR=""; C_TITLE=""; C_OFF=""
fi

step() { printf '\n%s==> %s%s\n' "$C_STEP" "$1" "$C_OFF"; }
ok() { printf '%s    ok : %s%s\n' "$C_OK" "$1" "$C_OFF"; }
note() { printf '%s    !  %s%s\n' "$C_NOTE" "$1" "$C_OFF"; }
die() { printf '\n%sInstallation interrompue : %s%s\n' "$C_ERR" "$1" "$C_OFF" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

SCRIPT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

printf '%sRoxifyCrypt : installation automatique%s\n' "$C_TITLE" "$C_OFF"
echo "Vencord   : $VENCORD_DIR"
echo "roxify    : $ROXIFY_LIB"

step "Verification des prerequis"

have git || die "git est introuvable. Installe-le avec ton gestionnaire de paquets puis relance."
ok "git"

have node || die "Node.js est introuvable. Installe la version 18 ou plus recente puis relance."
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 18 ] || die "Node.js $NODE_MAJOR est trop ancien, il faut au moins la version 18."
ok "node $(node -v)"

have npm || die "npm est introuvable alors que Node.js est present."

if ! have pnpm; then
    note "pnpm absent, installation globale via npm"
    npm install -g pnpm || die "npm install -g pnpm a echoue. Relance avec sudo, ou installe pnpm a la main."
    have pnpm || die "pnpm vient d'etre installe mais reste introuvable. Rouvre ton terminal puis relance ce script."
fi
ok "pnpm $(pnpm -v)"

step "Vencord"

if [ -d "$VENCORD_DIR/.git" ]; then
    ok "deja present, mise a jour"
    git -C "$VENCORD_DIR" pull --ff-only || note "impossible de mettre a jour le depot Vencord, on continue avec la version locale"
elif [ -d "$VENCORD_DIR" ] && [ -n "$(ls -A "$VENCORD_DIR" 2>/dev/null)" ]; then
    die "$VENCORD_DIR existe deja et n'est pas un clone de Vencord. Choisis un autre dossier avec --vencord-dir."
else
    git clone https://github.com/Vendicated/Vencord "$VENCORD_DIR" || die "le clone de Vencord a echoue"
    ok "clone termine"
fi

step "Dependances de Vencord"
if ! (cd "$VENCORD_DIR" && pnpm install --frozen-lockfile); then
    note "lockfile incompatible avec ta version de pnpm, nouvelle tentative sans --frozen-lockfile"
    (cd "$VENCORD_DIR" && pnpm install) || die "pnpm install a echoue"
fi
ok "dependances installees"

step "Module roxify"
mkdir -p "$ROXIFY_LIB" || die "impossible de creer $ROXIFY_LIB"
[ -f "$ROXIFY_LIB/package.json" ] || (cd "$ROXIFY_LIB" && npm init -y >/dev/null) || die "npm init a echoue"
(cd "$ROXIFY_LIB" && npm install roxify) || die "npm install roxify a echoue"

MODULE_PATH="$ROXIFY_LIB/node_modules/roxify"
[ -f "$MODULE_PATH/package.json" ] || die "le module roxify n'a pas ete installe dans $MODULE_PATH"
ok "roxify installe dans $MODULE_PATH"

step "Plugin RoxifyCrypt"
DEST="$VENCORD_DIR/src/userplugins/roxifyCrypt"
mkdir -p "$DEST"

if [ -n "$SCRIPT_DIR" ] && [ -f "$SCRIPT_DIR/roxifyCrypt/index.tsx" ]; then
    cp -R "$SCRIPT_DIR/roxifyCrypt/." "$DEST/"
    ok "copie depuis $SCRIPT_DIR/roxifyCrypt"
else
    have curl || die "curl est introuvable et le dossier roxifyCrypt/ n'est pas a cote du script."
    for f in index.tsx native.ts README.md; do
        curl -fsSL "$RAW_BASE/$f" -o "$DEST/$f" || die "telechargement de $f impossible"
    done
    ok "telecharge depuis GitHub"
fi

[ -f "$DEST/index.tsx" ] || die "le plugin n'a pas ete copie dans $DEST"

step "Compilation de Vencord"
(cd "$VENCORD_DIR" && pnpm build) || die "pnpm build a echoue"
ok "build termine"

if [ "$SKIP_INJECT" -eq 0 ] && [ ! -t 0 ]; then
    SKIP_INJECT=1
    note "pas de terminal interactif, injection reportee"
fi

if [ "$SKIP_INJECT" -eq 1 ]; then
    note "injection a faire toi-meme : cd $VENCORD_DIR && pnpm inject"
else
    step "Injection dans Discord"
    echo "    Choisis ton Discord dans le menu qui s'ouvre. Le mot de passe sudo peut etre demande."
    (cd "$VENCORD_DIR" && pnpm inject) || die "pnpm inject a echoue"
    ok "injection terminee"
fi

printf '\n%sTermine.%s\n' "$C_TITLE" "$C_OFF"
echo "1. Ferme completement Discord puis rouvre-le."
echo "2. Parametres > Vencord > Plugins > RoxifyCrypt : active-le."
printf '%s3. Dans les reglages du plugin, mets roxifyPath sur :%s\n' "$C_NOTE" "$C_OFF"
printf '%s   %s%s\n' "$C_NOTE" "$MODULE_PATH" "$C_OFF"

# RoxifyCrypt
> Vous aimez ? Laissez une star au repo, en plus c'est français hehehe

Plugin Vencord qui chiffre **automatiquement** tes messages et fichiers Discord dans une image « roxify » (AES‑256), et les affiche déchiffrés en face. L'échange de clés est **automatique** (ECDH) : rien à configurer, aucun secret à s'envoyer.

> ⚠️ Les **deux** personnes doivent avoir le plugin. Sinon l'autre ne voit qu'une petite image illisible.

---

## Installation automatique (recommandé)

Un seul script fait tout : Vencord, le module roxify, le plugin, la compilation et l'injection.
Il te faut juste **Node.js 18+** et **git** installés.

**Windows** (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/install.ps1 | iex
```

**Linux / macOS** :

```bash
curl -fsSL https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/install.sh -o roxify-install.sh
bash roxify-install.sh
```

Le script te demande de choisir ton Discord (Stable / Canary) à la fin. Ensuite : **redémarre complètement Discord**, puis `Paramètres → Vencord → Plugins → RoxifyCrypt` et **active-le**.

Options utiles (si tu as déjà Vencord ailleurs, ou si tu ne veux pas injecter tout de suite) :

```powershell
.\install.ps1 -VencordDir "D:\dev\Vencord" -RoxifyLib "D:\roxify-lib" -SkipInject
```

```bash
./install.sh --vencord-dir ~/dev/Vencord --roxify-lib ~/roxify-lib --skip-inject
```

> Sous **Linux / macOS**, le module roxify n'est pas dans `C:\roxify-lib` : le script affiche à la fin le chemin exact à recopier dans le réglage `roxifyPath` du plugin.

---

## Installation manuelle

**1. Vencord depuis les sources** (les userplugins ne marchent que comme ça) :

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install
```

**2. Le module roxify.** Copie‑colle ce bloc **tel quel** : le chemin doit être exactement celui‑ci, c'est celui que le plugin attend par défaut.

```bash
mkdir C:\roxify-lib
cd C:\roxify-lib
npm init -y
npm install roxify
```

**3. Le plugin.** Mets le dossier `roxifyCrypt/` dans `Vencord/src/userplugins/`.

**4. Compile et injecte :**

```bash
cd Vencord
pnpm build
pnpm inject       # choisis ton Discord (Stable / Canary)
```

Puis **redémarre complètement Discord** (pas juste Ctrl+R).

## Activation

`Paramètres → Vencord → Plugins → RoxifyCrypt` : **active‑le**. C'est tout.
Le réglage `roxifyPath` est déjà rempli avec `C:\roxify-lib\node_modules\roxify` (l'étape 2), donc si tu as suivi le README tu n'as **rien** à configurer.

## Utilisation

Écris normalement dans un **MP**. Ton message part chiffré (le texte en clair n'est **jamais** envoyé à Discord), et le contenu déchiffré s'affiche sous l'image en face.

Le **tout premier** message à quelqu'un déclenche l'échange de clés (une seule fois) : tu tapes, le champ se vide, l'échange se fait tout seul en une ou deux secondes, et ton message part chiffré automatiquement juste après. Ensuite, tout est instantané.

Ça marche aussi pour les **images / fichiers** et pour l'**édition** d'un message.

### Commandes utiles

| Commande | Effet |
|---|---|
| `/roxid` | Affiche les empreintes à comparer hors Discord (pour vérifier qu'il n'y a pas d'espion). |
| `/roxplain` | Coupe (ou remet) le chiffrement **partout**. Réglage global, conservé après redémarrage. |
| `/roxkey-show` | Explique quelle clé est active ici. |

Le chiffrement se règle **globalement** (réglage `autoEncrypt`, ou `/roxplain`), et pas salon par salon : si tu le coupes, il reste coupé après redémarrage de Discord. Le réglage `scope` décide où ça chiffre : MP seulement (défaut) ou tous les salons.

## Sécurité (l'essentiel)

- Chiffrement **AES‑256‑GCM + PBKDF2**, avec une clé dérivée par **ECDH P‑256**. Discord ne voit qu'une image.
- Ta **clé privée ne quitte jamais** ta machine.
- Au tout premier échange, un espion actif pourrait en théorie s'intercaler. Pour l'exclure : faites `/roxid` chacun de votre côté et comparez les empreintes **hors de Discord** (vocal, SMS). Si elles sont identiques, personne ne s'est intercalé.

## Dépannage

- **« roxify introuvable »** : le module n'est pas au bon endroit. Refais l'étape 2, ou corrige `roxifyPath` dans les réglages.
- **« échange de clés en cours »** qui ne finit jamais : l'autre n'a pas le plugin, ou est hors ligne. `/roxplain` pour envoyer en clair.
- Après une modif du code : `pnpm build` puis redémarre Discord.

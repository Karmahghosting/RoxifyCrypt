# RoxifyCrypt

Plugin Vencord qui chiffre **automatiquement** tes messages et fichiers Discord dans une image « roxify » (AES‑256), et les affiche déchiffrés en face. L'échange de clés est **automatique** (ECDH) : rien à configurer, aucun secret à s'envoyer.

> ⚠️ Les **deux** personnes doivent avoir le plugin. Sinon l'autre ne voit qu'une petite image illisible.

---

## Installation automatique (recommandé)

**Windows** (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/install.ps1 | iex
```

**Linux / macOS** :

```bash
curl -fsSL https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/install.sh -o roxify-install.sh
bash roxify-install.sh
```

Le script installe Vencord, le module roxify, le plugin, compile et injecte. Il te faut seulement **Node.js 18+** et **git**.

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

Ça marche aussi pour les **images / fichiers**, les **GIF** (Tenor, liens directs) et l'**édition** d'un message.

**Deux styles d'affichage** (réglage `displayMode`) :
- **RoxifyCrypt** : tu vois la petite image roxify et les cadenas 🔓.
- **Discret** : le contenu déchiffré s'affiche comme un message Discord normal, l'image roxify est masquée.

### Commandes utiles

| Commande | Effet |
|---|---|
| `/roxid` | Affiche les empreintes à comparer hors Discord (pour vérifier qu'il n'y a pas d'espion). |
| `/roxplain` | Coupe (ou remet) le chiffrement **partout**. Réglage global, conservé après redémarrage. |
| `/roxkey-show` | Explique quelle clé est active ici. |

### Activer ou couper le chiffrement

C'est un **réglage global**, pas un réglage par salon : `autoEncrypt` dans les réglages du plugin, ou la commande `/roxplain` qui bascule ce même réglage. Une fois coupé, il le reste après redémarrage de Discord, et tes messages partent en clair partout.

Le réglage `scope` décide **où** ça chiffre quand c'est actif : `MP et groupes seulement` (défaut) ou `Tous les salons`.

### Sur un serveur (beaucoup de monde)

En MP, chaque conversation est chiffrée de bout en bout par ECDH (vraie sécurité). Sur un **serveur**, l'ECDH ne marche pas (impossible d'échanger une clé avec des centaines de gens). Mets `scope` sur **Tous les salons** : les messages y partent chiffrés et **tout le monde qui a le plugin les lit automatiquement**, zéro config.

> ⚠️ Sur un serveur, c'est de l'**obfuscation**, pas une vraie confidentialité : la clé est dérivée du salon, donc n'importe qui ayant le plugin dans ce salon peut lire. Ça cache le contenu à Discord et aux gens sans le plugin, rien de plus. Pour de la vraie confidentialité à plusieurs, mets un `masterSecret` partagé (les réglages) que seuls tes membres connaissent.

## Mises à jour automatiques

Une fois installé, le plugin se **met à jour tout seul** : au démarrage de Discord, il vérifie s'il existe une nouvelle version sur GitHub, la télécharge et la recompile, puis te demande juste de **redémarrer Discord** pour l'appliquer. Plus besoin de re-cloner ou re-copier quoi que ce soit.

- Ça ne remplace tes fichiers que si la version distante est **plus récente** (tes modifs locales à la même version ne sont pas écrasées).
- Pour forcer la vérification : commande **`/roxupdate`**.
- Pour désactiver : décoche `autoUpdate` dans les réglages.

## Sécurité (l'essentiel)

- Chiffrement **AES‑256‑GCM + PBKDF2**, avec une clé dérivée par **ECDH P‑256**. Discord ne voit qu'une image.
- Ta **clé privée ne quitte jamais** ta machine.
- Au tout premier échange, un espion actif pourrait en théorie s'intercaler. Pour l'exclure : faites `/roxid` chacun de votre côté et comparez les empreintes **hors de Discord** (vocal, SMS). Si elles sont identiques, personne ne s'est intercalé.

## Dépannage

- **« roxify introuvable »** : le module n'est pas au bon endroit. Refais l'étape 2, ou corrige `roxifyPath` dans les réglages.
- **« échange de clés en cours »** qui ne finit jamais : l'autre n'a pas le plugin, ou est hors ligne. `/roxplain` pour envoyer en clair.
- Après une modif du code : `pnpm build` puis redémarre Discord.

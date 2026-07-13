# RoxifyCrypt

Plugin Vencord qui chiffre **automatiquement** tes messages et fichiers Discord dans une image « roxify » (AES‑256), et les affiche déchiffrés en face. L'échange de clés est **automatique** (ECDH) : rien à configurer, aucun secret à s'envoyer.

> ⚠️ Les **deux** personnes doivent avoir le plugin. Sinon l'autre ne voit qu'une petite image illisible.

---

## Installation

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
| `/roxon` | Active le chiffrement dans CE salon (utile sur un serveur). |
| `/roxplain` | Envoie en clair dans ce salon (si l'autre n'a pas le plugin). |
| `/roxkey-show` | Explique quelle clé est active ici. |

### Sur un serveur (beaucoup de monde)

En MP, chaque conversation est chiffrée de bout en bout par ECDH (vraie sécurité). Sur un **serveur**, l'ECDH ne marche pas (impossible d'échanger une clé avec des centaines de gens). Fais **`/roxon`** dans le salon voulu : les messages y partent chiffrés et **tout le monde qui a le plugin les lit automatiquement**, zéro config.

> ⚠️ Sur un serveur, c'est de l'**obfuscation**, pas une vraie confidentialité : la clé est dérivée du salon, donc n'importe qui ayant le plugin dans ce salon peut lire. Ça cache le contenu à Discord et aux gens sans le plugin, rien de plus. Pour de la vraie confidentialité à plusieurs, mets un `masterSecret` partagé (les réglages) que seuls tes membres connaissent.

## Sécurité (l'essentiel)

- Chiffrement **AES‑256‑GCM + PBKDF2**, avec une clé dérivée par **ECDH P‑256**. Discord ne voit qu'une image.
- Ta **clé privée ne quitte jamais** ta machine.
- Au tout premier échange, un espion actif pourrait en théorie s'intercaler. Pour l'exclure : faites `/roxid` chacun de votre côté et comparez les empreintes **hors de Discord** (vocal, SMS). Si elles sont identiques, personne ne s'est intercalé.

## Dépannage

- **« roxify introuvable »** : le module n'est pas au bon endroit. Refais l'étape 2, ou corrige `roxifyPath` dans les réglages.
- **« échange de clés en cours »** qui ne finit jamais : l'autre n'a pas le plugin, ou est hors ligne. `/roxplain` pour envoyer en clair.
- Après une modif du code : `pnpm build` puis redémarre Discord.

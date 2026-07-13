# RoxifyCrypt (plugin Vencord)

Chiffre **automatiquement** tes messages **et tes images/fichiers** en une **image roxify** (PNG, données chiffrées en AES‑256‑GCM à l'intérieur des pixels), et affiche **automatiquement** le contenu déchiffré à la réception, sous le message.

Depuis la v2, la clé est **échangée automatiquement par ECDH** : plus rien à configurer, plus aucun secret à s'envoyer.

```
Tu tapes "salut"  ──▶  onBeforeMessageSend  ──▶  native.ts (roxify) chiffre  ──▶  image envoyée
                                  ▲                                                    │
                       clé ECDH partagée                                               ▼
                                  ▼                                          fetch(image originale)
Correspondant     ◀──  texte / image déchiffré sous le message  ◀──  native.ts déchiffre
```

> ⚠️ Les **deux** personnes doivent avoir ce plugin. Sinon l'autre ne voit qu'une mini‑image illisible.

---

## 1. Prérequis : Vencord compilé depuis les sources

Les userplugins **ne marchent pas** avec l'installeur classique de Vencord. Il faut une install « from source » :

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install --frozen-lockfile
```

## 2. Installer le module roxify (une fois)

roxify est un module Node ; on l'installe dans un dossier dédié pour avoir un chemin **prévisible** :

```bash
mkdir C:\roxify-lib
cd C:\roxify-lib
npm init -y
npm install roxify
```

➡️ Le chemin à retenir est : **`C:\roxify-lib\node_modules\roxify`**
(le dossier qui contient `package.json` + `dist/`). Tu le colleras dans les réglages du plugin.

## 3. Copier le plugin

Copie le dossier `roxifyCrypt/` (celui qui contient `index.tsx`, `native.ts`) dans :

```
Vencord/src/userplugins/roxifyCrypt/
```

## 4. Compiler + injecter

```bash
cd Vencord
pnpm build
pnpm inject      # choisis ton Discord (Stable / Canary / Vesktop)
```

Puis **redémarre complètement Discord** (pas juste Ctrl+R).

## 5. Activer

`Discord → Paramètres → Vencord → Plugins → RoxifyCrypt` : active‑le, ouvre ses réglages, et **colle `roxifyPath`**. C'est le **seul** réglage obligatoire.

| Réglage | Valeur |
|---|---|
| **roxifyPath** | `C:\roxify-lib\node_modules\roxify` (étape 2) |
| **keyMode** | `Automatique (ECDH)` *(défaut)* |
| **masterSecret** | vide : sert seulement de repli pour les **groupes** et **serveurs** |
| **scope** | `MP et groupes seulement` *(défaut)* |
| **autoEncrypt** | activé |
| **cleanHandshakes** | activé : efface les messages d'échange de clés |

---

## Comment marche l'échange de clés (rien à faire)

Au premier lancement, le plugin génère **tout seul** une paire de clés ECDH P‑256. La clé privée ne quitte **jamais** ta machine ; seule la clé **publique** circule.

1. Tu écris ton premier message à quelqu'un. Le plugin n'a pas encore sa clé publique, donc **ton message est mis en file d'attente** (le champ de saisie se vide) et le plugin publie un mini‑PNG 1×1 dont le **nom de fichier** porte ta clé publique.
2. Le plugin d'en face le voit, enregistre ta clé, et répond avec la sienne, automatiquement.
3. Les deux plugins **effacent** leurs messages d'échange, et tu vois : *« clé échangée avec X 🔐 »*.
4. Ton message en attente **part alors chiffré, tout seul**. Toutes les conversations suivantes avec cette personne sont chiffrées d'office, sans aucune manip.

Le secret partagé est recalculé de chaque côté (`ECDH(ma privée, sa publique)`) : il n'est **jamais transmis**. Il est ensuite mélangé au `channelId`, donc chaque salon a une clé différente.

Bonus : chaque image chiffrée porte aussi la clé publique de son auteur dans son nom de fichier. Si ton correspondant réinstalle Discord et régénère son identité, l'échange **se répare tout seul**.

## Utilisation

- **Écris normalement** : le message part en image chiffrée, la zone de saisie se vide, le texte déchiffré s'affiche sous l'image (chez toi comme chez l'autre). Le texte en clair n'est **jamais** envoyé à Discord.
- **Envoie une image / un fichier** : il est chiffré pareil, et s'affiche déchiffré chez l'autre (les images s'affichent en vrai, les fichiers en lien de téléchargement). Le nom d'origine est préservé.
- **Édite un message** : il est re‑chiffré et la pièce jointe est remplacée.

### Commandes

| Commande | Effet |
|---|---|
| `/roxid` | Affiche **ton empreinte** et celle du correspondant, à comparer hors Discord (voir Sécurité). |
| `/roxkey-show` | Explique quelle clé est active ici (visible par toi seul). |
| `/roxkey clé:<…>` | Force une clé **manuelle** pour CE salon (prioritaire sur tout le reste). |
| `/roxkey-clear` | Enlève la clé manuelle (retour à l'ECDH / au secret). |
| `/roxplain` | Bascule CE salon en **envoi clair** (échappatoire si l'autre n'a pas le plugin). |

## Modes de clé (réglage `keyMode`)

| Mode | Sécurité | Config | Comment la clé est obtenue |
|---|---|---|---|
| **Automatique (ECDH)** *(défaut)* | ✅ réelle | **zéro** | `ECDH(ma privée, sa publique)` + channelId. **MP uniquement** : groupes et serveurs retombent sur `masterSecret`. |
| **Secret + salon** | ✅ réelle | secret 1× | `masterSecret` mélangé au channelId, une clé par salon |
| **Secret seul** | ✅ réelle | secret 1× | `masterSecret` (même clé partout) |
| **base64(salon)** | ❌ obfuscation | zéro | `base64(channelId)` : **publique, dérivable par tous** |

**Ordre de priorité** : `/roxkey` (manuel), puis ECDH (si MP et mode auto), puis `masterSecret`.

> **Pourquoi l'ECDH ne couvre pas les groupes ?** roxify chiffre avec **une** passphrase, alors qu'un groupe demanderait une clé différente par destinataire. Pour un groupe ou un serveur : mets un `masterSecret` (partagé hors Discord), ou un `/roxkey` sur le salon.

## Sécurité : à savoir

- Chiffrement **AES‑256‑GCM + PBKDF2 (100k itérations)**, fait par roxify, sur un secret **ECDH P‑256**. Discord ne voit qu'un PNG.
- La **clé privée ne sort jamais** de ta machine (stockée dans le DataStore Vencord, en clair sur ton disque comme tout réglage de plugin).
- ⚠️ **MITM au premier contact** : l'échange de clés se fait *en clair sur Discord*. Un attaquant qui contrôlerait le canal **au moment exact** du premier échange pourrait s'intercaler. Pour l'exclure : faites `/roxid` chacun de votre côté et **comparez les empreintes hors de Discord** (vocal, SMS). Si elles correspondent, personne ne s'est intercalé.
- Pas de **forward secrecy** : l'identité ECDH est statique. Qui volerait ta clé privée pourrait déchiffrer l'historique.
- Les octets sont lus depuis `cdn.discordapp.com` (originaux, non ré‑encodés), **pas** depuis le proxy `media.discordapp.net` qui ré‑encode et détruirait les données.

## Limites connues

- ECDH = **MP 1‑à‑1** seulement (groupes/serveurs : `masterSecret` ou `/roxkey`).
- L'image chiffrée reste une mini‑image visible (~7×7 px) ; le contenu déchiffré s'affiche juste en dessous.
- Le déchiffrement se fait à l'affichage et est mis en cache pour la session.
- Si le correspondant est **hors ligne** au premier message, l'échange ne peut pas aboutir tout de suite : ton message **reste en file d'attente chiffrée** et partira dès qu'il se connectera (ou fais `/roxplain` pour l'envoyer en clair).

## Dépannage

- **« roxify introuvable »** au démarrage : vérifie `roxifyPath` (dossier contenant `package.json` + `dist/`).
- **« échange de clés en cours »** qui ne finit jamais : l'autre n'a pas le plugin, ou est hors ligne. `/roxplain` pour envoyer en clair.
- **« clé incorrecte pour ce salon »** : vous n'êtes pas sur le même mode/secret (hors MP), ou une clé `/roxkey` traîne d'un côté. Fais `/roxkey-show`.
- Rien ne se chiffre : `/roxkey-show` pour savoir pourquoi (salon en clair, pas de clé, scope…).
- Après modif de `index.tsx`/`native.ts` : `pnpm build` **et redémarre Discord**.

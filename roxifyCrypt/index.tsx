/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import * as DataStore from "@api/DataStore";
import { definePluginSettings } from "@api/Settings";
import { mergeDefaults } from "@utils/mergeDefaults";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { findByCodeLazy, findByPropsLazy, findLazy } from "@webpack";
import { ChannelStore, DraftType, FluxDispatcher, MessageActions, MessageStore, Parser, React, RestAPI, showToast, SnowflakeUtils, Toasts, UploadManager, useEffect, UserStore, useState } from "@webpack/common";

type RoxNative = PluginNative<typeof import("./native")>;
function optionalNative(): RoxNative | undefined {
    return (VencordNative as any)?.pluginHelpers?.RoxifyCrypt;
}
function getNative(): RoxNative {
    const n = optionalNative();
    if (!n) throw new Error("NATIVE_NOT_LOADED");
    return n;
}

const CloudUpload = findLazy((m: any) => m?.prototype?.trackUploadFinished);
const ComponentDispatch = findByPropsLazy("dispatchToLastSubscribed");
const UploadStore = findByPropsLazy("getUploads");
const DraftManager = findByPropsLazy("clearDraft", "saveDraft");

function clearComposer(channelId: string) {
    try { DraftManager.clearDraft(channelId, DraftType.ChannelMessage); } catch { void 0; }
    try { ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT"); } catch { void 0; }
}

const MEDIA_IMG_RE = /\.(gif|png|jpe?g|webp|avif|bmp)(?:[?#]|$)/i;
const MEDIA_VID_RE = /\.(mp4|webm|mov)(?:[?#]|$)/i;
const MEDIA_HOST_RE = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:media\d*\.tenor\.com|c\.tenor\.com|media\d*\.giphy\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.imgur\.com)\//i;

const C_TEXT = "var(--text-default, var(--text-normal, var(--header-primary, currentColor)))";
const C_MUTED = "var(--text-muted, var(--text-tertiary, var(--text-secondary, currentColor)))";
const C_LINK = "var(--text-link, var(--link, #00a8fc))";
const C_DANGER = "var(--text-danger, var(--status-danger, #f23f43))";

function singleUrl(text: string): string | null {
    const t = text.trim();
    return /^https?:\/\/\S+$/i.test(t) ? t : null;
}
function directMedia(url: string): { kind: "image" | "video"; url: string; } | null {
    if (MEDIA_VID_RE.test(url)) return { kind: "video", url };
    if (MEDIA_IMG_RE.test(url)) return { kind: "image", url };
    if (MEDIA_HOST_RE.test(url)) return { kind: "image", url };
    return null;
}

const LEGACY_NAME = "roxmsg.png";
const PAYLOAD_RE = /^rox_([A-Za-z0-9_-]{80,120})\.png$/;
const HS_RE = /^roxhs_([ir])_([A-Za-z0-9_-]{80,120})\.png$/;
const TEXT_NAME = "__roxtext__";
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const PLUGIN_VERSION = 20260713;

const HS_THROTTLE_MS = 60_000;
const HS_NAG_AFTER_MS = 15_000;

const settings = definePluginSettings({
    roxifyPath: {
        type: OptionType.STRING,
        description: "Chemin ABSOLU vers le dossier du module roxify. Par défaut C:\\roxify-lib\\node_modules\\roxify : si tu as suivi le README, ne change rien.",
        default: "C:\\roxify-lib\\node_modules\\roxify",
        restartNeeded: false,
    },
    keyMode: {
        type: OptionType.SELECT,
        description: "Comment la clé de chiffrement est obtenue.",
        options: [
            { label: "Automatique (ECDH) : sécurité max, zéro config. MP uniquement ; groupes/serveurs retombent sur le secret partagé.", value: "auto", default: true },
            { label: "Secret + salon : sûr, une clé différente par salon, secret à échanger à la main", value: "secretChannel" },
            { label: "Secret seul : sûr, même clé dans tous les salons", value: "secret" },
            { label: "base64(salon) : AUCUNE sécurité (obfuscation), mais zéro config", value: "channel" },
        ],
        restartNeeded: false,
    },
    masterSecret: {
        type: OptionType.STRING,
        description: "Secret PARTAGÉ (échangé hors Discord). Utilisé par les modes « secret », et par le mode Automatique dans les groupes et les serveurs.",
        default: "",
        restartNeeded: false,
    },
    scope: {
        type: OptionType.SELECT,
        description: "Où chiffrer AUTOMATIQUEMENT. Les salons forcés via /roxkey sont toujours inclus.",
        options: [
            { label: "MP et groupes seulement (recommandé)", value: "dm", default: true },
            { label: "Tous les salons (y compris serveurs)", value: "all" },
        ],
        restartNeeded: false,
    },
    autoEncrypt: {
        type: OptionType.BOOLEAN,
        description: "Interrupteur général du chiffrement automatique à l'envoi.",
        default: true,
        restartNeeded: false,
    },
    cleanHandshakes: {
        type: OptionType.BOOLEAN,
        description: "Supprimer automatiquement les messages d'échange de clés une fois la clé obtenue.",
        default: true,
        restartNeeded: false,
    },
    displayMode: {
        type: OptionType.SELECT,
        description: "Comment afficher les messages déchiffrés à la réception.",
        options: [
            { label: "RoxifyCrypt : montre l'image roxify et les cadenas 🔓", value: "roxify", default: true },
            { label: "Discret : comme un message Discord normal (image roxify masquée, sans cadenas)", value: "clean" },
        ],
        restartNeeded: false,
    },
    optimisticSending: {
        type: OptionType.BOOLEAN,
        description: "Afficher tout de suite ton message en gris (« en cours d'envoi »), comme Discord, pendant le chiffrement.",
        default: true,
        restartNeeded: false,
    },
    autoUpdate: {
        type: OptionType.BOOLEAN,
        description: "Vérifier et installer automatiquement les mises à jour de RoxifyCrypt depuis GitHub au démarrage (redémarrage de Discord requis pour appliquer).",
        default: true,
        restartNeeded: false,
    },
});

const HIDE_SELECTORS = "[class*=\"attachment\"], [class*=\"imageContainer\"], [class*=\"imageWrapper\"], [class*=\"mosaicItem\"], [class*=\"mediaAttachmentsContainer\"], [class*=\"mosaic\"], [class*=\"clickableWrapper\"], [class*=\"embedWrapper\"], [class*=\"visualMediaItem\"], [class*=\"gridContainer\"]";
const HIDE_CSS = `
img[src*="/rox"] { display: none !important; }
:is(${HIDE_SELECTORS}):has(img[src*="/rox"]),
:is(${HIDE_SELECTORS}):has(a[href*="/rox"]) { display: none !important; margin: 0 !important; padding: 0 !important; min-height: 0 !important; border: 0 !important; }
`;
let styleEl: HTMLStyleElement | null = null;
let lastMode: string | undefined;
function installStyle() {
    if (styleEl || typeof document === "undefined") return;
    styleEl = document.createElement("style");
    styleEl.id = "roxifycrypt-style";
    document.head.appendChild(styleEl);
}
function removeStyle() {
    styleEl?.remove();
    styleEl = null;
    lastMode = undefined;
}
function applyDisplayMode() {
    if (!styleEl) return;
    const mode = settings.store.displayMode;
    if (mode === lastMode) return;
    lastMode = mode;
    styleEl.textContent = mode === "clean" ? HIDE_CSS : "";
}

const createBotMessage = findByCodeLazy("username:\"Clyde\"");
const optimisticByNonce = new Map<string, { channelId: string; id: string; }>();

function showOptimistic(channelId: string, text: string): string | undefined {
    if (!settings.store.optimisticSending) return undefined;
    try {
        const me = UserStore.getCurrentUser();
        if (!me) return undefined;
        const nonce = SnowflakeUtils.fromTimestamp(Date.now());
        const id = "-" + nonce;
        const base = createBotMessage({ channelId, content: text, embeds: [] });
        const msg: any = mergeDefaults({ id, content: text, nonce, state: "SENDING", channel_id: channelId, flags: 0, mentioned: false, mentions: [], mention_roles: [], mention_everyone: false } as any, base as any);
        msg.author = me;
        msg.flags = 0;
        MessageActions.receiveMessage(channelId, msg);
        optimisticByNonce.set(nonce, { channelId, id });
        return nonce;
    } catch (e) {
        console.error("[RoxifyCrypt] message optimiste échoué:", e);
        return undefined;
    }
}

function clearOptimistic(nonce?: string) {
    if (!nonce) return;
    const o = optimisticByNonce.get(nonce);
    if (!o) return;
    optimisticByNonce.delete(nonce);
    try {
        FluxDispatcher.dispatch({ type: "MESSAGE_DELETE", channelId: o.channelId, id: o.id });
    } catch (e) {
        console.error("[RoxifyCrypt] nettoyage optimiste échoué:", e);
    }
}

const KEYS_KEY = "RoxifyCrypt_channelKeys";
const IDENTITY_KEY = "RoxifyCrypt_identity";
const PEERS_KEY = "RoxifyCrypt_peers";
const PLAIN_KEY = "RoxifyCrypt_plainChannels";
const ENCRYPT_KEY = "RoxifyCrypt_encryptChannels";
const PENDING_HS_KEY = "RoxifyCrypt_pendingHandshakes";

const channelKeys = new Map<string, string>();
const peerKeys = new Map<string, string>();
const plainChannels = new Set<string>();
const encryptChannels = new Set<string>();
const pendingHs = new Map<string, string>();
const lastHsAt = new Map<string, number>();
const secretCache = new Map<string, string>();
const decodeCache = new Map<string, View>();

let epoch = 0;
let autoUpdated = false;
const epochListeners = new Set<() => void>();
function bumpEpoch() {
    epoch++;
    decodeCache.clear();
    epochListeners.forEach(l => l());
}

async function loadState() {
    const [keys, peers, plain, enc, hs] = await Promise.all([
        DataStore.get(KEYS_KEY) as Promise<Record<string, string> | undefined>,
        DataStore.get(PEERS_KEY) as Promise<Record<string, string> | undefined>,
        DataStore.get(PLAIN_KEY) as Promise<string[] | undefined>,
        DataStore.get(ENCRYPT_KEY) as Promise<string[] | undefined>,
        DataStore.get(PENDING_HS_KEY) as Promise<Record<string, string> | undefined>,
    ]);
    channelKeys.clear();
    peerKeys.clear();
    plainChannels.clear();
    encryptChannels.clear();
    pendingHs.clear();
    if (keys) for (const [k, v] of Object.entries(keys)) channelKeys.set(k, v);
    if (peers) for (const [k, v] of Object.entries(peers)) peerKeys.set(k, v);
    if (plain) for (const c of plain) plainChannels.add(c);
    if (enc) for (const c of enc) encryptChannels.add(c);
    if (hs) for (const [k, v] of Object.entries(hs)) pendingHs.set(k, v);
}

async function persistKeys() {
    await DataStore.set(KEYS_KEY, Object.fromEntries(channelKeys));
}
async function persistPeers() {
    await DataStore.set(PEERS_KEY, Object.fromEntries(peerKeys));
}
async function persistPlain() {
    await DataStore.set(PLAIN_KEY, [...plainChannels]);
}
async function persistEncrypt() {
    await DataStore.set(ENCRYPT_KEY, [...encryptChannels]);
}
async function persistPendingHs() {
    await DataStore.set(PENDING_HS_KEY, Object.fromEntries(pendingHs));
}

function b64urlEncode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str: string): Uint8Array<ArrayBuffer> {
    const t = str.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function b64Decode(str: string): Uint8Array<ArrayBuffer> {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
function b64Encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

const ECDH_ALG = { name: "ECDH", namedCurve: "P-256" } as const;

let identity: { priv: CryptoKey; pub: string; } | null = null;
let identityPromise: Promise<{ priv: CryptoKey; pub: string; }> | null = null;

async function buildIdentity() {
    const stored = (await DataStore.get(IDENTITY_KEY)) as { priv: JsonWebKey; pub: JsonWebKey; } | undefined;
    let privJwk: JsonWebKey;
    let pubJwk: JsonWebKey;

    if (stored?.priv && stored?.pub) {
        privJwk = stored.priv;
        pubJwk = stored.pub;
    } else {
        const pair = await crypto.subtle.generateKey(ECDH_ALG, true, ["deriveBits"]);
        privJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
        pubJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
        await DataStore.set(IDENTITY_KEY, { priv: privJwk, pub: pubJwk });
    }

    const priv = await crypto.subtle.importKey("jwk", privJwk, ECDH_ALG, false, ["deriveBits"]);
    const pubKey = await crypto.subtle.importKey("jwk", pubJwk, ECDH_ALG, true, []);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pubKey));
    const built = { priv, pub: b64urlEncode(raw) };
    identity = built;
    return built;
}

function ensureIdentity(): Promise<{ priv: CryptoKey; pub: string; }> {
    if (identity) return Promise.resolve(identity);
    if (!identityPromise) {
        identityPromise = buildIdentity().catch(e => {
            identityPromise = null;
            throw e;
        });
    }
    return identityPromise;
}

async function sharedSecret(peerPub: string): Promise<string> {
    const hit = secretCache.get(peerPub);
    if (hit) return hit;
    const me = await ensureIdentity();
    const peer = await crypto.subtle.importKey("raw", b64urlDecode(peerPub), ECDH_ALG, false, []);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peer }, me.priv, 256));
    const secret = b64Encode(bits);
    secretCache.set(peerPub, secret);
    return secret;
}

async function fingerprint(pub: string): Promise<string> {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", b64urlDecode(pub)));
    const hex = [...digest.slice(0, 8)].map(b => b.toString(16).padStart(2, "0")).join("");
    return (hex.match(/.{4}/g) ?? [hex]).join(" ");
}

function dmPeerId(channelId: string): string | null {
    const ch = ChannelStore.getChannel(channelId);
    if (!ch || ch.type !== 1) return null;
    const me = UserStore.getCurrentUser()?.id;
    const recipients: string[] = ch.recipients ?? [];
    return recipients.find(r => r !== me) ?? recipients[0] ?? null;
}

function deriveFromSecret(channelId: string): string | null {
    const secret = settings.store.masterSecret?.trim();
    switch (settings.store.keyMode) {
        case "channel":
            return channelId ? btoa(channelId) : null;
        case "secret":
            return secret || null;
        case "auto":
        case "secretChannel":
        default:
            return secret && channelId ? `${secret}|${channelId}` : null;
    }
}

async function resolveKey(channelId: string): Promise<string | null> {
    const own = channelKeys.get(channelId);
    if (own) return own;

    if (settings.store.keyMode === "auto") {
        const peer = dmPeerId(channelId);
        if (peer) {
            const pub = peerKeys.get(peer);
            if (!pub) return null;
            try {
                return `${await sharedSecret(pub)}|${channelId}`;
            } catch (e) {
                console.error("[RoxifyCrypt] ECDH derive failed:", e);
                return null;
            }
        }
        const secret = settings.store.masterSecret?.trim();
        return secret ? `${secret}|${channelId}` : (channelId ? btoa(channelId) : null);
    }

    return deriveFromSecret(channelId);
}

function channelAllowed(channelId: string): boolean {
    if (settings.store.scope === "all") return true;
    const t = ChannelStore.getChannel(channelId)?.type;
    return t === 1 || t === 3;
}

function awaitingPeerKey(channelId: string): boolean {
    if (settings.store.keyMode !== "auto") return false;
    if (!settings.store.roxifyPath?.trim()) return false;
    if (channelKeys.has(channelId)) return false;
    const peer = dmPeerId(channelId);
    return !!peer && !peerKeys.has(peer);
}

function mimeOf(name: string): string {
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    switch (ext) {
        case "png": return "image/png";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "webp": return "image/webp";
        case "bmp": return "image/bmp";
        case "avif": return "image/avif";
        default: return "application/octet-stream";
    }
}
function isImageName(name: string): boolean {
    return mimeOf(name).startsWith("image/");
}

function requirePath(): string {
    const p = settings.store.roxifyPath?.trim();
    if (!p) throw new Error("Chemin roxify non configuré (réglages du plugin).");
    return p;
}

function uploadImage(channelId: string, bytes: Uint8Array, name: string): Promise<{ filename: string; uploadedFilename: string; }> {
    return new Promise((resolve, reject) => {
        const file = new File([bytes as BlobPart], name, { type: "image/png" });
        const upload = new CloudUpload({ file, isClip: false, isThumbnail: false, platform: 1 }, channelId, false, 0);
        upload.on("complete", () => resolve({ filename: upload.filename, uploadedFilename: upload.uploadedFilename }));
        upload.on("error", (e: any) => reject(e ?? new Error("upload error")));
        upload.upload();
    });
}

function postAttachment(channelId: string, filename: string, uploadedFilename: string, nonce?: string) {
    return RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: {
            content: "",
            nonce: nonce ?? SnowflakeUtils.fromTimestamp(Date.now()),
            type: 0,
            attachments: [{ id: "0", filename, uploaded_filename: uploadedFilename }],
        },
    });
}

async function payloadName(): Promise<string> {
    try {
        const me = await ensureIdentity();
        return `rox_${me.pub}.png`;
    } catch {
        return LEGACY_NAME;
    }
}

async function encryptAndSend(channelId: string, name: string, data: Uint8Array, key: string, nonce?: string) {
    const png = await getNative().encode(requirePath(), name, data, key);
    const { filename, uploadedFilename } = await uploadImage(channelId, png, await payloadName());
    await postAttachment(channelId, filename, uploadedFilename, nonce);
}

async function encryptAndSendText(channelId: string, text: string, key: string, nonce?: string) {
    await encryptAndSend(channelId, TEXT_NAME, new TextEncoder().encode(text), key, nonce);
}

async function encryptAndSendFile(channelId: string, file: File, key: string) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await encryptAndSend(channelId, file.name || "fichier.bin", bytes, key);
}

async function encryptAndEditText(channelId: string, messageId: string, text: string, key: string) {
    const data = new TextEncoder().encode(text);
    const png = await getNative().encode(requirePath(), TEXT_NAME, data, key);
    const { filename, uploadedFilename } = await uploadImage(channelId, png, await payloadName());
    await RestAPI.patch({
        url: `/channels/${channelId}/messages/${messageId}`,
        body: {
            content: "",
            attachments: [{ id: "0", filename, uploaded_filename: uploadedFilename }],
        },
    });
}

async function sendHandshake(channelId: string, reply: boolean): Promise<string | null> {
    const me = await ensureIdentity();
    const name = `roxhs_${reply ? "r" : "i"}_${me.pub}.png`;
    const { filename, uploadedFilename } = await uploadImage(channelId, b64Decode(TINY_PNG), name);
    const res: any = await postAttachment(channelId, filename, uploadedFilename);
    const id = res?.body?.id ?? null;
    if (id) {
        pendingHs.set(channelId, id);
        await persistPendingHs();
    }
    return id;
}

async function beginHandshake(channelId: string) {
    const now = Date.now();
    if (now - (lastHsAt.get(channelId) ?? 0) < HS_THROTTLE_MS) return;
    lastHsAt.set(channelId, now);
    try {
        await sendHandshake(channelId, false);
    } catch (e) {
        console.error("[RoxifyCrypt] handshake failed:", e);
        showToast("RoxifyCrypt : échec de l'échange de clés", Toasts.Type.FAILURE);
    }
}

async function cleanupHandshake(channelId: string) {
    const id = pendingHs.get(channelId);
    if (!id) return;
    pendingHs.delete(channelId);
    await persistPendingHs();
    if (!settings.store.cleanHandshakes) return;
    try {
        await RestAPI.del({ url: `/channels/${channelId}/messages/${id}` });
    } catch (e) {
        console.error("[RoxifyCrypt] handshake cleanup failed:", e);
    }
}

async function learnPeer(userId: string, pub: string) {
    if (peerKeys.get(userId) === pub) return;
    peerKeys.set(userId, pub);
    secretCache.clear();
    await persistPeers();
    bumpEpoch();
    const name = UserStore.getUser(userId)?.username ?? "ton correspondant";
    showToast(`RoxifyCrypt : clé échangée avec ${name} 🔐`, Toasts.Type.SUCCESS);
}

const pendingByChannel = new Map<string, Array<{ text?: string; files?: File[]; }>>();

function enqueuePending(channelId: string, item: { text?: string; files?: File[]; }) {
    const list = pendingByChannel.get(channelId) ?? [];
    list.push(item);
    pendingByChannel.set(channelId, list);
}

async function flushPending(channelId: string) {
    const list = pendingByChannel.get(channelId);
    if (!list?.length) return;
    const key = await resolveKey(channelId);
    if (!key) return;
    pendingByChannel.delete(channelId);
    for (const it of list) {
        if (it.files) {
            for (const f of it.files) {
                encryptAndSendFile(channelId, f, key).catch(e => console.error("[RoxifyCrypt] envoi fichier en file échoué:", e));
            }
        }
        if (it.text) {
            encryptAndSendText(channelId, it.text, key).catch(e => console.error("[RoxifyCrypt] envoi texte en file échoué:", e));
        }
    }
    showToast("RoxifyCrypt : message chiffré envoyé ✅", Toasts.Type.SUCCESS);
}

function getPendingUploads(channelId: string): any[] {
    try {
        const list = UploadStore.getUploads(channelId, DraftType.ChannelMessage);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}
function fileOf(u: any): File | null {
    return u?.item?.file ?? u?.file ?? u?.item?.platform?.file ?? null;
}

type View =
    | { status: "loading"; }
    | { status: "nokey"; }
    | { status: "waiting"; }
    | { status: "noconfig"; }
    | { status: "badkey"; }
    | { status: "error"; error: string; }
    | { status: "text"; text: string; }
    | { status: "file"; name: string; data: Uint8Array; };

function attachmentsOf(message: any): any[] {
    return Array.isArray(message?.attachments) ? message.attachments : [];
}
function findPayload(message: any): any | null {
    return attachmentsOf(message).find((a: any) => {
        const n = String(a?.filename ?? "");
        return n === LEGACY_NAME || PAYLOAD_RE.test(n);
    }) ?? null;
}
function findHandshake(message: any): any | null {
    return attachmentsOf(message).find((a: any) => HS_RE.test(String(a?.filename ?? ""))) ?? null;
}
function pubOf(filename: string): string | null {
    return PAYLOAD_RE.exec(filename)?.[1] ?? HS_RE.exec(filename)?.[2] ?? null;
}
function authorOf(message: any): string | null {
    return message?.author?.id ?? null;
}
function channelOf(message: any): string {
    return message?.channel_id ?? message?.channelId ?? "";
}

function useEpoch(): number {
    const [value, setValue] = useState(epoch);
    useEffect(() => {
        const listener = () => setValue(epoch);
        epochListeners.add(listener);
        return () => { epochListeners.delete(listener); };
    }, []);
    return value;
}

function RoxAccessory({ message }: { message: any; }) {
    const currentEpoch = useEpoch();
    const hs = findHandshake(message);
    const att = hs ? null : findPayload(message);
    const channelId = channelOf(message);
    const roxifyPath = settings.store.roxifyPath?.trim();
    const clean = settings.store.displayMode === "clean";
    const cacheKey = att ? `${att.id}:${currentEpoch}` : "";

    const [state, setState] = useState<View | undefined>(() => (cacheKey ? decodeCache.get(cacheKey) : undefined));
    const [url, setUrl] = useState<string | undefined>();
    const [media, setMedia] = useState<{ kind: "image" | "video"; url: string; } | undefined>();

    useEffect(() => {
        if (!att) return;
        if (!roxifyPath) { setState({ status: "noconfig" }); return; }

        const cached = decodeCache.get(cacheKey);
        if (cached) { setState(cached); return; }

        let alive = true;
        setState({ status: "loading" });
        (async () => {
            const author = authorOf(message);
            const pub = pubOf(String(att.filename ?? ""));
            const me = UserStore.getCurrentUser()?.id;
            if (pub && author && me && author !== me && ChannelStore.getChannel(channelId)?.type === 1) {
                await learnPeer(author, pub).catch(() => void 0);
            }

            const key = await resolveKey(channelId);
            if (!key) {
                const view: View = awaitingPeerKey(channelId) ? { status: "waiting" } : { status: "nokey" };
                if (alive) setState(view);
                return;
            }

            try {
                const res = await fetch(att.url);
                const buf = new Uint8Array(await res.arrayBuffer());
                const { name, data } = await getNative().decode(roxifyPath, buf, key);
                const view: View = name === TEXT_NAME
                    ? { status: "text", text: new TextDecoder().decode(data) }
                    : { status: "file", name: name || "fichier.bin", data };
                decodeCache.set(cacheKey, view);
                if (alive) setState(view);
            } catch (e: any) {
                const msg = String(e?.message ?? e);
                const view: View = /passphrase/i.test(msg) ? { status: "badkey" }
                    : /NATIVE_NOT_LOADED/.test(msg) ? { status: "error", error: "module natif non chargé. Ferme et rouvre complètement Discord (pas seulement Ctrl+R)." }
                    : { status: "error", error: msg };
                decodeCache.set(cacheKey, view);
                if (alive) setState(view);
            }
        })();
        return () => { alive = false; };
    }, [att?.id, roxifyPath, currentEpoch]);

    useEffect(() => {
        if (state?.status !== "file") { setUrl(undefined); return; }
        const u = URL.createObjectURL(new Blob([state.data as BlobPart], { type: mimeOf(state.name) }));
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [state]);

    useEffect(() => {
        setMedia(undefined);
        if (state?.status !== "text") return;
        const u = singleUrl(state.text);
        if (!u) return;
        let alive = true;
        let blobUrl: string | undefined;
        (async () => {
            try {
                const n = optionalNative();
                if (!n) return;
                let target = directMedia(u) ? u : undefined;
                if (!target && n.resolveMedia) {
                    const r = await n.resolveMedia(u);
                    if (r) target = (r.image && MEDIA_IMG_RE.test(r.image)) ? r.image : (r.video || r.image);
                }
                if (!alive || !target) return;
                if (n.fetchMedia) {
                    const f = await n.fetchMedia(target);
                    if (!alive) return;
                    if (f?.data) {
                        blobUrl = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.type }));
                        setMedia({ kind: f.type.startsWith("video") ? "video" : "image", url: blobUrl });
                        return;
                    }
                }
                if (alive) setMedia({ kind: MEDIA_VID_RE.test(target) ? "video" : "image", url: target });
            } catch { void 0; }
        })();
        return () => { alive = false; if (blobUrl) URL.revokeObjectURL(blobUrl); };
    }, [state]);

    useEffect(() => { applyDisplayMode(); });

    const box = (children: any, color = C_MUTED) => (
        <div style={{ color, fontSize: "0.9rem", padding: "2px 0", display: "flex", gap: "6px", alignItems: "baseline" }}>
            {children}
        </div>
    );

    if (hs) return clean ? null : box(<>🤝 <i>RoxifyCrypt : clé publique échangée</i></>);
    if (!att) return null;

    switch (state?.status) {
        case "text": {
            if (media) {
                const mediaStyle = { maxWidth: "400px", maxHeight: "300px", borderRadius: "8px", display: "block" } as const;
                return (
                    <div style={{ padding: "2px 0" }}>
                        {media.kind === "video"
                            ? <video src={media.url} autoPlay loop muted playsInline style={mediaStyle} />
                            : <img src={media.url} alt="" style={mediaStyle} />}
                    </div>
                );
            }
            if (clean) {
                return <div style={{ padding: "2px 0", color: C_TEXT, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{Parser.parse(state.text)}</div>;
            }
            return box(
                <>
                    <span style={{ flex: "0 0 auto" }}>🔓</span>
                    <span style={{ color: C_TEXT, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {Parser.parse(state.text)}
                    </span>
                </>,
            );
        }
        case "file":
            if (!url) return box(<>🔓 <i>chargement…</i></>);
            return isImageName(state.name)
                ? (
                    <div style={{ padding: "2px 0" }}>
                        <img src={url} alt={state.name} style={{ maxWidth: "400px", maxHeight: "300px", borderRadius: "8px", display: "block" }} />
                    </div>
                )
                : clean
                    ? <div style={{ padding: "2px 0" }}><a href={url} download={state.name} style={{ color: C_LINK }}>📎 {state.name}</a></div>
                    : box(
                        <>
                            <span style={{ flex: "0 0 auto" }}>🔓📎</span>
                            <a href={url} download={state.name} style={{ color: C_LINK }}>{state.name}</a>
                        </>,
                    );
        case "loading":
            return box(<>🔓 <i>déchiffrement…</i></>);
        case "waiting":
            return box(<>🔒 message chiffré, échange de clés en cours, envoie un message pour le déclencher</>);
        case "nokey":
            return box(<>🔒 message roxify chiffré : aucune clé pour ce salon (règle un secret dans les réglages, ou <code>/roxkey</code>)</>);
        case "noconfig":
            return box(<>🔒 message roxify chiffré : configure le chemin du module roxify dans les réglages du plugin</>);
        case "badkey":
            return box(<>🔒 message roxify chiffré : clé incorrecte pour ce salon</>, C_DANGER);
        case "error":
            return box(<>⚠️ RoxifyCrypt : {state.error}</>, C_DANGER);
        default:
            return null;
    }
}

export default definePlugin({
    name: "RoxifyCrypt",
    description: "Chiffre automatiquement vos messages ET vos images en image roxify (AES + clé ECDH échangée automatiquement) et affiche le contenu déchiffré à la réception.",
    authors: [{ name: "u4yz", id: 388659537206444032n }],
    dependencies: ["CommandsAPI", "MessageEventsAPI", "MessageAccessoriesAPI"],
    settings,

    commands: [
        {
            name: "roxkey",
            description: "Force une clé de chiffrement manuelle pour CE salon (prioritaire sur l'ECDH)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                { name: "clé", description: "La clé partagée (identique chez ton correspondant)", type: ApplicationCommandOptionType.STRING, required: true },
            ],
            execute: async (args, ctx) => {
                const key = findOption(args, "clé", "");
                if (!key) return sendBotMessage(ctx.channel.id, { content: "❌ Clé vide." });
                channelKeys.set(ctx.channel.id, key);
                await persistKeys();
                bumpEpoch();
                sendBotMessage(ctx.channel.id, { content: "🔐 Clé manuelle RoxifyCrypt définie pour ce salon." });
            },
        },
        {
            name: "roxkey-clear",
            description: "Supprime la clé manuelle de CE salon (retour à l'ECDH automatique ou au secret partagé)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                channelKeys.delete(ctx.channel.id);
                await persistKeys();
                bumpEpoch();
                sendBotMessage(ctx.channel.id, { content: "🔓 Clé manuelle RoxifyCrypt supprimée pour ce salon." });
            },
        },
        {
            name: "roxkey-show",
            description: "Explique quelle clé est active pour CE salon (visible par toi seul)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                const channelId = ctx.channel.id;
                const own = channelKeys.get(channelId);
                if (own) return sendBotMessage(channelId, { content: `🔑 Clé manuelle (/roxkey) : \`${own}\`` });

                if (plainChannels.has(channelId))
                    return sendBotMessage(channelId, { content: "📢 Salon en clair (`/roxplain` pour réactiver le chiffrement)." });

                if (settings.store.keyMode === "auto") {
                    const peer = dmPeerId(channelId);
                    if (peer) {
                        const pub = peerKeys.get(peer);
                        const name = UserStore.getUser(peer)?.username ?? peer;
                        return sendBotMessage(channelId, {
                            content: pub
                                ? `🔑 Clé ECDH automatique active avec **${name}**. \`/roxid\` pour vérifier les empreintes.`
                                : `🤝 Pas encore de clé pour **${name}**. Envoie un message : l'échange de clés se déclenchera tout seul.`,
                        });
                    }
                }

                const eff = deriveFromSecret(channelId);
                const mode = settings.store.keyMode;
                sendBotMessage(channelId, {
                    content: eff
                        ? `🔑 Clé dérivée du secret partagé (mode « ${mode} »).` + (mode === "channel" ? "\n⚠️ Mode obfuscation : clé publique, aucune sécurité réelle." : "")
                        : "🚫 Aucune clé pour ce salon (envoi EN CLAIR). Règle un secret dans les réglages, ou fais `/roxkey`.",
                });
            },
        },
        {
            name: "roxid",
            description: "Affiche les empreintes ECDH (la tienne et celle du correspondant) pour vérifier qu'il n'y a pas d'espion",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                const channelId = ctx.channel.id;
                try {
                    const me = await ensureIdentity();
                    const mine = await fingerprint(me.pub);
                    const peer = dmPeerId(channelId);
                    const pub = peer ? peerKeys.get(peer) : null;
                    const name = peer ? UserStore.getUser(peer)?.username ?? peer : null;

                    let msg = `🪪 **Ton empreinte** : \`${mine}\``;
                    if (pub && name) {
                        msg += `\n🪪 **Empreinte de ${name}** : \`${await fingerprint(pub)}\``;
                        msg += "\n\nComparez ces deux lignes **hors de Discord** (vocal, SMS…). Si elles correspondent des deux côtés, personne ne s'est intercalé.";
                    } else if (peer) {
                        msg += `\n🤝 Aucune clé encore reçue de **${name}**.`;
                    }
                    sendBotMessage(channelId, { content: msg });
                } catch (e: any) {
                    sendBotMessage(channelId, { content: `⚠️ ${String(e?.message ?? e)}` });
                }
            },
        },
        {
            name: "roxplain",
            description: "Active/désactive l'envoi EN CLAIR dans CE salon (échappatoire si le correspondant n'a pas le plugin)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                const channelId = ctx.channel.id;
                const on = plainChannels.has(channelId);
                if (on) plainChannels.delete(channelId);
                else { plainChannels.add(channelId); encryptChannels.delete(channelId); }
                await Promise.all([persistPlain(), persistEncrypt()]);
                bumpEpoch();
                sendBotMessage(channelId, {
                    content: on
                        ? "🔐 Chiffrement RoxifyCrypt réactivé dans ce salon."
                        : "📢 Ce salon envoie désormais **en clair**. Refais `/roxplain` pour rechiffrer.",
                });
            },
        },
        {
            name: "roxon",
            description: "Active le chiffrement automatique dans CE salon, même sur un serveur (obfuscation : tout le monde avec le plugin lit)",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                const channelId = ctx.channel.id;
                plainChannels.delete(channelId);
                encryptChannels.add(channelId);
                await Promise.all([persistPlain(), persistEncrypt()]);
                bumpEpoch();
                sendBotMessage(channelId, {
                    content: "🔐 Chiffrement activé dans ce salon. Toute personne ayant RoxifyCrypt y lira les messages.\n⚠️ **Obfuscation** : ça cache le contenu à Discord et aux gens sans le plugin, mais ce n'est PAS une vraie confidentialité (le plugin est public). `/roxplain` pour repasser en clair.",
                });
            },
        },
        {
            name: "roxupdate",
            description: "Vérifie et installe la dernière version de RoxifyCrypt depuis GitHub",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [],
            execute: async (_args, ctx) => {
                sendBotMessage(ctx.channel.id, { content: "🔄 Recherche d'une mise à jour RoxifyCrypt…" });
                try {
                    const r = await getNative().updatePlugin(PLUGIN_VERSION);
                    const msg = r.error
                        ? `⚠️ Échec : ${r.error}`
                        : !r.updated
                            ? `✅ Déjà à jour (v${r.current}${r.remote ? `, distant v${r.remote}` : ""}).`
                            : `⬆️ v${r.current} → v${r.remote} téléchargée${r.built ? " et compilée" : " (compile avec pnpm build)"}. **Redémarre Discord** pour l'appliquer.`;
                    sendBotMessage(ctx.channel.id, { content: msg });
                } catch (e: any) {
                    sendBotMessage(ctx.channel.id, { content: `⚠️ ${String(e?.message ?? e)}` });
                }
            },
        },
    ],

    flux: {
        async MESSAGE_CREATE(event: any) {
            try {
                const message = event?.message;
                const channelId = event?.channelId ?? channelOf(message);
                if (message?.nonce) clearOptimistic(String(message.nonce));
                const author = authorOf(message);
                const me = UserStore.getCurrentUser()?.id;
                if (!message || !channelId || !author || !me || author === me) return;
                if (ChannelStore.getChannel(channelId)?.type !== 1) return;

                const hs = findHandshake(message);
                const payload = hs ? null : findPayload(message);
                const att = hs ?? payload;
                if (!att) return;

                const pub = pubOf(String(att.filename ?? ""));
                if (pub) await learnPeer(author, pub);
                await cleanupHandshake(channelId);

                if (hs && HS_RE.exec(String(hs.filename))?.[1] === "i") {
                    const now = Date.now();
                    if (now - (lastHsAt.get(channelId) ?? 0) > 5000) {
                        lastHsAt.set(channelId, now);
                        await sendHandshake(channelId, true);
                    }
                }

                await flushPending(channelId);
            } catch (e) {
                console.error("[RoxifyCrypt] MESSAGE_CREATE failed:", e);
            }
        },
    },

    async onBeforeMessageSend(channelId: string, message: { content: string; }) {
        if (!settings.store.autoEncrypt) return;
        if (plainChannels.has(channelId)) return;
        if (!channelKeys.has(channelId) && !encryptChannels.has(channelId) && !channelAllowed(channelId)) return;

        const key = await resolveKey(channelId);

        if (!key) {
            const peer = settings.store.keyMode === "auto" && !plainChannels.has(channelId) ? dmPeerId(channelId) : null;
            if (!peer) return;

            if (!settings.store.roxifyPath?.trim()) {
                sendBotMessage(channelId, {
                    content: "🔒 RoxifyCrypt : configure d'abord le chemin du module roxify dans les réglages.\n**Message non envoyé** (pour ne jamais l'envoyer en clair par erreur).",
                });
                return { cancel: true };
            }

            const uploads = getPendingUploads(channelId);
            const files = uploads.map(fileOf).filter(Boolean) as File[];
            if (files.length !== uploads.length) {
                showToast("RoxifyCrypt : impossible de lire les fichiers à chiffrer, envoi annulé", Toasts.Type.FAILURE);
                return { cancel: true };
            }
            const text = message.content?.trim();
            if (text || files.length) {
                enqueuePending(channelId, { text: text || undefined, files: files.length ? files : undefined });
                if (files.length) UploadManager.clearAll(channelId, DraftType.ChannelMessage);
                clearComposer(channelId);
            }

            const alreadyTried = lastHsAt.has(channelId);
            const waited = Date.now() - (lastHsAt.get(channelId) ?? 0);
            void beginHandshake(channelId);

            if (alreadyTried && waited > HS_NAG_AFTER_MS) {
                sendBotMessage(channelId, {
                    content: "🤝 Toujours aucune réponse de ton correspondant : il est hors ligne, ou RoxifyCrypt n'est pas installé chez lui.\nTon message reste **en file d'attente chiffrée** et partira automatiquement dès qu'il sera joignable.\n• `/roxplain` pour l'envoyer en clair à la place.",
                });
            } else {
                showToast("RoxifyCrypt : échange de clés en cours… ton message partira chiffré tout seul.", Toasts.Type.MESSAGE);
            }
            return { cancel: true };
        }

        let handled = false;

        const uploads = getPendingUploads(channelId);
        if (uploads.length) {
            const files = uploads.map(fileOf).filter(Boolean) as File[];
            if (files.length !== uploads.length) {
                showToast("RoxifyCrypt : impossible de lire les fichiers à chiffrer, envoi annulé", Toasts.Type.FAILURE);
                return { cancel: true };
            }
            UploadManager.clearAll(channelId, DraftType.ChannelMessage);
            for (const f of files) {
                encryptAndSendFile(channelId, f, key).catch(e => {
                    showToast("RoxifyCrypt : échec du chiffrement d'un fichier", Toasts.Type.FAILURE);
                    console.error("[RoxifyCrypt] file encrypt failed:", e);
                });
            }
            handled = true;
        }

        const content = message.content?.trim();
        if (content) {
            const nonce = showOptimistic(channelId, content);
            encryptAndSendText(channelId, content, key, nonce).catch(e => {
                clearOptimistic(nonce);
                showToast("RoxifyCrypt : échec du chiffrement, message NON envoyé", Toasts.Type.FAILURE);
                console.error("[RoxifyCrypt] text encrypt failed:", e);
            });
            clearComposer(channelId);
            handled = true;
        }

        if (handled) return { cancel: true };
    },

    async onBeforeMessageEdit(channelId: string, messageId: string, message: { content: string; }) {
        if (!settings.store.autoEncrypt) return;
        const content = message.content?.trim();
        if (!content) return;

        const existing = MessageStore.getMessage(channelId, messageId);
        if (!findPayload(existing)) return;

        const key = await resolveKey(channelId);
        if (!key) {
            showToast("RoxifyCrypt : pas de clé pour ce salon, édition annulée", Toasts.Type.FAILURE);
            return { cancel: true };
        }

        encryptAndEditText(channelId, messageId, content, key).catch(e => {
            showToast("RoxifyCrypt : échec de l'édition chiffrée", Toasts.Type.FAILURE);
            console.error("[RoxifyCrypt] edit failed:", e);
        });

        return { cancel: true };
    },

    renderMessageAccessory: (props: any) => <RoxAccessory message={props.message} />,

    async start() {
        await loadState();
        installStyle();
        applyDisplayMode();

        if (settings.store.autoUpdate && !autoUpdated) {
            autoUpdated = true;
            (async () => {
                try {
                    const r = await getNative().updatePlugin(PLUGIN_VERSION);
                    if (r?.updated) showToast(`RoxifyCrypt : mise à jour v${r.remote} téléchargée${r.built ? " et compilée" : " (fais pnpm build)"}. Redémarre Discord pour l'appliquer.`, Toasts.Type.SUCCESS);
                } catch (e) {
                    console.error("[RoxifyCrypt] auto-update failed:", e);
                }
            })();
        }

        try {
            await ensureIdentity();
        } catch (e) {
            console.error("[RoxifyCrypt] identity failed:", e);
            showToast("RoxifyCrypt : impossible de générer l'identité ECDH", Toasts.Type.FAILURE);
        }

        const path = settings.store.roxifyPath?.trim();
        if (!path) {
            showToast("RoxifyCrypt : configure le chemin du module roxify dans les réglages.", Toasts.Type.MESSAGE);
            return;
        }
        try {
            const r = await getNative().probe(path);
            if (!r.ok) showToast("RoxifyCrypt : roxify introuvable (" + (r.error ?? "?") + ")", Toasts.Type.FAILURE);
        } catch (e) {
            console.error("[RoxifyCrypt] probe failed:", e);
        }
    },

    stop() {
        decodeCache.clear();
        secretCache.clear();
        epochListeners.clear();
        pendingByChannel.clear();
        optimisticByNonce.clear();
        removeStyle();
    },
});

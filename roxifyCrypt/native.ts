/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import type { IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const RAW_BASE = "https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/roxifyCrypt";

function pluginDir(): string | null {
    try {
        const p = join(__dirname, "..", "src", "userplugins", "roxifyCrypt");
        return existsSync(join(p, "index.tsx")) ? p : null;
    } catch {
        return null;
    }
}

function buildRepo(repo: string): Promise<boolean> {
    return new Promise(resolve => {
        try {
            const child = spawn("pnpm", ["build"], { cwd: repo, shell: true, windowsHide: true });
            let done = false;
            const finish = (ok: boolean) => { if (!done) { done = true; resolve(ok); } };
            child.on("error", () => finish(false));
            child.on("exit", code => finish(code === 0));
            setTimeout(() => finish(false), 180000);
        } catch {
            resolve(false);
        }
    });
}

export async function updatePlugin(
    _: IpcMainInvokeEvent,
    currentVersion: number
): Promise<{ updated: boolean; current: number; remote?: number; built?: boolean; error?: string; }> {
    try {
        const dir = pluginDir();
        if (!dir) return { updated: false, current: currentVersion, error: "Dossier du plugin introuvable (installe-le dans Vencord/src/userplugins/roxifyCrypt)." };
        const bust = `?t=${Date.now()}`;
        const idx = await (await fetch(RAW_BASE + "/index.tsx" + bust)).text();
        const m = idx.match(/PLUGIN_VERSION\s*=\s*(\d+)/);
        const remote = m ? Number(m[1]) : 0;
        if (!remote || !idx.includes("definePlugin")) return { updated: false, current: currentVersion, error: "Réponse GitHub invalide." };
        if (remote <= currentVersion) return { updated: false, current: currentVersion, remote };
        const nat = await (await fetch(RAW_BASE + "/native.ts" + bust)).text();
        if (!nat.includes("encodeBinaryToPng") && !nat.includes("loadRoxify")) return { updated: false, current: currentVersion, remote, error: "native.ts distant invalide." };
        writeFileSync(join(dir, "index.tsx"), idx, "utf8");
        writeFileSync(join(dir, "native.ts"), nat, "utf8");
        const built = await buildRepo(join(dir, "..", "..", ".."));
        return { updated: true, current: currentVersion, remote, built };
    } catch (e: any) {
        return { updated: false, current: currentVersion, error: String(e?.message ?? e) };
    }
}

const dynamicImport: (url: string) => Promise<any> = new Function("u", "return import(u);") as any;
const moduleCache = new Map<string, Promise<any>>();

function resolveEntry(roxifyPath: string): string {
    if (!roxifyPath || typeof roxifyPath !== "string") throw new Error("ROXIFY_PATH_MISSING");
    let main = "dist/index.js";
    try {
        const pkg = JSON.parse(readFileSync(join(roxifyPath, "package.json"), "utf8"));
        if (pkg && typeof pkg.main === "string") main = pkg.main;
    } catch {
        void 0;
    }
    return pathToFileURL(join(roxifyPath, main)).href;
}

function loadRoxify(roxifyPath: string): Promise<any> {
    const entry = resolveEntry(roxifyPath);
    let p = moduleCache.get(entry);
    if (!p) {
        p = dynamicImport(entry).catch(err => {
            moduleCache.delete(entry);
            throw err;
        });
        moduleCache.set(entry, p);
    }
    return p;
}

export async function probe(_: IpcMainInvokeEvent, roxifyPath: string): Promise<{ ok: boolean; error?: string; }> {
    try {
        const rox = await loadRoxify(roxifyPath);
        if (typeof rox.encodeBinaryToPng !== "function" || typeof rox.decodePngToBinary !== "function")
            return { ok: false, error: "Module chargé mais encode/decode introuvables." };
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
    }
}

export async function encode(
    _: IpcMainInvokeEvent,
    roxifyPath: string,
    name: string,
    data: Uint8Array,
    passphrase: string
): Promise<Uint8Array> {
    const rox = await loadRoxify(roxifyPath);
    const png: Buffer = await rox.encodeBinaryToPng(Buffer.from(data), { passphrase, encrypt: "aes", name });
    return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

export async function decode(
    _: IpcMainInvokeEvent,
    roxifyPath: string,
    png: Uint8Array,
    passphrase: string
): Promise<{ name: string; data: Uint8Array; }> {
    const rox = await loadRoxify(roxifyPath);
    const res = await rox.decodePngToBinary(Buffer.from(png), { passphrase });
    const buf: Buffer | undefined = res?.buf ?? res?.files?.[0]?.buf;
    if (!buf) throw new Error("NO_DATA");
    const name: string = res?.meta?.name ?? res?.files?.[0]?.name ?? "";
    return { name, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
}

export async function resolveMedia(
    _: IpcMainInvokeEvent,
    url: string
): Promise<{ image?: string; video?: string; }> {
    try {
        const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; RoxifyCrypt)" } });
        const html = await res.text();
        const unescape = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/g, "\"");
        const meta = (prop: string): string | undefined => {
            const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"))
                ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, "i"));
            return m ? unescape(m[1]) : undefined;
        };
        return { image: meta("image"), video: meta("video") };
    } catch {
        return {};
    }
}

export async function fetchMedia(
    _: IpcMainInvokeEvent,
    url: string
): Promise<{ type: string; data: Uint8Array; } | null> {
    try {
        const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; RoxifyCrypt)" } });
        if (!res.ok) return null;
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        if (!/^(image|video)\//i.test(type)) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 30 * 1024 * 1024) return null;
        return { type, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) };
    } catch {
        return null;
    }
}

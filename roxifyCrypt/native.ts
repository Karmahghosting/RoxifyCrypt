/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";
import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

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

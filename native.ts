/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { IpcMainInvokeEvent } from "electron";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

export async function makeDeeplTranslateRequest(_: IpcMainInvokeEvent, pro: boolean, apiKey: string, payload: string) {
    const url = pro
        ? "https://api.deepl.com/v2/translate"
        : "https://api-free.deepl.com/v2/translate";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `DeepL-Auth-Key ${apiKey}`
            },
            body: payload
        });

        const data = await res.text();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

export async function makeKagiTranslateRequest(_: IpcMainInvokeEvent, token: string, text: string, sourceLang: string, targetLang: string) {
    const url = "https://translate.kagi.com/api/translate";

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Cookie": `kagi_session=${token}`
            },
            body: JSON.stringify({
                text,
                from: sourceLang,
                to: targetLang,
                model: "standard"
            }),
        });

        const data = await res.json();
        return { status: res.status, data };
    } catch (e) {
        return { status: -1, data: String(e) };
    }
}

/** Takes a picture of the whole Discord window (used to read text from pictures). Returns it as a data URL. */
export async function captureWindow(event: IpcMainInvokeEvent): Promise<string> {
    const image = await event.sender.capturePage();
    return image.toDataURL();
}

/** A line of text found by the Windows text reader, with its place in the picture (in picture pixels). */
export interface OcrLine {
    text: string;
    x: number;
    y: number;
    w: number;
    h: number;
}

export type WindowsOcrResult =
    | { ok: true; language: string; images: OcrLine[][]; }
    | { ok: false; error: string; };

// Reads the pictures with the text reader that is built into Windows 10 and 11.
// It is used through PowerShell, which every Windows has; nothing has to be installed.
// The answer is printed as simple lines:  LANG<tab>tag,  IMAGE<tab>number,  LINE<tab>x<tab>y<tab>w<tab>h<tab>text,  ERROR<tab>message
const WINDOWS_OCR_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$tab = [char]9
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
    $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

    $job = $env:VC_OCR_INPUT | ConvertFrom-Json

    $marker = 'IAsyncOperation' + [char]96 + '1'
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq $marker } | Select-Object -First 1
    function Await($operation, $resultType) {
        $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
        $null = $task.Wait(-1)
        return $task.Result
    }

    $engine = $null
    if ($job.language) {
        $language = New-Object Windows.Globalization.Language($job.language)
        if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($language)) {
            $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
        }
    }
    if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
    if (-not $engine) { throw 'No text recognition language is installed in Windows' }

    Write-Output ('LANG' + $tab + $engine.RecognizerLanguage.LanguageTag)

    $index = 0
    foreach ($path in @($job.paths)) {
        $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
        $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
        $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

        Write-Output ('IMAGE' + $tab + $index)
        foreach ($line in $result.Lines) {
            $left = [double]::MaxValue
            $top = [double]::MaxValue
            $right = 0.0
            $bottom = 0.0
            foreach ($word in $line.Words) {
                $r = $word.BoundingRect
                if ($r.X -lt $left) { $left = $r.X }
                if ($r.Y -lt $top) { $top = $r.Y }
                if (($r.X + $r.Width) -gt $right) { $right = $r.X + $r.Width }
                if (($r.Y + $r.Height) -gt $bottom) { $bottom = $r.Y + $r.Height }
            }
            $text = $line.Text -replace '[\t\r\n]+', ' '
            Write-Output ('LINE' + $tab + [int][math]::Round($left) + $tab + [int][math]::Round($top) + $tab + [int][math]::Round($right - $left) + $tab + [int][math]::Round($bottom - $top) + $tab + $text)
        }
        $stream.Dispose()
        $index++
    }
} catch {
    Write-Output ('ERROR' + $tab + ($_.Exception.Message -replace '[\r\n]+', ' '))
}
`;

/**
 * Reads text from pictures with the text reader built into Windows.
 * `pngDataUrls` are the pictures, `language` is the wanted language tag (for example "en-US").
 * Falls back to the languages of the user's Windows profile if that language is not installed.
 */
export async function windowsOcr(_: IpcMainInvokeEvent, pngDataUrls: string[], language: string): Promise<WindowsOcrResult> {
    if (process.platform !== "win32") return { ok: false, error: "Only available on Windows" };

    let dir: string | undefined;
    try {
        dir = await mkdtemp(join(tmpdir(), "vc-ocr-"));

        const paths: string[] = [];
        for (const [i, url] of pngDataUrls.entries()) {
            const path = join(dir, `${i}.png`);
            await writeFile(path, Buffer.from(url.slice(url.indexOf(",") + 1), "base64"));
            paths.push(path);
        }

        const encoded = Buffer.from(WINDOWS_OCR_SCRIPT, "utf16le").toString("base64");
        const output = await new Promise<string>((resolve, reject) => {
            execFile(
                "powershell.exe",
                ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
                {
                    env: { ...process.env, VC_OCR_INPUT: JSON.stringify({ paths, language }) },
                    timeout: 60000,
                    windowsHide: true,
                    maxBuffer: 16 * 1024 * 1024,
                    encoding: "utf8"
                },
                (error, stdout, stderr) => {
                    if (error && !stdout) reject(new Error(String(stderr || error.message)));
                    else resolve(stdout);
                }
            );
        });

        let resultLanguage = "";
        const images: OcrLine[][] = paths.map(() => []);
        let current = -1;

        for (const raw of output.split(/\r?\n/)) {
            const parts = raw.split("\t");
            switch (parts[0]) {
                case "ERROR":
                    return { ok: false, error: parts.slice(1).join(" ") };
                case "LANG":
                    resultLanguage = parts[1] ?? "";
                    break;
                case "IMAGE":
                    current = Number(parts[1]);
                    break;
                case "LINE":
                    if (images[current] && parts.length >= 6) {
                        images[current].push({
                            x: Number(parts[1]),
                            y: Number(parts[2]),
                            w: Number(parts[3]),
                            h: Number(parts[4]),
                            text: parts.slice(5).join(" ")
                        });
                    }
                    break;
            }
        }

        if (!resultLanguage) return { ok: false, error: "The Windows text reader gave no answer" };
        return { ok: true, language: resultLanguage, images };
    } catch (e) {
        return { ok: false, error: String(e) };
    } finally {
        if (dir) await rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}

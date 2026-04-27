import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { withMcpUsage } from "../ai/usage.js";

const MODEL_PATH = process.env["WHISPER_MODEL_PATH"] ?? "/opt/whisper-models/ggml-tiny.bin";

/**
 * Transcribe a Telegram voice note (OGG/Opus) to text using the locally
 * installed whisper.cpp + ggml-tiny multilingual model. Two-step:
 *   1. ffmpeg → 16 kHz mono WAV (whisper expects this rate)
 *   2. whisper-cli → text
 *
 * No data leaves the box. Tiny model is the latency sweet spot — accuracy
 * is fine for short voice notes; swap WHISPER_MODEL_PATH (env override) to
 * a small/medium .bin for better quality.
 */
export async function transcribeVoice(audioBuffer: Buffer): Promise<string> {
  return withMcpUsage("transcribeVoice", "whisper.cpp:ggml-tiny", async () => {
    const dir = await mkdtemp(join(tmpdir(), "khata-voice-"));
    const oggPath = join(dir, "input.ogg");
    const wavPath = join(dir, "input.wav");
    const txtPath = `${wavPath}.txt`; // whisper-cli writes <input>.txt

    try {
      await writeFile(oggPath, audioBuffer);

      // ffmpeg: any input → 16 kHz mono WAV
      await runProcess("ffmpeg", [
        "-y",
        "-loglevel", "error",
        "-i", oggPath,
        "-ar", "16000",
        "-ac", "1",
        wavPath,
      ]);

      // whisper-cli: transcribe → write a .txt sibling next to the wav
      await runProcess("whisper-cli", [
        "-m", MODEL_PATH,
        "-f", wavPath,
        "-otxt",
        "-nt", // no timestamps in the output
        "-l", "auto",
      ]);

      const text = await readFile(txtPath, "utf8");
      return text.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

function runProcess(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    p.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    p.on("error", (err) => reject(err));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}

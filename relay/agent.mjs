import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function agentConfig(env = process.env) {
  const authEnabled = parseBoolean(env.RELAY_AUTH_ENABLED, false);
  const secret = String(env.RELAY_SECRET ?? "").trim();
  if (authEnabled && !secret) throw new Error("RELAY_SECRET is required when auth is enabled");
  return {
    relayUrl: String(env.RELAY_URL ?? "http://127.0.0.1:8788").replace(/\/$/, ""),
    workerId: String(env.RELAY_WORKER_ID ?? "alice").trim() || "alice",
    codexCommand: String(env.CODEX_COMMAND ?? "codex").trim() || "codex",
    authEnabled,
    secret,
  };
}

export function buildCodexPrompt(goal, workerId) {
  return [
    "You generate one ComputerCraft 1.75 Lua job for a private Minecraft MVP relay.",
    "Return only executable Lua source. Do not use Markdown fences, JSON, explanations, shell commands, or network calls.",
    "The turtle is the only worker and must execute one bounded, sequential job.",
    "For this first canary, the worker id is " + workerId + ".",
    "The turtle starts at the mouth of a one-block-wide straight stone tunnel, has enough fuel, and has a chest directly below its starting tile.",
    "The job must mine exactly the requested number of cobblestone-producing stone blocks forward, return to the starting tile, and deposit the mined items into the chest below.",
    "Use only ComputerCraft turtle APIs. Fail clearly if the expected block, movement, inventory, or chest operation is unavailable.",
    "Keep every loop bounded by the requested quantity; do not create background loops.",
    "User goal:",
    goal,
  ].join("\n\n");
}

function extractLua(raw) {
  const value = raw.trim();
  const fenced = value.match(/```(?:lua)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : value).trim();
}

export function runCodex({ command, prompt }) {
  return mkdtemp(join(tmpdir(), "cc-mvp-agent-")).then(async (directory) => {
    const outputPath = join(directory, "program.lua");
    try {
      return await new Promise((resolveOutput, rejectOutput) => {
        const child = spawn(
          command,
          [
            "exec",
            "--ephemeral",
            "--sandbox",
            "read-only",
            "--output-last-message",
            outputPath,
            "-",
          ],
          { env: process.env, stdio: ["pipe", "ignore", "pipe"], shell: false },
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("error", rejectOutput);
        child.once("exit", (code, signal) => {
          if (signal) {
            rejectOutput(new Error(`Codex exited from signal ${signal}`));
            return;
          }
          if (code !== 0) {
            rejectOutput(
              new Error(
                `Codex exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`,
              ),
            );
            return;
          }
          readFile(outputPath, "utf8")
            .then((raw) => resolveOutput(extractLua(raw)))
            .catch(rejectOutput);
        });
        child.stdin.end(prompt);
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

async function submitJob(config, goal, program) {
  const headers = { "Content-Type": "application/json" };
  if (config.authEnabled) headers.Authorization = `Bearer ${config.secret}`;
  const response = await fetch(`${config.relayUrl}/api/v1/jobs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: goal, target_worker: config.workerId, program }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`relay returned HTTP ${response.status}: ${body}`);
  return JSON.parse(body);
}

export async function runAgent(goal, env = process.env) {
  const trimmedGoal = String(goal ?? "").trim();
  if (!trimmedGoal) throw new Error('usage: npm run agent -- "<goal>"');
  const config = agentConfig(env);
  const prompt = buildCodexPrompt(trimmedGoal, config.workerId);
  const program = await runCodex({ command: config.codexCommand, prompt });
  if (!program) throw new Error("Codex returned an empty Lua program");
  return submitJob(config, trimmedGoal, program);
}

if (process.argv[1]?.endsWith("agent.mjs")) {
  runAgent(process.argv.slice(2).join(" "))
    .then((job) => console.log(JSON.stringify(job, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}

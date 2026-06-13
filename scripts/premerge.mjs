import { execFile } from "node:child_process";
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const commands = [
  [npmCmd, ["run", "verify"]],
  [npmCmd, ["--prefix", "backend", "run", "verify"]],
  [npmCmd, ["--prefix", "backend", "run", "parser:evaluate"]],
  [npmCmd, ["run", "migration:smoke"]],
  [npmCmd, ["run", "e2e"]],
];

for (const [cmd, args] of commands) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const child = execFile(cmd, args, {
    shell: process.platform === "win32",
    windowsHide: true,
    env: process.env,
    maxBuffer: 1024 * 1024 * 20,
  });
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  const code = await new Promise((resolve) => child.on("exit", resolve));
  if (code !== 0) {
    console.error(`Command failed with exit code ${code}: ${cmd} ${args.join(" ")}`);
    process.exit(code ?? 1);
  }
}

console.log("\nPre-merge checks passed.");

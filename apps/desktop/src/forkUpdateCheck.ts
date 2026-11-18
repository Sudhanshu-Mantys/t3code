/**
 * Fork-only update notice. Active only when T3CODE_FORK_UPDATE_CONFIG points at a JSON file
 * `{ "repo": "<fork checkout>", "installedTag": "v0.1.10", "upstream": "pingdotgg/t3code" }`.
 * The official build never sets it, so this is inert there.
 */
// @effect-diagnostics-next-line nodeBuiltinImport:off - Fork-only plain module, outside the Effect runtime.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as Electron from "electron";

// @effect-diagnostics globalFetch:off globalTimers:off

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface ForkUpdateConfig {
  readonly repo: string;
  readonly installedTag: string;
  readonly upstream: string;
}

const parseVersion = (tag: string): number[] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const isNewer = (candidate: string, installed: string): boolean => {
  const a = parseVersion(candidate);
  const b = parseVersion(installed);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!;
  }
  return false;
};

const readConfig = (path: string): ForkUpdateConfig | null => {
  try {
    const raw = JSON.parse(NodeFS.readFileSync(path, "utf8")) as Partial<ForkUpdateConfig>;
    if (typeof raw.repo !== "string" || typeof raw.installedTag !== "string") return null;
    return { repo: raw.repo, installedTag: raw.installedTag, upstream: raw.upstream ?? "pingdotgg/t3code" };
  } catch {
    return null;
  }
};

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function checkOnce(configPath: string, promptedTags: Set<string>): Promise<void> {
  const config = readConfig(configPath);
  if (!config) return;
  const response = await fetch(`https://api.github.com/repos/${config.upstream}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "t3code-fork-update-check" },
  });
  if (!response.ok) return;
  const release = (await response.json()) as { tag_name?: string; html_url?: string };
  const latest = release.tag_name;
  if (!latest || !isNewer(latest, config.installedTag) || promptedTags.has(latest)) return;
  promptedTags.add(latest);

  const { response: choice } = await Electron.dialog.showMessageBox({
    type: "info",
    buttons: ["Update now", "Release notes", "Later"],
    defaultId: 0,
    cancelId: 2,
    message: `T3 Code ${latest} is available`,
    detail:
      `This fork is based on ${config.installedTag}.\n\n"Update now" opens Terminal and runs the fork ` +
      `update script: it rebases your changes onto ${latest}, rebuilds, and reopens the app. ` +
      `Your data is kept.`,
  });
  if (choice === 1 && release.html_url) {
    await Electron.shell.openExternal(release.html_url);
  } else if (choice === 0) {
    const script = `${config.repo}/scripts/update-fork.sh`;
    const command = `cd ${shellQuote(config.repo)} && ${shellQuote(script)} ${shellQuote(latest)}`;
    NodeChildProcess.spawn(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script ${JSON.stringify(command)}`,
        "-e",
        'tell application "Terminal" to activate',
      ],
      { stdio: "ignore", detached: true },
    ).unref();
  }
}

export function startForkUpdateCheck(): void {
  const configPath = process.env.T3CODE_FORK_UPDATE_CONFIG;
  if (!configPath) return;
  const promptedTags = new Set<string>();
  const run = () => {
    checkOnce(configPath, promptedTags).catch(() => undefined);
  };
  void Electron.app.whenReady().then(() => {
    setTimeout(run, 15_000);
    setInterval(run, CHECK_INTERVAL_MS).unref();
  });
}

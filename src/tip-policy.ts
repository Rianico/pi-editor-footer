export const PI_BUILTIN_SLASH_COMMAND_NAMES = [
  "settings",
  "model",
  "scoped-models",
  "export",
  "import",
  "share",
  "copy",
  "name",
  "session",
  "changelog",
  "hotkeys",
  "fork",
  "clone",
  "tree",
  "trust",
  "login",
  "logout",
  "new",
  "compact",
  "resume",
  "reload",
  "quit",
] as const;

export function collectPiCommandNames(
  sessionCommands: readonly { name: string }[],
): string[] {
  const names = new Set<string>(PI_BUILTIN_SLASH_COMMAND_NAMES);
  for (const command of sessionCommands) {
    if (command.name) names.add(command.name);
  }
  return [...names];
}

export function pickSlashCommandTips(
  availableNames: readonly string[],
  options: {
    fixed?: readonly string[];
    count?: number;
    exclude?: readonly string[];
    random?: () => number;
  } = {},
): string[] {
  const fixed = [...(options.fixed ?? [])];
  const count = options.count ?? 3;
  const exclude = new Set<string>([...(options.exclude ?? []), ...fixed]);
  const random = options.random ?? Math.random;

  const pool = [
    ...new Set(availableNames.map((n) => n.trim()).filter(Boolean)),
  ].filter((name) => !exclude.has(name));

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }

  const picked = pool.slice(0, Math.max(0, count));
  return [...fixed, ...picked].map((name) =>
    name.startsWith("/") ? name : `/${name}`,
  );
}

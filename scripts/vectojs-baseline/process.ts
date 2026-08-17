import type { ArmName, CommandSpec } from './arms';

export interface PreviewChild {
  exited: Promise<number>;
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export interface PreviewOptions {
  root: string;
  arm: ArmName;
  port: number;
  environment: Record<string, string | undefined>;
  timeoutMs?: number;
  pollMs?: number;
}

export interface PreviewDependencies {
  spawn(command: CommandSpec): PreviewChild;
  probe(url: string): Promise<boolean>;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
}

export interface PreviewProcess {
  arm: ArmName;
  url: string;
  child: PreviewChild;
  stop(): Promise<void>;
}

const PREVIEW_ENVIRONMENT = [
  'PATH',
  'HOME',
  'TMPDIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
] as const;

export async function startPreview(
  options: PreviewOptions,
  dependencies: PreviewDependencies = defaultPreviewDependencies,
): Promise<PreviewProcess> {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error(`Invalid preview port: ${options.port}`);
  }
  const timeoutMs = options.timeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 100;
  const url = `http://127.0.0.1:${options.port}`;
  const child = dependencies.spawn({
    argv: [
      'bun',
      'run',
      '--filter',
      '@omm/web',
      'preview',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      String(options.port),
    ],
    cwd: options.root,
    env: previewEnvironment(options.environment),
  });
  let exitCode: number | undefined;
  void child.exited.then((code) => {
    exitCode = code;
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    child.kill('SIGTERM');
    const exited = await Promise.race([
      child.exited.then(() => true),
      dependencies.sleep(5_000).then(() => false),
    ]);
    if (!exited) {
      child.kill('SIGKILL');
      await child.exited;
    }
  };

  const deadline = dependencies.now() + timeoutMs;
  try {
    while (dependencies.now() < deadline) {
      if (await dependencies.probe(url)) {
        return { arm: options.arm, url, child, stop };
      }
      if (exitCode !== undefined) {
        stopped = true;
        throw new Error(`${options.arm} preview exited before readiness with code ${exitCode}`);
      }
      await dependencies.sleep(pollMs);
    }
    throw new Error(`${options.arm} preview did not become ready at ${url}`);
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function stopPreviews(previews: readonly PreviewProcess[]): Promise<void> {
  const results = await Promise.allSettled(
    [...previews].reverse().map((preview) => preview.stop()),
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) throw failure.reason;
}

function previewEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of PREVIEW_ENVIRONMENT) {
    const value = environment[name];
    if (value !== undefined) result[name] = value;
  }
  return result;
}

const defaultPreviewDependencies: PreviewDependencies = {
  spawn(command) {
    const child = Bun.spawn(command.argv, {
      cwd: command.cwd,
      env: command.env,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'inherit',
    });
    return {
      exited: child.exited,
      kill: (signal) => child.kill(signal),
    };
  },
  async probe(url) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      return response.status >= 200 && response.status < 500;
    } catch {
      return false;
    }
  },
  sleep: (milliseconds) => Bun.sleep(milliseconds),
  now: () => Date.now(),
};

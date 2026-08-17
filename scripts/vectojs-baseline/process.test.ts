import { expect, test } from 'bun:test';
import { startPreview, type PreviewChild } from './process';

test('starts an arm-local preview, waits for readiness, and cleans up once', async () => {
  const events: string[] = [];
  let checks = 0;
  const child: PreviewChild = {
    exited: new Promise((resolve) => setTimeout(() => resolve(0), 0)),
    kill(signal) {
      events.push(`kill:${signal}`);
    },
  };
  const preview = await startPreview(
    {
      root: '/tmp/opencode/omm-vectojs-run/baseline/worktree',
      arm: 'baseline',
      port: 4173,
      environment: { PATH: '/bin', NODE_PATH: '/ambient' },
      timeoutMs: 100,
      pollMs: 1,
    },
    {
      spawn(command) {
        events.push(`${command.argv.join(' ')}@${command.cwd}`);
        expect(command.env).toEqual({ PATH: '/bin' });
        return child;
      },
      async probe(url) {
        events.push(`probe:${url}`);
        checks += 1;
        return checks === 2;
      },
      sleep: async (milliseconds) => {
        if (milliseconds === 5_000) await child.exited;
      },
      now: (() => {
        let now = 0;
        return () => ++now;
      })(),
    },
  );

  expect(preview.url).toBe('http://127.0.0.1:4173');
  expect(events[0]).toBe(
    'bun run --filter @omm/web preview -- --host 127.0.0.1 --port 4173@/tmp/opencode/omm-vectojs-run/baseline/worktree',
  );
  await preview.stop();
  await preview.stop();
  expect(events.filter((event) => event === 'kill:SIGTERM')).toHaveLength(1);
});

test('kills the preview when readiness times out', async () => {
  const signals: string[] = [];
  let exit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    exit = resolve;
  });
  await expect(
    startPreview(
      {
        root: '/tmp/opencode/arm',
        arm: 'candidate',
        port: 4174,
        environment: {},
        timeoutMs: 2,
        pollMs: 1,
      },
      {
        spawn: () => ({
          exited,
          kill: (signal) => {
            signals.push(signal);
            exit(0);
          },
        }),
        probe: async () => false,
        sleep: async () => {},
        now: (() => {
          let now = 0;
          return () => ++now;
        })(),
      },
    ),
  ).rejects.toThrow('did not become ready');
  expect(signals).toEqual(['SIGTERM']);
});

test('reports a preview that exits before readiness', async () => {
  await expect(
    startPreview(
      {
        root: '/tmp/opencode/arm',
        arm: 'baseline',
        port: 4175,
        environment: {},
      },
      {
        spawn: () => ({ exited: Promise.resolve(7), kill: () => {} }),
        probe: async () => false,
        sleep: async () => {},
        now: () => 0,
      },
    ),
  ).rejects.toThrow('exited before readiness with code 7');
});

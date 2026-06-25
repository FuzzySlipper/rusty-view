import { describe, expect, it, vi } from 'vitest';

import type {
  ChatPluginCommandContext,
  ChatPluginSlashCommand,
} from './plugin-api';
import {
  coerceSlashCommandArguments,
  commandsForPalette,
  completeSlashCommand,
  executeSlashCommand,
  findSlashCommand,
  parseSlashCommand,
} from './slash-command-runtime';

const context: ChatPluginCommandContext = {
  sessionId: 'sess_1',
  messageId: undefined,
  selectedText: undefined,
  piped: undefined,
  signal: undefined,
  confirm: async () => true,
};

function command(
  overrides: Partial<ChatPluginSlashCommand>,
): ChatPluginSlashCommand {
  return {
    name: 'inspect',
    description: 'Inspect the current session',
    async run() {
      return { type: 'silent' };
    },
    ...overrides,
  };
}

describe('slash command runtime', () => {
  it('parses positional, named, quoted, and boolean arguments', () => {
    const parsed = parseSlashCommand(
      '/send "hello world" --count=3 --dry-run --no-cache file.txt',
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.command.name).toBe('send');
    expect(parsed.command.positional).toEqual(['hello world', 'file.txt']);
    expect(parsed.command.named).toEqual({
      count: '3',
      'dry-run': true,
      cache: false,
    });
  });

  it('finds commands by name or alias', () => {
    const commands = [
      command({ name: 'inspect', aliases: ['i'] }),
      command({ name: 'reset' }),
    ];

    expect(findSlashCommand(commands, '/inspect')?.name).toBe('inspect');
    expect(findSlashCommand(commands, 'i')?.name).toBe('inspect');
    expect(findSlashCommand(commands, 'missing')).toBeUndefined();
  });

  it('coerces typed positional and named arguments', () => {
    const inspect = command({
      name: 'inspect',
      arguments: [
        { name: 'limit', type: 'number' },
        { name: 'mode', type: 'enum', enumValues: ['brief', 'full'] },
      ],
      namedArguments: {
        verbose: { name: 'verbose', type: 'boolean', optional: true },
        data: { name: 'data', type: 'json', optional: true },
      },
    });
    const parsed = parseSlashCommand(
      `/inspect 3 full --verbose --data='{"ok":true}'`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(coerceSlashCommandArguments(inspect, parsed.command)).toEqual({
      positional: [3, 'full'],
      named: { verbose: true, data: { ok: true } },
    });
  });

  it('returns an error result for validation failures', async () => {
    const run = vi.fn();
    const result = await executeSlashCommand(
      '/inspect nope',
      [
        command({
          name: 'inspect',
          arguments: [{ name: 'limit', type: 'number' }],
          run,
        }),
      ],
      context,
    );

    expect(result).toEqual({
      type: 'error',
      message: 'Argument limit must be a number.',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('executes async plugin commands with typed values', async () => {
    const run = vi.fn(async () => ({ type: 'value' as const, value: 'ok' }));

    const result = await executeSlashCommand(
      '/inspect 5 --verbose=false',
      [
        command({
          name: 'inspect',
          arguments: [{ name: 'limit', type: 'number' }],
          namedArguments: {
            verbose: { name: 'verbose', type: 'boolean' },
          },
          run,
        }),
      ],
      context,
    );

    expect(result).toEqual({ type: 'value', value: 'ok' });
    expect(run).toHaveBeenCalledWith(
      [5],
      { verbose: false },
      expect.objectContaining({ sessionId: 'sess_1' }),
    );
  });

  it('returns abort when confirmation is rejected', async () => {
    const run = vi.fn();
    const result = await executeSlashCommand(
      '/reset',
      [
        command({
          name: 'reset',
          confirmation: { required: true, title: 'Reset?' },
          run,
        }),
      ],
      { ...context, confirm: async () => false },
    );

    expect(result).toEqual({ type: 'abort' });
    expect(run).not.toHaveBeenCalled();
  });

  it('filters commands by palette', () => {
    const commands = [
      command({ name: 'input', palettes: ['chat-input'] }),
      command({ name: 'global', palettes: ['global'] }),
      command({ name: 'everywhere' }),
    ];

    expect(
      commandsForPalette(commands, 'chat-input').map((c) => c.name),
    ).toEqual(['input', 'everywhere']);
  });

  it('completes command names, named arguments, and enum values', async () => {
    const commands = [
      command({
        name: 'set',
        description: 'Set a value',
        arguments: [
          {
            name: 'mode',
            type: 'enum',
            enumProviderId: 'modes',
          },
        ],
        namedArguments: {
          force: { name: 'force', type: 'boolean', description: 'Force it' },
          mode: {
            name: 'mode',
            type: 'enum',
            enumProviderId: 'modes',
          },
        },
      }),
    ];
    const enumProviders = [
      {
        id: 'modes',
        values: vi.fn(async () => ['fast', 'full']),
      },
    ];

    await expect(
      completeSlashCommand('/s', commands, enumProviders, {
        sessionId: 'sess_1',
        palette: 'chat-input',
      }),
    ).resolves.toMatchObject([{ kind: 'command', value: '/set' }]);

    await expect(
      completeSlashCommand('/set --f', commands, enumProviders, {
        sessionId: 'sess_1',
      }),
    ).resolves.toMatchObject([{ kind: 'argument', value: '--force' }]);

    const enumCompletions = await completeSlashCommand(
      '/set f',
      commands,
      enumProviders,
      { sessionId: 'sess_1' },
    );
    expect(enumCompletions[0]).toMatchObject({ kind: 'enum', value: 'fast' });

    const namedEnumCompletions = await completeSlashCommand(
      '/set --mode f',
      commands,
      enumProviders,
      { sessionId: 'sess_1' },
    );
    expect(namedEnumCompletions[0]).toMatchObject({
      kind: 'enum',
      value: 'fast',
      argumentName: 'mode',
    });
  });
});

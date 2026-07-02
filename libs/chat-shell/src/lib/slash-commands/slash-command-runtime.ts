import type { ChatCommandDescriptor } from '@rusty-view/protocol';
import type {
  ChatPluginCommandArgument,
  ChatPluginCommandContext,
  ChatPluginCommandResult,
  ChatPluginEnumProvider,
  ChatPluginPalette,
  ChatPluginSlashCommand,
} from '../plugin-api';

export interface ParsedSlashCommand {
  readonly raw: string;
  readonly name: string;
  readonly positional: readonly string[];
  readonly named: Readonly<Record<string, string | boolean>>;
}

export interface SlashCommandParseFailure {
  readonly message: string;
}

export type SlashCommandParseResult =
  | { readonly ok: true; readonly command: ParsedSlashCommand }
  | { readonly ok: false; readonly error: SlashCommandParseFailure };

export interface TypedSlashCommandArguments {
  readonly positional: readonly unknown[];
  readonly named: Readonly<Record<string, unknown>>;
}

export interface SlashCommandCompletion {
  readonly kind: 'command' | 'argument' | 'enum';
  readonly value: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly commandName: string | undefined;
  readonly argumentName: string | undefined;
}

export interface SlashCommandCompletionContext {
  readonly sessionId: string | undefined;
  readonly palette?: ChatPluginPalette;
}

export function parseSlashCommand(input: string): SlashCommandParseResult {
  const raw = input.trim();
  if (!raw.startsWith('/')) {
    return { ok: false, error: { message: 'Command must start with /.' } };
  }

  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    return { ok: false, error: { message: 'Command is empty.' } };
  }

  const commandToken = tokens[0];
  if (commandToken === undefined || !commandToken.startsWith('/')) {
    return { ok: false, error: { message: 'Command must start with /.' } };
  }

  const name = commandToken.slice(1);
  if (name.length === 0) {
    return { ok: false, error: { message: 'Command name is empty.' } };
  }

  const positional: string[] = [];
  const named: Record<string, string | boolean> = {};

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) continue;

    if (token.startsWith('--')) {
      const parsed = parseNamedToken(token);
      if (parsed === undefined) {
        return {
          ok: false,
          error: { message: `Invalid named argument: ${token}` },
        };
      }

      if (parsed.value !== undefined) {
        named[parsed.name] = parsed.value;
        continue;
      }

      if (parsed.negated) {
        named[parsed.name] = false;
        continue;
      }

      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        named[parsed.name] = next;
        i++;
      } else {
        named[parsed.name] = true;
      }
      continue;
    }

    positional.push(token);
  }

  return {
    ok: true,
    command: {
      raw,
      name,
      positional,
      named,
    },
  };
}

export function normalizeSlashCommandText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function pluginCommandDescriptor(
  command: ChatPluginSlashCommand,
): ChatCommandDescriptor {
  const mutating =
    command.sideEffect !== undefined &&
    !['none', 'read'].includes(command.sideEffect);

  return {
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    description: command.description,
    scope: 'session',
    args_schema: pluginCommandArgsSchema(command),
    // These commands are frontend-local plugins surfaced in the chat input.
    positional_args: [],
    named_args: [],
    surfaces: ['chat-input'],
    source: 'plugin',
    read_only: !mutating,
    mutating,
    requires_control_auth:
      command.sideEffect === 'destructive' || command.sideEffect === 'external',
  };
}

export function pluginCommandArgsSchema(
  command: ChatPluginSlashCommand,
): Record<string, unknown> {
  return {
    ...Object.fromEntries(
      (command.arguments ?? []).map((arg) => [arg.name, arg.type]),
    ),
    ...Object.fromEntries(
      Object.entries(command.namedArguments ?? {}).map(([name, arg]) => [
        `--${name}`,
        arg.type,
      ]),
    ),
  };
}

export function findSlashCommand(
  commands: readonly ChatPluginSlashCommand[],
  name: string,
): ChatPluginSlashCommand | undefined {
  const normalized = name.startsWith('/') ? name.slice(1) : name;
  return commands.find((command) => {
    return (
      command.name === normalized ||
      (command.aliases ?? []).includes(normalized)
    );
  });
}

export function commandsForPalette(
  commands: readonly ChatPluginSlashCommand[],
  palette: ChatPluginPalette | undefined,
): readonly ChatPluginSlashCommand[] {
  if (palette === undefined) return commands;
  return commands.filter((command) => {
    const palettes = command.palettes;
    return palettes === undefined || palettes.includes(palette);
  });
}

export function coerceSlashCommandArguments(
  command: ChatPluginSlashCommand,
  parsed: ParsedSlashCommand,
): TypedSlashCommandArguments {
  const positional = (command.arguments ?? []).map((definition, index) => {
    const raw = parsed.positional[index];
    return coerceArgumentValue(definition, raw);
  });

  if (parsed.positional.length > positional.length) {
    throw new Error(
      `Too many positional arguments for /${command.name}: expected ${positional.length}.`,
    );
  }

  const named: Record<string, unknown> = {};
  const definitions = command.namedArguments ?? {};

  for (const [name, definition] of Object.entries(definitions)) {
    named[name] = coerceArgumentValue(definition, parsed.named[name]);
  }

  for (const name of Object.keys(parsed.named)) {
    if (!(name in definitions)) {
      throw new Error(`Unknown named argument --${name} for /${command.name}.`);
    }
  }

  return { positional, named };
}

export async function executeSlashCommand(
  input: string,
  commands: readonly ChatPluginSlashCommand[],
  context: ChatPluginCommandContext,
): Promise<ChatPluginCommandResult> {
  if (isAbortSignalAborted(context.signal)) {
    return { type: 'abort' };
  }

  const parsed = parseSlashCommand(input);
  if (!parsed.ok) {
    return { type: 'error', message: parsed.error.message };
  }

  const command = findSlashCommand(commands, parsed.command.name);
  if (command === undefined) {
    return {
      type: 'error',
      message: `Unknown command /${parsed.command.name}.`,
    };
  }

  try {
    if (command.confirmation?.required === true) {
      const confirmed = await context.confirm(command.confirmation);
      if (!confirmed) return { type: 'abort' };
    }

    const args = coerceSlashCommandArguments(command, parsed.command);
    return await command.run(args.positional, args.named, context);
  } catch (error) {
    if (isAbortError(error) || isAbortSignalAborted(context.signal)) {
      return { type: 'abort' };
    }
    return {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function completeSlashCommand(
  input: string,
  commands: readonly ChatPluginSlashCommand[],
  enumProviders: readonly ChatPluginEnumProvider[],
  context: SlashCommandCompletionContext,
): Promise<readonly SlashCommandCompletion[]> {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return [];

  const tokens = tokenize(trimmed);
  const commandToken = tokens[0] ?? trimmed;
  const commandQuery = commandToken.startsWith('/')
    ? commandToken.slice(1).toLowerCase()
    : commandToken.toLowerCase();
  const paletteCommands = commandsForPalette(commands, context.palette);

  if (tokens.length <= 1 && !trimmed.endsWith(' ')) {
    return paletteCommands
      .filter((command) => command.name.toLowerCase().startsWith(commandQuery))
      .slice(0, 10)
      .map((command) => commandCompletion(command));
  }

  const command = findSlashCommand(paletteCommands, commandQuery);
  if (command === undefined) return [];

  const currentToken = trimmed.endsWith(' ') ? '' : (tokens.at(-1) ?? '');
  const namedValue = activeNamedValueArgument(
    command,
    tokens,
    trimmed.endsWith(' '),
  );
  if (namedValue?.definition.type === 'enum') {
    return enumValueCompletions(
      namedValue.definition,
      namedValue.query,
      command.name,
      enumProviders,
      context,
    );
  }

  if (currentToken.startsWith('--')) {
    return namedArgumentCompletions(command, currentToken.slice(2));
  }

  const parsed = parseSlashCommand(trimmed);
  if (!parsed.ok) return [];

  const positionalIndex = trimmed.endsWith(' ')
    ? parsed.command.positional.length
    : Math.max(0, parsed.command.positional.length - 1);
  const definition = command.arguments?.[positionalIndex];
  if (definition?.type !== 'enum') return [];

  return enumValueCompletions(
    definition,
    currentToken,
    command.name,
    enumProviders,
    context,
  );
}

function coerceArgumentValue(
  definition: ChatPluginCommandArgument,
  raw: string | boolean | undefined,
): unknown {
  if (raw === undefined) {
    if (definition.defaultValue !== undefined) return definition.defaultValue;
    if (definition.optional === true) return undefined;
    throw new Error(`Missing required argument ${definition.name}.`);
  }

  switch (definition.type) {
    case 'string':
    case 'file':
      return String(raw);
    case 'number':
      return coerceNumber(definition.name, raw);
    case 'boolean':
      return coerceBoolean(definition.name, raw);
    case 'enum':
      return coerceEnum(definition, raw);
    case 'json':
      return coerceJson(definition.name, raw);
  }
}

function coerceNumber(name: string, raw: string | boolean): number {
  const value = typeof raw === 'boolean' ? Number(raw) : Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Argument ${name} must be a number.`);
  }
  return value;
}

function coerceBoolean(name: string, raw: string | boolean): boolean {
  if (typeof raw === 'boolean') return raw;
  const lowered = raw.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
  if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  throw new Error(`Argument ${name} must be a boolean.`);
}

function coerceEnum(
  definition: ChatPluginCommandArgument,
  raw: string | boolean,
): string {
  const value = String(raw);
  const allowed = definition.enumValues;
  if (allowed !== undefined && !allowed.includes(value)) {
    throw new Error(
      `Argument ${definition.name} must be one of: ${allowed.join(', ')}.`,
    );
  }
  return value;
}

function coerceJson(name: string, raw: string | boolean): unknown {
  if (typeof raw === 'boolean') {
    throw new Error(`Argument ${name} must be JSON text.`);
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Argument ${name} must be valid JSON.`);
  }
}

function commandCompletion(
  command: ChatPluginSlashCommand,
): SlashCommandCompletion {
  return {
    kind: 'command',
    value: `/${command.name}`,
    label: `/${command.name}`,
    description: command.description,
    commandName: command.name,
    argumentName: undefined,
  };
}

function namedArgumentCompletions(
  command: ChatPluginSlashCommand,
  query: string,
): readonly SlashCommandCompletion[] {
  return Object.entries(command.namedArguments ?? {})
    .filter(([name]) => name.toLowerCase().startsWith(query.toLowerCase()))
    .map(([name, definition]) => ({
      kind: 'argument',
      value: `--${name}`,
      label: `--${name}`,
      description: definition.description,
      commandName: command.name,
      argumentName: name,
    }));
}

function activeNamedValueArgument(
  command: ChatPluginSlashCommand,
  tokens: readonly string[],
  trailingSpace: boolean,
):
  | {
      readonly definition: ChatPluginCommandArgument;
      readonly query: string;
    }
  | undefined {
  const definitions = command.namedArguments ?? {};
  const current = tokens.at(-1);

  if (current?.startsWith('--') === true && current.includes('=')) {
    const parsed = parseNamedToken(current);
    if (parsed === undefined) return undefined;
    const definition = definitions[parsed.name];
    return definition === undefined
      ? undefined
      : { definition, query: parsed.value ?? '' };
  }

  const nameToken = trailingSpace ? current : tokens.at(-2);
  if (nameToken?.startsWith('--') !== true || nameToken.includes('=')) {
    return undefined;
  }

  const parsed = parseNamedToken(nameToken);
  if (parsed === undefined) return undefined;
  const definition = definitions[parsed.name];
  if (definition === undefined) return undefined;

  return {
    definition,
    query: trailingSpace ? '' : (current ?? ''),
  };
}

async function enumValueCompletions(
  definition: ChatPluginCommandArgument,
  query: string,
  commandName: string,
  enumProviders: readonly ChatPluginEnumProvider[],
  context: SlashCommandCompletionContext,
): Promise<readonly SlashCommandCompletion[]> {
  const staticValues = definition.enumValues ?? [];
  const provider = enumProviders.find((item) => {
    return item.id === definition.enumProviderId;
  });
  const providedValues =
    provider === undefined
      ? []
      : await provider.values(query, {
          sessionId: context.sessionId,
          commandName,
          argumentName: definition.name,
        });

  return [...staticValues, ...providedValues]
    .filter((value, index, values) => values.indexOf(value) === index)
    .filter((value) => value.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 10)
    .map((value) => ({
      kind: 'enum',
      value,
      label: value,
      description: definition.description,
      commandName,
      argumentName: definition.name,
    }));
}

function parseNamedToken(token: string):
  | {
      readonly name: string;
      readonly value: string | undefined;
      readonly negated: boolean;
    }
  | undefined {
  const body = token.slice(2);
  if (body.length === 0) return undefined;

  const equals = body.indexOf('=');
  if (equals === -1) {
    return {
      name: normalizeNamedArg(body),
      value: undefined,
      negated: body.startsWith('no-'),
    };
  }

  const name = body.slice(0, equals);
  const value = body.slice(equals + 1);
  if (name.length === 0) return undefined;

  return {
    name: normalizeNamedArg(name),
    value,
    negated: name.startsWith('no-'),
  };
}

function normalizeNamedArg(name: string): string {
  return name.startsWith('no-') ? name.slice(3) : name;
}

function tokenize(input: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += '\\';
  if (current.length > 0) tokens.push(current);

  return tokens;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

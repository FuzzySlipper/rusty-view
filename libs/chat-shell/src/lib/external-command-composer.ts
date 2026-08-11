import type { MessageInputCommandDescriptor } from '@rusty-view/chat-components';
import type {
  ExternalRuntimeCommandCatalog,
  ExternalRuntimeCommandDescriptor,
} from '@rusty-view/protocol';

/** Project Crew's capability-driven external command catalog into composer hints. */
export function externalCommandComposerDescriptors(
  catalog: ExternalRuntimeCommandCatalog | undefined,
): readonly MessageInputCommandDescriptor[] {
  const profileRefresh: MessageInputCommandDescriptor = {
    name: 'refresh-profile',
    description:
      'Start a fresh Codex session with the current profile prompt and move exact switchboard routes to it. Alias: /profile-refresh.',
  };
  if (catalog === undefined) return [profileRefresh];

  return [
    profileRefresh,
    ...catalog.commands.flatMap((command) => {
      const descriptor = commandDescriptor(command, catalog);
      return [
        descriptor,
        ...command.aliases.map((alias) => ({
          ...descriptor,
          name: alias,
          description:
            `Alias for /${command.name}. ${descriptor.description ?? ''}`.trim(),
        })),
      ];
    }),
  ];
}

function commandDescriptor(
  command: ExternalRuntimeCommandDescriptor,
  catalog: ExternalRuntimeCommandCatalog,
): MessageInputCommandDescriptor {
  const argumentValues =
    command.name === 'model'
      ? catalog.models
          .filter((model) => !model.hidden)
          .map((model) => ({
            value: model.id,
            label: model.displayName,
            description: model.description,
          }))
      : command.name === 'effort'
        ? effortValues(catalog)
        : [];
  const argumentName = optionalArgumentName(command.usage);
  return {
    name: command.name,
    description: command.available
      ? command.description
      : `${command.description} Unavailable: ${command.unavailableReasonCode ?? 'unsupported'}.`,
    ...(argumentName === undefined
      ? {}
      : { args_schema: { [argumentName]: { optional: true } } }),
    ...(argumentValues.length === 0 ? {} : { argumentValues }),
  };
}

function effortValues(catalog: ExternalRuntimeCommandCatalog) {
  const selected = catalog.models.find(
    (model) =>
      model.id === catalog.settings.model ||
      model.model === catalog.settings.model,
  );
  return (selected?.supportedEfforts ?? []).map((effort) => ({
    value: effort.value,
    description: effort.description,
  }));
}

function optionalArgumentName(usage: string): string | undefined {
  return /\[([^\]]+)\]/.exec(usage)?.[1];
}

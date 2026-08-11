import type { ExternalRuntimeCommandCatalog } from '@rusty-view/protocol';
import { externalCommandComposerDescriptors } from './external-command-composer';

describe('externalCommandComposerDescriptors', () => {
  it('uses the live catalog for aliases, model choices, and selected-model efforts', () => {
    const commands = externalCommandComposerDescriptors(catalog());

    expect(commands.map((command) => command.name)).toEqual([
      'refresh-profile',
      'help',
      'commands',
      'model',
      'effort',
    ]);
    expect(
      commands.find((command) => command.name === 'model')?.argumentValues,
    ).toEqual([
      {
        value: 'gpt-5.6',
        label: 'GPT 5.6',
        description: 'Frontier model',
      },
    ]);
    expect(
      commands.find((command) => command.name === 'effort')?.argumentValues,
    ).toEqual([
      { value: 'medium', description: 'Balanced' },
      { value: 'high', description: 'Thorough' },
    ]);
  });

  it('keeps unavailable commands visible with the backend reason', () => {
    const value = catalog();
    const commands = externalCommandComposerDescriptors({
      ...value,
      commands: value.commands.map((command) => ({
        ...command,
        available: false,
        unavailableReasonCode: 'model_list_unavailable',
      })),
    });

    expect(commands[1]?.description).toContain('model_list_unavailable');
  });

  it('keeps profile refresh available when native command discovery fails', () => {
    expect(externalCommandComposerDescriptors(undefined)).toEqual([
      expect.objectContaining({ name: 'refresh-profile' }),
    ]);
  });
});

function catalog(): ExternalRuntimeCommandCatalog {
  return {
    contractVersion: '0.7.0',
    runtimeId: 'runtime-1',
    bindingId: 'binding-1',
    nativeThreadId: 'thread-1',
    commands: [
      {
        name: 'help',
        aliases: ['commands'],
        usage: '/help',
        description: 'List commands.',
        mutates: false,
        requiredCapabilities: [],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'model',
        aliases: [],
        usage: '/model [id]',
        description: 'Select a model.',
        mutates: true,
        requiredCapabilities: ['model/list'],
        available: true,
        unavailableReasonCode: null,
      },
      {
        name: 'effort',
        aliases: [],
        usage: '/effort [value]',
        description: 'Select reasoning effort.',
        mutates: true,
        requiredCapabilities: ['model/list'],
        available: true,
        unavailableReasonCode: null,
      },
    ],
    settings: {
      model: 'gpt-5.6',
      modelProvider: 'openai',
      effort: 'medium',
    },
    models: [
      {
        id: 'gpt-5.6',
        model: 'gpt-5.6',
        displayName: 'GPT 5.6',
        description: 'Frontier model',
        hidden: false,
        isDefault: true,
        defaultEffort: 'medium',
        supportedEfforts: [
          { value: 'medium', description: 'Balanced' },
          { value: 'high', description: 'Thorough' },
        ],
      },
      {
        id: 'hidden',
        model: 'hidden',
        displayName: 'Hidden',
        description: 'Internal',
        hidden: true,
        isDefault: false,
        defaultEffort: 'medium',
        supportedEfforts: [],
      },
    ],
  };
}

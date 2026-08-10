import { computed, inject, Injectable, signal } from '@angular/core';
import type { AgentDirectoryEntry } from '@rusty-view/protocol';
import {
  ChatTransport,
  type TelegramDiplomatBinding,
  type TelegramDiplomatBindingCreateRequest,
  type TelegramDiplomatBindingMoveRequest,
  type TelegramDiplomatBindingRelabelRequest,
  type TelegramDiplomatCredentialUpdateRequest,
  type TelegramDiplomatReadback,
} from '@rusty-view/transport';

import { storeErrorMessage } from './store-error';

export interface TelegramDiplomatSessionOption {
  readonly sessionId: string;
  readonly agentId: string;
  readonly profileId: string;
  readonly workdir: string | null;
  readonly runtimeKind: AgentDirectoryEntry['runtimeKind'];
  readonly sessionStatus: AgentDirectoryEntry['sessionStatus'];
  readonly displayLabel: string;
}

@Injectable()
export class TelegramDiplomatStore {
  private readonly transport = inject(ChatTransport);
  private readonly _readback = signal<TelegramDiplomatReadback | null>(null);
  private readonly _directory = signal<readonly AgentDirectoryEntry[]>([]);
  private readonly _loading = signal(false);
  private readonly _saving = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _notice = signal<string | null>(null);

  readonly readback = this._readback.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly error = this._error.asReadonly();
  readonly notice = this._notice.asReadonly();
  readonly bindings = computed<readonly TelegramDiplomatBinding[]>(
    () => this._readback()?.bindings ?? [],
  );
  readonly sessions = computed<readonly TelegramDiplomatSessionOption[]>(() =>
    this._directory()
      .filter(
        (entry) =>
          entry.sessionKind === 'full' && entry.sessionStatus !== 'archived',
      )
      .map((entry) => ({
        sessionId: entry.sessionId,
        agentId: entry.agentId,
        profileId: entry.profileId,
        workdir: entry.workspace?.cwd ?? entry.workdir ?? null,
        runtimeKind: entry.runtimeKind,
        sessionStatus: entry.sessionStatus,
        displayLabel: entry.displayLabel,
      }))
      .sort(
        (left, right) =>
          left.displayLabel.localeCompare(right.displayLabel) ||
          left.sessionId.localeCompare(right.sessionId),
      ),
  );

  async refresh(): Promise<boolean> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const [readback, directory] = await Promise.all([
        this.transport.adminTelegramDiplomat(),
        this.transport.coordinationAgentDirectory(),
      ]);
      this._readback.set(readback);
      this._directory.set(directory.agents);
      return true;
    } catch (error) {
      this._error.set(storeErrorMessage(error));
      return false;
    } finally {
      this._loading.set(false);
    }
  }

  async updateCredential(
    request: TelegramDiplomatCredentialUpdateRequest,
  ): Promise<boolean> {
    return this.mutate('Telegram bot token updated.', async () => {
      const result =
        await this.transport.updateAdminTelegramDiplomatCredential(request);
      this._readback.set(result);
    });
  }

  async reload(): Promise<boolean> {
    return this.mutate('Telegram connector reloaded.', async () => {
      this._readback.set(await this.transport.reloadAdminTelegramDiplomat());
    });
  }

  async createBinding(
    request: TelegramDiplomatBindingCreateRequest,
  ): Promise<boolean> {
    return this.mutate('Install diplomat binding created.', async () => {
      await this.transport.createAdminTelegramDiplomatBinding(request);
      await this.refreshAfterMutation();
    });
  }

  async moveBinding(
    binding: TelegramDiplomatBinding,
    request: Omit<TelegramDiplomatBindingMoveRequest, 'expectedRevision'>,
  ): Promise<boolean> {
    return this.mutate(
      'Install diplomat moved to the selected session.',
      async () => {
        await this.transport.moveAdminTelegramDiplomatBinding(
          binding.bindingId,
          {
            ...request,
            expectedRevision: binding.revision,
          },
        );
        await this.refreshAfterMutation();
      },
    );
  }

  async relabelBinding(
    binding: TelegramDiplomatBinding,
    installationLabel: string,
  ): Promise<boolean> {
    const request: TelegramDiplomatBindingRelabelRequest = {
      expectedRevision: binding.revision,
      installationLabel,
    };
    return this.mutate('Installation label updated.', async () => {
      await this.transport.relabelAdminTelegramDiplomatBinding(
        binding.bindingId,
        request,
      );
      await this.refreshAfterMutation();
    });
  }

  async setBindingStatus(
    binding: TelegramDiplomatBinding,
    action: 'pause' | 'resume' | 'remove',
  ): Promise<boolean> {
    const notices = {
      pause: 'Install diplomat paused; its session remains active.',
      resume: 'Install diplomat resumed.',
      remove: 'Install diplomat binding removed; its session was not archived.',
    } as const;
    return this.mutate(notices[action], async () => {
      await this.transport.setAdminTelegramDiplomatBindingStatus(
        binding.bindingId,
        action,
        { expectedRevision: binding.revision },
      );
      await this.refreshAfterMutation();
    });
  }

  clearMessages(): void {
    this._error.set(null);
    this._notice.set(null);
  }

  private async mutate(
    notice: string,
    operation: () => Promise<void>,
  ): Promise<boolean> {
    if (this._saving()) return false;
    this._saving.set(true);
    this._error.set(null);
    this._notice.set(null);
    try {
      await operation();
      this._notice.set(notice);
      return true;
    } catch (error) {
      this._error.set(storeErrorMessage(error));
      await this.refreshAfterConflict();
      return false;
    } finally {
      this._saving.set(false);
    }
  }

  private async refreshAfterMutation(): Promise<void> {
    this._readback.set(await this.transport.adminTelegramDiplomat());
  }

  private async refreshAfterConflict(): Promise<void> {
    try {
      await this.refreshAfterMutation();
    } catch {
      // Preserve the original mutation error. A deliberate refresh remains
      // available and will report its own failure.
    }
  }
}

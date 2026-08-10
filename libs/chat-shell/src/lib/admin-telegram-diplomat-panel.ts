import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  TelegramDiplomatStore,
  type TelegramDiplomatSessionOption,
} from '@rusty-view/chat-store';
import type { TelegramDiplomatBindingCreateRequest } from '@rusty-view/transport';

@Component({
  selector: 'rv-admin-telegram-diplomat-panel',
  templateUrl: './admin-telegram-diplomat-panel.html',
  styleUrl: './admin-telegram-diplomat-panel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminTelegramDiplomatPanelComponent {
  protected readonly diplomat = inject(TelegramDiplomatStore);
  protected readonly installationId = signal('');
  protected readonly installationLabel = signal('');
  protected readonly selectedCandidateKey = signal('');
  protected readonly selectedSessionId = signal('');
  protected readonly participationMode = signal<
    'mention_or_reply' | 'topic_human_messages'
  >('mention_or_reply');
  protected readonly selectedBindingId = signal('');
  protected readonly moveSessionId = signal('');
  protected readonly relabelValue = signal('');
  protected readonly confirmRemove = signal(false);

  protected readonly selectedCandidate = computed(() => {
    const key = this.selectedCandidateKey();
    return this.diplomat
      .readback()
      ?.candidates.find((candidate) => candidateKey(candidate) === key);
  });
  protected readonly selectedSession = computed(() =>
    this.sessionForId(this.selectedSessionId()),
  );
  protected readonly selectedBinding = computed(() => {
    const bindings = this.diplomat.bindings();
    const selected = bindings.find(
      (binding) => binding.bindingId === this.selectedBindingId(),
    );
    return (
      selected ??
      bindings.find((binding) => binding.status === 'active') ??
      bindings.find((binding) => binding.status !== 'removed') ??
      bindings[0]
    );
  });
  protected readonly selectedBindingSession = computed(() => {
    const binding = this.selectedBinding();
    return binding === undefined
      ? undefined
      : this.sessionForId(binding.sessionId);
  });
  protected readonly createDisabled = computed(
    () =>
      this.diplomat.saving() ||
      this.diplomat.readback()?.botIdentity === undefined ||
      this.installationId().trim().length === 0 ||
      this.installationLabel().trim().length === 0 ||
      this.selectedCandidate() === undefined ||
      this.selectedSession() === undefined,
  );

  constructor() {
    void this.refresh();
  }

  protected async refresh(): Promise<void> {
    const refreshed = await this.diplomat.refresh();
    if (!refreshed) return;
    const readback = this.diplomat.readback();
    if (this.installationId().length === 0) {
      this.installationId.set(readback?.adapterId ?? 'rusty-crew-install');
    }
    this.seedSelections();
  }

  protected setText(
    target: 'installationId' | 'installationLabel' | 'relabel',
    value: string,
  ): void {
    if (target === 'installationId') this.installationId.set(value);
    if (target === 'installationLabel') this.installationLabel.set(value);
    if (target === 'relabel') this.relabelValue.set(value);
  }

  protected selectCandidate(value: string): void {
    this.selectedCandidateKey.set(value);
  }

  protected selectSession(value: string): void {
    this.selectedSessionId.set(value);
  }

  protected selectMoveSession(value: string): void {
    this.moveSessionId.set(value);
  }

  protected selectParticipation(value: string): void {
    this.participationMode.set(
      value === 'topic_human_messages'
        ? 'topic_human_messages'
        : 'mention_or_reply',
    );
  }

  protected selectBinding(value: string): void {
    this.selectedBindingId.set(value);
    this.confirmRemove.set(false);
    this.seedBindingDrafts();
  }

  protected async saveToken(input: HTMLInputElement): Promise<void> {
    const token = input.value.trim();
    if (token.length === 0) return;
    const currentRevision = this.diplomat.readback()?.credential?.revision;
    const saved = await this.diplomat.updateCredential({
      token,
      displayName: 'Telegram install diplomat bot',
      ...(currentRevision === undefined
        ? {}
        : { expectedRevision: currentRevision }),
    });
    if (saved) input.value = '';
    this.seedSelections();
  }

  protected async reload(): Promise<void> {
    await this.diplomat.reload();
    this.seedSelections();
  }

  protected async createBinding(): Promise<void> {
    const candidate = this.selectedCandidate();
    const session = this.selectedSession();
    const bot = this.diplomat.readback()?.botIdentity;
    if (candidate === undefined || session === undefined || bot === undefined)
      return;
    const request: TelegramDiplomatBindingCreateRequest = {
      bindingId: bindingIdFor(
        this.installationId(),
        candidate.externalChatId,
        candidate.externalThreadId,
      ),
      installationId: this.installationId().trim(),
      installationLabel: this.installationLabel().trim(),
      agentId: session.agentId,
      sessionId: session.sessionId,
      externalChatId: candidate.externalChatId,
      ...(candidate.externalThreadId === undefined
        ? {}
        : { externalThreadId: candidate.externalThreadId }),
      participationMode: this.participationMode(),
    };
    const saved = await this.diplomat.createBinding(request);
    if (saved) this.selectedBindingId.set(request.bindingId);
    this.seedSelections();
  }

  protected async moveBinding(targetSessionId: string): Promise<void> {
    const binding = this.selectedBinding();
    const session = this.sessionForId(targetSessionId);
    if (binding === undefined || session === undefined) return;
    await this.diplomat.moveBinding(binding, {
      agentId: session.agentId,
      sessionId: session.sessionId,
    });
    this.seedSelections();
  }

  protected async relabelBinding(): Promise<void> {
    const binding = this.selectedBinding();
    const label = this.relabelValue().trim();
    if (binding === undefined || label.length === 0) return;
    await this.diplomat.relabelBinding(binding, label);
    this.seedSelections();
  }

  protected async toggleBinding(): Promise<void> {
    const binding = this.selectedBinding();
    if (binding === undefined) return;
    await this.diplomat.setBindingStatus(
      binding,
      binding.status === 'paused' || binding.status === 'needs_rebind'
        ? 'resume'
        : 'pause',
    );
    this.seedSelections();
  }

  protected async removeBinding(): Promise<void> {
    const binding = this.selectedBinding();
    if (binding === undefined) return;
    if (!this.confirmRemove()) {
      this.confirmRemove.set(true);
      return;
    }
    await this.diplomat.setBindingStatus(binding, 'remove');
    this.confirmRemove.set(false);
    this.seedSelections();
  }

  protected sessionForId(
    sessionId: string,
  ): TelegramDiplomatSessionOption | undefined {
    return this.diplomat
      .sessions()
      .find((session) => session.sessionId === sessionId);
  }

  protected candidateLabel(candidate: {
    externalChatId: string;
    externalThreadId?: string;
    title?: string;
    chatType: string;
  }): string {
    const surface = candidate.title ?? candidate.externalChatId;
    const topic = candidate.externalThreadId
      ? ` · topic ${candidate.externalThreadId}`
      : '';
    return `${surface}${topic} · ${candidate.chatType}`;
  }

  protected sessionLabel(session: TelegramDiplomatSessionOption): string {
    return `${session.displayLabel} · ${session.profileId} · ${session.workdir ?? 'workdir unavailable'}`;
  }

  protected formatTimestamp(value: string | undefined): string {
    if (value === undefined) return 'never';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
  }

  private seedSelections(): void {
    const firstCandidate = this.diplomat.readback()?.candidates[0];
    if (
      firstCandidate !== undefined &&
      !this.diplomat
        .readback()
        ?.candidates.some(
          (candidate) =>
            candidateKey(candidate) === this.selectedCandidateKey(),
        )
    ) {
      this.selectedCandidateKey.set(candidateKey(firstCandidate));
    }
    const firstSession = this.diplomat.sessions()[0];
    if (
      firstSession !== undefined &&
      this.sessionForId(this.selectedSessionId()) === undefined
    ) {
      this.selectedSessionId.set(firstSession.sessionId);
    }
    const selectedBinding = this.selectedBinding();
    if (selectedBinding !== undefined) {
      this.selectedBindingId.set(selectedBinding.bindingId);
    }
    this.seedBindingDrafts();
  }

  private seedBindingDrafts(): void {
    const binding = this.selectedBinding();
    if (binding === undefined) return;
    this.moveSessionId.set(binding.sessionId);
    this.relabelValue.set(binding.installationLabel);
  }
}

function candidateKey(candidate: {
  externalChatId: string;
  externalThreadId?: string;
}): string {
  return `${candidate.externalChatId}\u0000${candidate.externalThreadId ?? ''}`;
}

function bindingIdFor(
  installationId: string,
  chatId: string,
  threadId: string | undefined,
): string {
  return ['telegram-diplomat', installationId, chatId, threadId ?? 'main']
    .map((part) => part.trim().replace(/[^A-Za-z0-9._:-]+/g, '_'))
    .join(':');
}

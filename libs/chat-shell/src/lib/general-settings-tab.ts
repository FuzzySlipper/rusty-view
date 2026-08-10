import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  USER_IDENTITY_MAX_LENGTH,
  UserIdentitySettingsService,
} from '@rusty-view/chat-store';

/** Options tab for local, non-security operator preferences. */
@Component({
  selector: 'rv-general-settings-tab',
  templateUrl: './general-settings-tab.html',
  styleUrl: './general-settings-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralSettingsTabComponent {
  protected readonly userIdentity = inject(UserIdentitySettingsService);
  protected readonly maxIdentityLength = USER_IDENTITY_MAX_LENGTH;
  private readonly draftOverride = signal<string | undefined>(undefined);
  protected readonly draft = computed(
    () => this.draftOverride() ?? this.userIdentity.identity(),
  );
  protected readonly feedback = signal('');

  protected updateDraft(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.draftOverride.set(target.value);
    this.feedback.set('');
  }

  protected async save(): Promise<void> {
    const saved = await this.userIdentity.setIdentity(this.draft());
    if (!saved) {
      this.feedback.set(
        `Enter a single-line identity between 1 and ${USER_IDENTITY_MAX_LENGTH} characters.`,
      );
      return;
    }
    this.draftOverride.set(undefined);
    this.feedback.set('User identity saved. New messages will use it.');
  }

  protected async reset(): Promise<void> {
    await this.userIdentity.reset();
    this.draftOverride.set(undefined);
    this.feedback.set('Default user identity restored.');
  }
}

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  DEFAULT_USER_IDENTITY,
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
  protected readonly draft = signal(this.userIdentity.identity());
  protected readonly feedback = signal('');

  protected updateDraft(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    this.draft.set(target.value);
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
    this.draft.set(this.userIdentity.identity());
    this.feedback.set('User identity saved. New messages will use it.');
  }

  protected async reset(): Promise<void> {
    await this.userIdentity.reset();
    this.draft.set(DEFAULT_USER_IDENTITY);
    this.feedback.set('Default user identity restored.');
  }
}

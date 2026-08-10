import {
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';

/** Default soft attribution used for ordinary human chat messages. */
export const DEFAULT_USER_IDENTITY = 'user';

/** Maximum identity length accepted by the operator UI. */
export const USER_IDENTITY_MAX_LENGTH = 80;

export interface UserIdentitySettings {
  readonly version: 1;
  readonly identity: string;
}

export const DEFAULT_USER_IDENTITY_SETTINGS: UserIdentitySettings = {
  version: 1,
  identity: DEFAULT_USER_IDENTITY,
};

/** Persistence boundary supplied by the application shell. */
export interface UserIdentitySettingsStorage {
  load(): Promise<unknown | null>;
  save(settings: UserIdentitySettings): Promise<void>;
}

export const USER_IDENTITY_SETTINGS_STORAGE =
  new InjectionToken<UserIdentitySettingsStorage>(
    'USER_IDENTITY_SETTINGS_STORAGE',
  );

/**
 * Owns the local operator's soft chat attribution.
 *
 * This is display/prompt metadata only. It does not represent an account,
 * authenticated principal, authorization subject, or profile binding.
 */
@Injectable({ providedIn: 'root' })
export class UserIdentitySettingsService {
  private readonly storage = inject(USER_IDENTITY_SETTINGS_STORAGE, {
    optional: true,
  });
  private readonly current = signal<UserIdentitySettings>(
    DEFAULT_USER_IDENTITY_SETTINGS,
  );
  private revision = 0;

  readonly settings = this.current.asReadonly();
  readonly identity = computed(() => this.current().identity);

  constructor() {
    void this.load();
  }

  async setIdentity(value: string): Promise<boolean> {
    const identity = validUserIdentity(value);
    if (identity === undefined) return false;

    const next: UserIdentitySettings = { version: 1, identity };
    this.revision += 1;
    this.current.set(next);
    await this.storage?.save(next);
    return true;
  }

  async reset(): Promise<void> {
    this.revision += 1;
    this.current.set(DEFAULT_USER_IDENTITY_SETTINGS);
    await this.storage?.save(DEFAULT_USER_IDENTITY_SETTINGS);
  }

  private async load(): Promise<void> {
    const revisionBeforeLoad = this.revision;
    const stored = await this.storage?.load();
    if (this.revision !== revisionBeforeLoad) return;
    this.current.set(normalizeUserIdentitySettings(stored));
  }
}

export function normalizeUserIdentitySettings(
  value: unknown,
): UserIdentitySettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return DEFAULT_USER_IDENTITY_SETTINGS;
  }

  const record = value as Record<string, unknown>;
  if (record['version'] !== 1) return DEFAULT_USER_IDENTITY_SETTINGS;
  const identity = validUserIdentity(record['identity']);
  if (identity === undefined) return DEFAULT_USER_IDENTITY_SETTINGS;
  return { version: 1, identity };
}

function validUserIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const identity = value.trim();
  if (identity.length === 0 || identity.length > USER_IDENTITY_MAX_LENGTH) {
    return undefined;
  }
  if (/\r|\n/.test(identity)) return undefined;
  return identity;
}

import { TestBed } from '@angular/core/testing';
import { DenReviewOperatorStore } from '@rusty-view/chat-store';
import { ChatTransport } from '@rusty-view/transport';
import { describe, expect, it, vi } from 'vitest';
import { AdminDenReviewPanelComponent } from './admin-den-review-panel';

describe('AdminDenReviewPanelComponent', () => {
  it('shows authoritative pipeline state and disables prompting without a reviewer route', async () => {
    const promptReviewerForTask = vi.fn();
    const transport = {
      getConfig: () => ({ coordinationRole: 'debug' }),
      external: {
        readReviewOperatorConfig: vi.fn(async () => ({
          configRevision: 'revision-1',
          deploymentRole: 'debug',
          authorityId: 'review-den',
          endpointRef: 'config://mcp/den',
          serverName: 'den',
          toolProfileKey: 'direct',
          auditIdentity: 'review-service',
          credential: { present: true, source: 'service_environment' },
          diagnostics: {
            serverName: 'den',
            status: 'ready',
            requiredTools: [],
            missingTools: [],
            checkedAt: '2026-08-12T00:00:00Z',
            message: 'ready',
          },
          reviewerRoute: {
            address: '@reviewer',
            routable: false,
            reasonCode: 'route_disabled',
          },
        })),
        readReviewOperatorPipeline: vi.fn(async () => ({
          projectId: 'rusty-view',
          deploymentRole: 'debug',
          limit: 100,
          offset: 0,
          items: [
            {
              stableId: 'submission-1',
              projectId: 'rusty-view',
              taskId: 6854,
              stage: 'reviewer_delivery_retrying',
              task: { title: 'Review cockpit' },
              latestRound: { id: 4 },
              latestGate: { status: 'passed' },
              submission: {
                submissionId: 'submission-1',
                projectId: 'rusty-view',
                taskId: '6854',
                phase: 'reviewer_dispatch_pending',
                revision: 9,
                reviewer: '@reviewer',
                reviewerSessionId: 'reviewer-session-7',
                reviewerDispatchAttempts: 2,
                repository: 'FuzzySlipper/rusty-view',
                gitRef: 'main',
                commitSha: 'd5bcfeb024459e8887da64da8651988f80ff3fc2',
                baseCommit: '1bf91a3540c6796bf04ce9cdd39f154cf364aca7',
                requiredChecks: ['Verify UI', 'Playwright smoke'],
                gateId: 3262,
                gateStatus: 'passed',
                reviewRoundId: 4513,
                reviewPacketId: 7856,
                reviewFinalizationId: 9901,
                replyStatus: 'pending',
                replyReasonCode: 'adapter_retry',
                createdAt: '2026-08-11T23:59:00Z',
                updatedAt: '2026-08-12T00:00:00Z',
              },
            },
            {
              stableId: 'den-task:rusty-view:6855',
              projectId: 'rusty-view',
              taskId: 6855,
              stage: 'den_reviewable_not_submitted',
              task: { title: 'Direct review' },
              latestRound: null,
              latestGate: null,
            },
            {
              stableId: 'submission-finalization',
              projectId: 'rusty-view',
              taskId: 6856,
              stage: 'den_finalization_pending',
              latestRound: { id: 4514 },
              latestGate: { id: 3263, status: 'passed' },
            },
            {
              stableId: 'submission-reply',
              projectId: 'rusty-view',
              taskId: 6857,
              stage: 'review_complete_reply_pending',
              latestRound: { id: 4515 },
              latestGate: { id: 3264, status: 'passed' },
            },
          ],
        })),
        writeReviewOperatorConfig: vi.fn(),
        promptReviewerForTask,
      },
    };
    await TestBed.configureTestingModule({
      imports: [AdminDenReviewPanelComponent],
      providers: [
        DenReviewOperatorStore,
        { provide: ChatTransport, useValue: transport },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminDenReviewPanelComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await TestBed.inject(DenReviewOperatorStore).refresh();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    const button = Array.from(
      fixture.nativeElement.querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((candidate) => candidate.textContent?.includes('Prompt reviewer'));
    expect(text).toContain('reviewer_delivery_retrying');
    expect(text).toContain('den_reviewable_not_submitted');
    expect(text).toContain('den_finalization_pending');
    expect(text).toContain('review_complete_reply_pending');
    expect(text).toContain('gate passed');
    expect(text).toContain('route_disabled');
    expect(text).toContain('submission-1');
    expect(text).toContain('d5bcfeb024459e8887da64da8651988f80ff3fc2');
    expect(text).toContain('reviewer-session-7');
    expect(text).toContain('Verify UI, Playwright smoke');
    expect(text).toContain('3262 / passed');
    expect(text).toContain('4513 / 7856');
    expect(text).toContain('9901');
    expect(text).toContain('pending / adapter_retry');
    expect(button?.disabled).toBe(true);
    expect(promptReviewerForTask).not.toHaveBeenCalled();

    const store = TestBed.inject(DenReviewOperatorStore);
    const abandon = vi.spyOn(store, 'abandonPromptReviewer');
    const component = fixture.componentInstance as unknown as {
      pendingPrompt: { set(item: unknown): void };
      pendingPromptContext: { set(context: unknown): void };
      cancelPrompt(): void;
    };
    component.pendingPrompt.set({ taskId: 6854 });
    component.pendingPromptContext.set({
      projectId: 'rusty-view',
      deploymentRole: 'debug',
    });
    component.cancelPrompt();
    expect(abandon).toHaveBeenCalledWith(6854, {
      projectId: 'rusty-view',
      deploymentRole: 'debug',
    });
  });

  it('rebases config drafts on refresh and leaves unconfigured fields empty', async () => {
    const writeReviewOperatorConfig = vi.fn(async (request) => ({
      config: {
        ...configs[1],
        authorityId: request.authorityId,
        endpointRef: request.endpointRef,
        auditIdentity: request.auditIdentity,
      },
    }));
    const configs = [
      config('revision-1', undefined, undefined, undefined),
      config('revision-2', 'authority-b', 'config://mcp/den-b', 'audit-b'),
      config('revision-2', 'authority-b', 'config://mcp/den-b', 'audit-b'),
    ];
    const readReviewOperatorConfig = vi.fn(async () => configs.shift());
    await TestBed.configureTestingModule({
      imports: [AdminDenReviewPanelComponent],
      providers: [
        DenReviewOperatorStore,
        {
          provide: ChatTransport,
          useValue: {
            getConfig: () => ({ coordinationRole: 'debug' }),
            external: {
              readReviewOperatorConfig,
              readReviewOperatorPipeline: vi.fn(async () => ({
                projectId: 'rusty-view',
                deploymentRole: 'debug',
                limit: 100,
                offset: 0,
                items: [],
              })),
              writeReviewOperatorConfig,
              promptReviewerForTask: vi.fn(),
            },
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminDenReviewPanelComponent);
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();

    const inputs = fixture.nativeElement.querySelectorAll(
      '.rv-den__config input',
    ) as NodeListOf<HTMLInputElement>;
    expect(Array.from(inputs, (input) => input.value)).toEqual(['', '', '']);

    const refresh = Array.from(
      fixture.nativeElement.querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Refresh'));
    refresh?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(Array.from(inputs, (input) => input.value)).toEqual([
      'authority-b',
      'config://mcp/den-b',
      'audit-b',
    ]);

    const save = Array.from(
      fixture.nativeElement.querySelectorAll(
        'button',
      ) as NodeListOf<HTMLButtonElement>,
    ).find((button) => button.textContent?.includes('Save and apply'));
    save?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
    expect(writeReviewOperatorConfig).toHaveBeenCalledWith({
      expectedConfigRevision: 'revision-2',
      authorityId: 'authority-b',
      endpointRef: 'config://mcp/den-b',
      auditIdentity: 'audit-b',
      expectedDeploymentRole: 'debug',
    });
  });
});

function config(
  configRevision: string,
  authorityId: string | undefined,
  endpointRef: string | undefined,
  auditIdentity: string | undefined,
) {
  return {
    configRevision,
    deploymentRole: 'debug' as const,
    authorityId,
    endpointRef,
    serverName: 'den' as const,
    toolProfileKey: 'direct' as const,
    auditIdentity,
    credential: { present: false, source: 'none' as const },
    diagnostics: {
      serverName: 'den' as const,
      status: 'unconfigured' as const,
      requiredTools: [],
      missingTools: [],
      checkedAt: '2026-08-12T00:00:00Z',
      message: 'unconfigured',
    },
    reviewerRoute: {
      address: '@reviewer',
      routable: false,
      reasonCode: 'agent_route_not_found',
    },
  };
}

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
                reviewer: '@reviewer',
                reviewerDispatchAttempts: 2,
                updatedAt: '2026-08-12T00:00:00Z',
              },
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
    expect(text).toContain('gate passed');
    expect(text).toContain('route_disabled');
    expect(button?.disabled).toBe(true);
    expect(promptReviewerForTask).not.toHaveBeenCalled();
  });
});

import type {
  ChatMessage,
  ConversationBranch,
  ConversationBranchBreadcrumb,
  ConversationNavigationTarget,
  ConversationSnapshot,
} from '@rusty-view/chat-domain';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { TranscriptViewportComponent } from './transcript-viewport';
import { MessageItemComponent } from './message-item';

/**
 * Scale tests for the transcript renderer.
 *
 * CDK virtual scroll requires real DOM layout measurements (scroll dimensions,
 * getBoundingClientRect) that jsdom cannot provide, so these tests verify the
 * component **accepts** large-scale data without error rather than exercising
 * the virtualization itself. The CDK virtual scroll's DOM-level guarantees are
 * architecturally inherent (only visible items exist in the DOM regardless of
 * total count) and are proven by the live e2e in apps/rusty-view-e2e.
 *
 * These tests prove:
 * - The component accepts 10k+ messages without throwing.
 * - The component accepts a very long individual message without throwing.
 * - The component accepts an empty message list.
 * - MessageItemComponent handles streaming state updates.
 */

function generateLargeMessageList(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push({
      id: `msg_${i}`,
      sessionId: 'sess_large',
      author: { role, displayName: undefined },
      createdAt: `2026-06-22T${String(10 + (i % 12)).padStart(2, '0')}:00:00Z`,
      status: 'completed',
      blocks: [
        {
          id: `msg_${i}_block_0`,
          messageId: `msg_${i}`,
          kind: 'text',
          content: `Message ${i}. Lorem ipsum dolor sit amet.`,
          estimatedHeight: undefined,
          renderPolicy: 'full',
        },
      ],
    });
  }
  return messages;
}

describe('TranscriptViewportComponent scale', () => {
  it('accepts 10k+ messages without throwing', async () => {
    const messages = generateLargeMessageList(10_000);
    expect(messages).toHaveLength(10_000);

    await TestBed.configureTestingModule({
      imports: [TranscriptViewportComponent],
    }).compileComponents();

    // Create the component and set the input. We skip detectChanges() because
    // CDK virtual scroll needs real DOM measurements unavailable in jsdom.
    const fixture = TestBed.createComponent(TranscriptViewportComponent);
    fixture.componentRef.setInput('messages', messages);

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.messages()).toHaveLength(10_000);
  });

  it('accepts a very long individual message without throwing', async () => {
    const longContent = 'x'.repeat(100_000);
    const messages: ChatMessage[] = [
      {
        id: 'msg_long',
        sessionId: 'sess_long',
        author: { role: 'assistant', displayName: undefined },
        createdAt: '2026-06-22T10:00:00Z',
        status: 'completed',
        blocks: [
          {
            id: 'msg_long_b0',
            messageId: 'msg_long',
            kind: 'text',
            content: longContent,
            estimatedHeight: undefined,
            renderPolicy: 'partial',
          },
        ],
      },
    ];

    await TestBed.configureTestingModule({
      imports: [TranscriptViewportComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TranscriptViewportComponent);
    fixture.componentRef.setInput('messages', messages);

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('accepts an empty message list', async () => {
    await TestBed.configureTestingModule({
      imports: [TranscriptViewportComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TranscriptViewportComponent);
    fixture.componentRef.setInput('messages', []);

    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.messages()).toHaveLength(0);
  });

  it('accepts generic tree navigation inputs without throwing', async () => {
    const messages = generateLargeMessageList(4);
    const branches: ConversationBranch[] = [
      {
        id: 'main',
        parentMessageId: undefined,
        headMessageId: 'msg_1',
        label: 'main',
        createdAt: '2026-06-24T10:00:00Z',
      },
      {
        id: 'alternate',
        parentBranchId: 'main',
        parentMessageId: 'msg_1',
        headMessageId: 'msg_3',
        label: 'alternate',
        createdAt: '2026-06-24T10:05:00Z',
      },
    ];
    const snapshots: ConversationSnapshot[] = [
      {
        id: 'snap_1',
        branchId: 'alternate',
        messageId: 'msg_2',
        label: 'snap_1',
        summary: undefined,
        createdAt: '2026-06-24T10:06:00Z',
      },
    ];

    await TestBed.configureTestingModule({
      imports: [TranscriptViewportComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TranscriptViewportComponent);
    fixture.componentRef.setInput('messages', messages);
    fixture.componentRef.setInput('branches', branches);
    fixture.componentRef.setInput('activeBranchId', 'alternate');
    fixture.componentRef.setInput('snapshots', snapshots);

    expect(fixture.componentInstance.branches()).toHaveLength(2);
    expect(fixture.componentInstance.snapshots()).toHaveLength(1);
    expect(fixture.componentInstance.activeBranchId()).toBe('alternate');
  });

  it('emits branch and snapshot navigation requests', async () => {
    await TestBed.configureTestingModule({
      imports: [TranscriptViewportComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(TranscriptViewportComponent);
    const component = fixture.componentInstance as unknown as {
      navigationRequested: {
        subscribe: (fn: (target: ConversationNavigationTarget) => void) => void;
      };
      activeBranchSelected: {
        subscribe: (fn: (branchId: string) => void) => void;
      };
      scrollToMessageId: (messageId: string) => void;
      jumpToBranch: (crumb: ConversationBranchBreadcrumb) => void;
      jumpToSnapshot: (target: ConversationNavigationTarget) => void;
    };
    const targets: ConversationNavigationTarget[] = [];
    const selectedBranches: string[] = [];
    component.navigationRequested.subscribe((target) => targets.push(target));
    component.activeBranchSelected.subscribe((branchId) =>
      selectedBranches.push(branchId),
    );
    component.scrollToMessageId = vi.fn();

    const branchTarget: ConversationNavigationTarget = {
      id: 'branch_leaf',
      kind: 'branch',
      messageId: 'msg_3',
      label: 'leaf',
    };
    component.jumpToBranch({
      branch: {
        id: 'branch_leaf',
        parentMessageId: 'msg_1',
        headMessageId: 'msg_3',
        label: 'leaf',
        createdAt: '2026-06-24T10:05:00Z',
      },
      target: branchTarget,
      depth: 0,
    });

    const snapshotTarget: ConversationNavigationTarget = {
      id: 'snap_1',
      kind: 'snapshot',
      messageId: 'msg_2',
      label: 'snap_1',
    };
    component.jumpToSnapshot(snapshotTarget);

    expect(selectedBranches).toEqual(['branch_leaf']);
    expect(targets).toEqual([branchTarget, snapshotTarget]);
    expect(component.scrollToMessageId).toHaveBeenCalledWith('msg_3');
    expect(component.scrollToMessageId).toHaveBeenCalledWith('msg_2');
  });
});

describe('MessageItemComponent streaming safety', () => {
  it('handles streaming state without error', async () => {
    const streamingMessage: ChatMessage = {
      id: 'msg_stream',
      sessionId: 's1',
      author: { role: 'assistant', displayName: undefined },
      createdAt: '2026-06-22T10:00:00Z',
      status: 'streaming',
      blocks: [
        {
          id: 'msg_stream_b0',
          messageId: 'msg_stream',
          kind: 'text',
          content: 'partial text...',
          estimatedHeight: undefined,
          renderPolicy: 'full',
        },
      ],
    };

    await TestBed.configureTestingModule({
      imports: [MessageItemComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(MessageItemComponent);
    fixture.componentRef.setInput('message', streamingMessage);
    fixture.detectChanges();

    // Should show the streaming indicator.
    const host: HTMLElement = fixture.nativeElement;
    expect(host.textContent).toContain('typing');

    expect(fixture.componentInstance).toBeTruthy();
  });
});

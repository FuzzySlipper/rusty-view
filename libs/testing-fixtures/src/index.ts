/**
 * @rusty-view/testing-fixtures
 *
 * Test fixtures for rusty-view: fake sessions, event streams (including
 * unknown-kind and corrupt/partial events), giant transcript fixtures,
 * streaming fixtures, and reconnect/replay fixtures.
 *
 * Production code MUST NOT depend on this package. The module-boundary lint
 * forbids any `type:lib` project from importing a `type:testing` project, so a
 * stray fixture import in production code fails the build. Depends on
 * @rusty-view/protocol and @rusty-view/chat-domain.
 *
 * Implemented in Den task #3182. This file is the public API entrypoint only.
 */
export const TESTING_FIXTURES_VERSION = '0.0.0' as const;
export * from './lib/x.fixture';

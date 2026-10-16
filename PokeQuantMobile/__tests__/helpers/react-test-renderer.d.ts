// Minimal ambient types for react-test-renderer — the package ships no
// declarations and @types/react-test-renderer isn't installed. Only the
// surface renderHook.ts + component-render suites need is declared;
// expand here if a suite needs more (toJSON, act, etc).
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestInstance {
    type: unknown;
    props: Record<string, unknown>;
    findAllByType(type: unknown): ReactTestInstance[];
    findByType(type: unknown): ReactTestInstance;
    findAll(
      predicate: (node: ReactTestInstance) => boolean
    ): ReactTestInstance[];
  }

  export interface ReactTestRenderer {
    root: ReactTestInstance;
    update(element: ReactElement): void;
    unmount(): void;
    toJSON(): unknown;
  }

  export function create(element: ReactElement): ReactTestRenderer;
}

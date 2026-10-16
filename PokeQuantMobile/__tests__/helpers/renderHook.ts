import { act, createElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';

// Minimal hook harness — @testing-library/react-native isn't installed, so
// this is the smallest react-test-renderer wrapper the hook suites need.
// The test component renders null, so no host components are involved.
//
// `act` flushes effects; async state (promise chains inside the hook's
// handlers) settles via `await flushAsync()` — a macrotask hop that lets
// pending microtask chains drain inside act.

export type RenderHook<Result, Props = void> = {
  /** Latest value the hook returned — re-read after every act/flush. */
  result: { current: Result };
  rerender: (props?: Props) => void;
  unmount: () => void;
};

// Every mounted harness unmounts after the test — a store-only change
// would otherwise re-fire effects on hooks that are still alive from
// earlier tests and pollute call counts.
const liveUnmounts: (() => void)[] = [];
afterEach(() => {
  while (liveUnmounts.length) liveUnmounts.pop()!();
});

export function renderHook<Result, Props = void>(
  callback: (props: Props) => Result,
  initialProps?: Props,
): RenderHook<Result, Props> {
  const result = { current: undefined as unknown as Result };
  let currentProps = initialProps as Props;

  function TestComponent() {
    result.current = callback(currentProps);
    return null;
  }

  let renderer!: ReactTestRenderer;
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => {
      renderer.unmount();
    });
  };

  act(() => {
    renderer = create(createElement(TestComponent));
  });
  liveUnmounts.push(unmount);

  return {
    result,
    rerender: (props?: Props) => {
      currentProps = (props === undefined ? currentProps : props) as Props;
      act(() => {
        renderer.update(createElement(TestComponent));
      });
    },
    unmount,
  };
}

/** Drain pending promise chains (microtasks) inside act, without fake timers. */
export function flushAsync(): Promise<void> {
  return act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

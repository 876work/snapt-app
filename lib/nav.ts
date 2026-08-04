import { router } from 'expo-router';

/**
 * Back that can never dead-end or crash. Pops when there is history;
 * otherwise replaces to a sensible fallback (cold-launch deep links, status
 * screens entered by replace, tab-flat screens with no stack beneath).
 * Every back affordance should route through this instead of raw
 * router.back() — expo-router's back() on an empty stack is exactly what
 * produced the Become-a-Creator crash.
 */
export function safeBack(fallback: string = '/(app)/home'): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallback as never);
}

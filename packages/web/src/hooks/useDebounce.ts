import { useState, useEffect } from 'react';

/**
 * Returns `value` after it has stopped changing for `delay` ms.
 *
 * Lifted out of `FilterPanel` by WIC-1612. It used to debounce the panel's own local
 * copy of the search box, which forced the panel to keep local state; it now debounces
 * the page's committed filter state on the way to the API, which lets the panel be
 * fully controlled and still spares the network a request per keystroke.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

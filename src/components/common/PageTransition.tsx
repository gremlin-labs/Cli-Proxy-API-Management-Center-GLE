import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useLocation, type Location } from 'react-router-dom';
import {
  PAGE_TRANSITION_LAYER_CONTEXT_VALUES,
  PageTransitionLayerContext,
} from './PageTransitionLayer';
import './PageTransition.scss';

interface PageTransitionProps {
  render: (location: Location) => ReactNode;
  /** @deprecated Instant routing — kept for call-site compatibility. */
  getRouteOrder?: (pathname: string) => number | null;
  /** @deprecated Instant routing — kept for call-site compatibility. */
  getTransitionVariant?: (fromPathname: string, toPathname: string) => string;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * 即时切换路由：不叠层、不做进出场动画，前一页不会挂在下一页下面。
 * 保留按 history 记录的滚动位置：新页面从顶部开始，后退回到离开时的位置。
 */
export function PageTransition({ render, scrollContainerRef }: PageTransitionProps) {
  const location = useLocation();
  const scrollPositionsRef = useRef(new Map<string, number>());
  const currentRef = useRef({ key: location.key, pathname: location.pathname });

  const resolveScrollContainer = useCallback(() => {
    if (scrollContainerRef?.current) return scrollContainerRef.current;
    if (typeof document === 'undefined') return null;
    return document.scrollingElement as HTMLElement | null;
  }, [scrollContainerRef]);

  // Record the offset continuously: by the time the new route renders, the old
  // page's scrollTop may already be clamped by the new content height.
  useEffect(() => {
    const container = resolveScrollContainer();
    if (!container) return;
    const target: HTMLElement | Window =
      container === document.scrollingElement ? window : container;
    const record = () => {
      scrollPositionsRef.current.set(currentRef.current.key, container.scrollTop);
    };
    target.addEventListener('scroll', record, { passive: true });
    return () => target.removeEventListener('scroll', record);
  }, [resolveScrollContainer]);

  useLayoutEffect(() => {
    const previous = currentRef.current;
    if (previous.key === location.key) return;
    currentRef.current = { key: location.key, pathname: location.pathname };
    // Query/hash-only changes keep the current scroll position.
    if (previous.pathname === location.pathname) return;
    const container = resolveScrollContainer();
    if (!container) return;
    container.scrollTo({
      top: scrollPositionsRef.current.get(location.key) ?? 0,
      left: 0,
      behavior: 'auto',
    });
  }, [location.key, location.pathname, resolveScrollContainer]);

  return (
    <div className="page-transition">
      <div className="page-transition__layer">
        <PageTransitionLayerContext.Provider value={PAGE_TRANSITION_LAYER_CONTEXT_VALUES.current}>
          {render(location)}
        </PageTransitionLayerContext.Provider>
      </div>
    </div>
  );
}

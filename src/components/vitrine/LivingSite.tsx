'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export function LivingSite({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (
      !ref.current ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible');
            observer.unobserve(e.target);
          }
        }),
      { threshold: 0.08 },
    );
    const sections = ref.current.querySelectorAll('[data-site-section]');
    sections.forEach((el) => {
      if (el.getBoundingClientRect().top > innerHeight) {
        el.classList.add('will-reveal');
        observer.observe(el);
      }
    });
    return () => {
      observer.disconnect();
      sections.forEach((el) => el.classList.remove('will-reveal'));
    };
  }, [children]);
  return (
    <div ref={ref} className="living-site">
      {children}
    </div>
  );
}

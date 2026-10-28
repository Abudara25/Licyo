'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView } from '@/actions/public-club.actions';

/** Compte une vue par page (sans cookie, sans IP stockée). */
export function PageViewTracker({ clubId, prefix }: { clubId: string; prefix: string }) {
  const pathname = usePathname();
  useEffect(() => {
    const path = prefix && pathname.startsWith(prefix) ? pathname.slice(prefix.length) || '/' : pathname;
    trackPageView(clubId, path).catch(() => {});
  }, [clubId, pathname, prefix]);
  return null;
}

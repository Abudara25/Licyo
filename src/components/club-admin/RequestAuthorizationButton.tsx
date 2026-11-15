'use client';

import { Send } from 'lucide-react';
import { requestParentalAuthorizations } from '@/actions/parental-authorization.actions';
import { Button } from '@/components/ui/button';
import { useAction } from './useAction';

/** Envoie le lien de signature de l'autorisation parentale : un adhérent, ou toutes les familles concernées. */
export function RequestAuthorizationButton({ memberId, label }: { memberId?: string; label: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() => (memberId || confirm('Envoyer la demande d’autorisation parentale à toutes les familles concernées ?')) && run(() => requestParentalAuthorizations(memberId))}
    >
      <Send aria-hidden /> {label}
    </Button>
  );
}

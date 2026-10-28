'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { sendRenewalInvitations } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';

export function RenewalButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await sendRenewalInvitations();
          if (res.ok) toast.success(res.message);
          else toast.error(res.error);
        })
      }
    >
      <Send aria-hidden /> {pending ? 'Envoi…' : 'Inviter à se réinscrire'}
    </Button>
  );
}

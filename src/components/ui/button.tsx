import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const baseButtonVariants = cva(
  'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        club: 'bg-club-primary text-club-primary-fg hover:opacity-90',
        clubSecondary: 'bg-club-secondary text-club-secondary-fg hover:opacity-90',
        outline: 'border border-input bg-background hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'hover:bg-accent',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        success: 'bg-emerald-600 text-white hover:bg-emerald-700',
        link: 'min-h-0 px-0 text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: '',
        sm: 'min-h-9 px-3 text-xs',
        lg: 'min-h-12 px-6 text-base',
        icon: 'size-11 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/** Classes fusionnées (twMerge) : une classe passée en `className` remplace bien celle de la variante. */
export const buttonVariants = (props?: Parameters<typeof baseButtonVariants>[0]) => cn(baseButtonVariants(props));

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof baseButtonVariants> & { asChild?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(baseButtonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

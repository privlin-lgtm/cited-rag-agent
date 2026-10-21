import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badge = cva('inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300',
      license: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
      restricted: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
      danger: 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
    },
  },
  defaultVariants: { variant: 'default' },
});

export const Badge = ({ className, variant, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) => (
  <span className={cn(badge({ variant }), className)} {...props} />
);

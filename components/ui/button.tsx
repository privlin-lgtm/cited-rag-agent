import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-indigo-600 text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400',
        outline: 'border border-zinc-300 bg-transparent hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800',
        ghost: 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
      },
      size: { default: 'h-10 px-4', sm: 'h-8 px-3 text-xs', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export const Button = ({ className, variant, size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) => (
  <button className={cn(button({ variant, size }), className)} {...props} />
);

import { Skeleton } from '@/components/ui/skeleton';

export function FieldCardSkeleton({ variant = 'vertical' }: { variant?: 'horizontal' | 'vertical' }) {
  if (variant === 'horizontal') {
    return (
      <div className="field-card flex gap-0 overflow-hidden">
        <Skeleton className="w-28 sm:w-36 min-h-[112px] rounded-none flex-shrink-0" />
        <div className="flex flex-col justify-between flex-1 p-4 gap-3">
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    );
  }

  return (
    <div className="field-card w-full overflow-hidden">
      <Skeleton className="h-[180px] w-full rounded-none" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-24 mt-2" />
        <Skeleton className="h-12 w-full mt-3 rounded-[var(--radius-md)]" />
      </div>
    </div>
  );
}

export function FieldGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4 max-w-xl mx-auto sm:max-w-none sm:grid sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <FieldCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ReservationCardSkeleton() {
  return (
    <div className="bg-white rounded-[var(--radius-md)] border border-[var(--color-border)] border-l-4 border-l-[var(--color-surface-2)] p-4 shadow-sm space-y-3">
      <div className="flex justify-between gap-2">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-16 rounded-full" />
      </div>
      <div className="flex justify-between items-center">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

export function ReservationListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3 max-w-xl mx-auto sm:max-w-none sm:grid sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <ReservationCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default FieldCardSkeleton;

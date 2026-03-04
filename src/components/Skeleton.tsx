import React from 'react';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
    className?: string;
    style?: React.CSSProperties;
}

export function Skeleton({ className = '', style, ...props }: SkeletonProps) {
    return (
        <div
            className={`animate-pulse rounded-md bg-slate-800/50 ${className}`}
            style={style}
            {...props}
        />
    );
}

// Pre-built skeleton layouts

export function SkeletonKpiCard() {
    return (
        <div className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
        </div>
    );
}

export function SkeletonChart({ height = 240 }: { height?: number }) {
    return (
        <div className="section-card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="w-full rounded-lg" style={{ height }} />
        </div>
    );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
    return (
        <div className="section-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-16" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Header row */}
                <Skeleton className="h-10 w-full rounded bg-slate-800/80" />
                {/* Body rows */}
                {Array.from({ length: rows }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                ))}
            </div>
        </div>
    );
}

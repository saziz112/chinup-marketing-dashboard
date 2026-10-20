export default function DashboardLoading() {
    return (
        <div aria-busy="true" aria-live="polite">
            <p className="sr-only">Loading...</p>
            <div className="skeleton-block" style={{ height: 36, width: 'min(320px, 70%)', marginBottom: 10 }} />
            <div className="skeleton-block" style={{ height: 14, width: 'min(420px, 90%)', marginBottom: 32 }} />
            <div className="metrics-grid kpi-grid">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="metric-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div className="skeleton-block" style={{ height: 10, width: '55%' }} />
                        <div className="skeleton-block" style={{ height: 26, width: '40%' }} />
                        <div className="skeleton-block" style={{ height: 10, width: '70%' }} />
                    </div>
                ))}
            </div>
            <div className="chart-container">
                <div className="skeleton-block" style={{ height: 18, width: 180, marginBottom: 20 }} />
                <div className="skeleton-block" style={{ height: 240 }} />
            </div>
        </div>
    );
}

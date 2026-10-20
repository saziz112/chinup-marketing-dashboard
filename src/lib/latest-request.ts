/**
 * Drops responses from superseded requests. Without it, a slow fetch for the
 * old date range can land after the new one and put its numbers under the new
 * range's label.
 */
export function createLatestRequest() {
    let current = 0;
    return {
        start: () => ++current,
        isCurrent: (id: number) => id === current,
    };
}

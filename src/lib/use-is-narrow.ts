'use client';

import { useEffect, useState } from 'react';

/** True when the viewport is at or below `maxWidth` px. Used to size chart axes on phones. */
export function useIsNarrow(maxWidth = 640): boolean {
    const [narrow, setNarrow] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
        const update = () => setNarrow(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, [maxWidth]);
    return narrow;
}

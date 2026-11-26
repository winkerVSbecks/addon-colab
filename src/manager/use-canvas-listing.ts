import { useEffect, useState } from 'react';

import { type CanvasListing, type ChannelLike, onCanvasChanged, requestCanvas } from '../channel';

export type CanvasListingState =
  | { status: 'loading' }
  | { status: 'ready'; listing: CanvasListing }
  | { status: 'error'; message: string };

/** The canvas list from the server, refreshed whenever any canvas changes. */
export function useCanvasListing(channel: ChannelLike): CanvasListingState {
  const [state, setState] = useState<CanvasListingState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () => {
      const request = ++latest;
      requestCanvas(channel, 'list').then(
        (listing) => active && request === latest && setState({ status: 'ready', listing }),
        (error: Error) => active && request === latest && setState({ status: 'error', message: error.message }),
      );
    };
    load();
    // Many events arrive in bursts (an agent adding comments); reload once per burst.
    const unsubscribe = onCanvasChanged(channel, () => {
      clearTimeout(timer);
      timer = setTimeout(load, 100);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [channel]);

  return state;
}

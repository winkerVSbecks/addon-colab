import { addons } from 'storybook/preview-api';
import type { ProjectAnnotations, Renderer } from 'storybook/internal/types';

import type { ChannelLike } from './channel';
import { withCanvasPage } from './canvas-page/decorator';
import { installEntryReady } from './canvas-page/entry-ready';

// Canvas entries open without Storybook's error page while the preview's map of story files catches
// up (src/entry-ready.ts). Only adds retries. Waits for the real channel: before one is installed,
// `getChannel()` returns a mock that would never receive anything.
const install = (channel: unknown) => installEntryReady(channel as ChannelLike);
if (addons.hasChannel()) install(addons.getChannel());
else void addons.ready().then(install);

const preview: ProjectAnnotations<Renderer> = {
  // Canvas entries render the canvas page; other stories are untouched.
  decorators: [withCanvasPage],
};

export default preview;

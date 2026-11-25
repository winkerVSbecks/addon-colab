import type { ProjectAnnotations, Renderer } from 'storybook/internal/types';

import { withCanvasPage } from './canvas-page/decorator';

const preview: ProjectAnnotations<Renderer> = {
  // Canvas entries render the canvas page (task 5); other stories are untouched.
  decorators: [withCanvasPage],
};

export default preview;

/**
 * Titles shown above a frame. A loaded story gives its real title and name; before it has loaded,
 * or when the story no longer exists, a readable title is made from the story id.
 */

export interface StoryTitle {
  /** Shown above the frame, e.g. "Button / Primary". */
  short: string;
  /** For tooltips and labels, e.g. "Example/Button › Primary". */
  full: string;
}

export function storyTitle(story: { title: string; name: string }): StoryTitle {
  const component = story.title.split('/').pop() ?? story.title;
  return { short: `${component} / ${story.name}`, full: `${story.title} › ${story.name}` };
}

function words(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * A readable title from a story id such as `example-page--logged-out` → "Example Page / Logged Out".
 * The id does not say where the path of the title splits, so the whole title part is kept together.
 */
export function storyTitleFromId(storyId: string): StoryTitle {
  const separator = storyId.lastIndexOf('--');
  const title = words(separator === -1 ? storyId : storyId.slice(0, separator));
  const name = separator === -1 ? '' : words(storyId.slice(separator + 2));
  if (!title && !name) return { short: storyId, full: storyId };
  if (!name) return { short: title, full: title };
  if (!title) return { short: name, full: name };
  return { short: `${title} / ${name}`, full: `${title} › ${name}` };
}

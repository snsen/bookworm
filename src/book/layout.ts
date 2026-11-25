export interface Size {
  width: number;
  height: number;
}

/**
 * Size of one page so that an open two-page spread fits the stage with a margin.
 * @param aspect page width / height
 */
export function fitSpread(stage: Size, aspect: number, margin = 0.05): Size {
  const availW = stage.width * (1 - 2 * margin);
  const availH = stage.height * (1 - 2 * margin);
  let height = availH;
  let width = height * aspect;
  if (width * 2 > availW) {
    width = availW / 2;
    height = width / aspect;
  }
  return { width: Math.max(50, Math.floor(width)), height: Math.max(70, Math.floor(height)) };
}

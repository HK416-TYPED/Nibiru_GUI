import path from 'node:path';

export function isWithinDirectory(root, target, paths = path) {
  const relative = paths.relative(paths.resolve(root), paths.resolve(target));
  return relative === '' || (!paths.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${paths.sep}`));
}

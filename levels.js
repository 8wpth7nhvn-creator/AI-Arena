// Level thresholds: 0, 500, 1000, 1750, 2500, 3500, 4500, 5750, ...
// The XP needed for each next level grows by 250 every two levels, so the
// curve scales forever without a hardcoded table.

export function xpToAdvance(level) {
  return 500 + 250 * Math.floor((level - 1) / 2);
}

export function levelStart(level) {
  let xp = 0;
  for (let l = 1; l < level; l++) xp += xpToAdvance(l);
  return xp;
}

export function levelInfo(totalXp) {
  const xp = Math.max(0, Math.floor(totalXp || 0));
  let level = 1;
  let start = 0;
  while (xp >= start + xpToAdvance(level)) {
    start += xpToAdvance(level);
    level++;
  }
  const next = start + xpToAdvance(level);
  return {
    level,
    totalXp: xp,
    levelStartXp: start,
    nextLevelXp: next,
    progress: (xp - start) / (next - start),
  };
}

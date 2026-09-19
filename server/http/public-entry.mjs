export const PUBLIC_GAME_PATH = '/versus/';
// Both prefixed browser-relative assets and existing absolute /api and /assets
// addresses reach the same isolated application. No filesystem path is trusted.
export function campaignRequestPath(pathname) {
  return pathname.startsWith(PUBLIC_GAME_PATH) && pathname !== PUBLIC_GAME_PATH
    ? pathname.slice('/versus'.length) : pathname;
}
export function campaignEntryRedirect(pathname) {
  if (pathname === '/' || pathname === '/versus') return PUBLIC_GAME_PATH;
  if (pathname === '/game/' || pathname === '/admin/') return pathname.slice(0, -1);
  return null;
}

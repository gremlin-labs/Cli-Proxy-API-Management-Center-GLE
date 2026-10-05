/**
 * Brand marks bundled into the single-file management.html, so the panel makes no
 * request to GitHub for its own icons.
 */
import appIcon from './brand/app-icon.png';
import favicon from './brand/favicon-32.png';
import appleTouchIcon from './brand/apple-touch-icon.png';

/** Primary app mark (nav, login). 512×512 PNG with transparent corners. */
export const BRAND_ICON_URL = appIcon;

/** Favicon (32×32 PNG). */
export const BRAND_FAVICON_URL = favicon;

/** Apple touch / high-res shortcut icon. */
export const BRAND_APPLE_TOUCH_ICON_URL = appleTouchIcon;

/** @deprecated Prefer BRAND_ICON_URL — kept for existing imports. */
export const INLINE_LOGO_JPEG = BRAND_ICON_URL;

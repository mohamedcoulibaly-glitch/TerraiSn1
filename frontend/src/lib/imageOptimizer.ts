/**
 * Optimise les URLs d'images pour réduire la consommation data (WebP/AVIF).
 * Supporte les CDN courants et les paramètres génériques.
 */

type ImageFormat = 'webp' | 'avif';

const WEBP_HINT = 'format=webp';
const AVIF_HINT = 'format=avif';

function supportsWebP(): boolean {
  if (typeof document === 'undefined') return true;
  const canvas = document.createElement('canvas');
  if (!canvas.getContext?.('2d')) return false;
  return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

let webpSupported: boolean | null = null;

export function checkWebPSupport(): boolean {
  if (webpSupported === null) webpSupported = supportsWebP();
  return webpSupported;
}

export function getOptimizedImageUrl(
  url: string,
  format: ImageFormat = 'webp',
  width?: number,
): string {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
  if (url.startsWith('/') && !url.startsWith('//')) return url;

  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://terrainsn.com');

    if (parsed.hostname.includes('unsplash.com') || parsed.hostname.includes('images.unsplash.com')) {
      parsed.searchParams.set('fm', format);
      parsed.searchParams.set('q', '75');
      if (width) parsed.searchParams.set('w', String(width));
      return parsed.toString();
    }

    if (parsed.hostname.includes('cloudinary.com')) {
      const parts = parsed.pathname.split('/upload/');
      if (parts.length === 2) {
        const transform = `f_${format},q_auto${width ? `,w_${width}` : ''}`;
        parsed.pathname = `${parts[0]}/upload/${transform}/${parts[1]}`;
        return parsed.toString();
      }
    }

    if (parsed.hostname.includes('imgix.net')) {
      parsed.searchParams.set('auto', 'format,compress');
      parsed.searchParams.set('fm', format);
      if (width) parsed.searchParams.set('w', String(width));
      return parsed.toString();
    }

    if (!parsed.searchParams.has('format') && !parsed.pathname.endsWith(`.${format}`)) {
      parsed.searchParams.set('format', format);
    }
    if (width) parsed.searchParams.set('w', String(width));

    return parsed.toString();
  } catch {
    return url;
  }
}

export function getImageSources(
  url: string,
  width?: number,
): { avif?: string; webp?: string; fallback: string } {
  const fallback = url;
  if (!checkWebPSupport()) return { fallback };

  return {
    avif: getOptimizedImageUrl(url, 'avif', width),
    webp: getOptimizedImageUrl(url, 'webp', width),
    fallback,
  };
}

export function buildSrcSet(url: string, widths: number[] = [320, 640, 960]): string {
  return widths.map((w) => `${getOptimizedImageUrl(url, 'webp', w)} ${w}w`).join(', ');
}

export { WEBP_HINT, AVIF_HINT };

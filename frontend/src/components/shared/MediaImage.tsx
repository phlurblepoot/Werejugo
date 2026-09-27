import { useEffect, useState, type ImgHTMLAttributes } from "react";

const RETRIES = [2000, 5000, 15000];

/**
 * An image from the photo library. Immich makes thumbnails in the background,
 * so right after an upload one may not exist yet: show a placeholder and try
 * again a few times instead of a broken image.
 */
export function MediaImage({ src, alt, className, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setAttempt(0); setFailed(false); }, [src]);
  useEffect(() => {
    if (!failed || attempt >= RETRIES.length) return;
    const t = setTimeout(() => { setFailed(false); setAttempt((a) => a + 1); }, RETRIES[attempt]);
    return () => clearTimeout(t);
  }, [failed, attempt]);

  if (failed) return <span className={`media-placeholder ${className ?? ""}`} role="img" aria-label={alt ?? ""}>🖼️</span>;
  // A retry asks again (the extra parameter is ignored by the server's signature check).
  const url = attempt ? `${src}${src.includes("?") ? "&" : "?"}r=${attempt}` : src;
  return <img {...rest} className={className} src={url} alt={alt} onError={() => setFailed(true)} />;
}

'use client';
import { useEffect, useState } from 'react';

/**
 * When the device asks for reduced motion, the scenes hold still and the camera cuts instead of flying. Say so once,
 * so a still page does not look broken; the note goes for good when dismissed.
 */
export function MotionNotice() {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => { try { setDismissed(localStorage.getItem('xaslab-motion-notice') === 'dismissed'); } catch { setDismissed(false); } }, []);
  if (dismissed) return null;
  const dismiss = () => { setDismissed(true); try { localStorage.setItem('xaslab-motion-notice', 'dismissed'); } catch { /* Private browsing can disallow storage. */ } };
  return <div className="motion-notice" role="status">
    <p>Animations are paused because this device is set to reduce motion. Turn on animation effects in the system settings to see them move.</p>
    <button type="button" className="button secondary small" onClick={dismiss}>Got it</button>
  </div>;
}

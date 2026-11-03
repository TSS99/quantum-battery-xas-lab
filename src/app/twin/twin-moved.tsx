'use client';
import { useEffect } from 'react';

const HOME = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;

/** Sends an old /twin/ link to the site root, keeping the #settings so a shared session opens as it was. */
export function TwinMoved() {
  useEffect(() => { window.location.replace(HOME + window.location.hash); }, []);
  return <p className="twin-moved">The Beamline Twin has moved to <a href={HOME}>the main page</a>.</p>;
}

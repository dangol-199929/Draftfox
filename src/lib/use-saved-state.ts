"use client";

import { useEffect, useRef, useState } from "react";
import type { StateKey } from "./db.ts";

const SAVE_DELAY = 400;

function send(key: StateKey, body: string) {
  // keepalive lets the last save finish even when the page is closing or reloading.
  return fetch(`/api/state/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: body.length < 60_000,
  }).catch(() => {});
}

// Keeps `value` in the local database under `key` and hands back what was saved last time through `restore`.
// Loads once `ready` is true (e.g. after the page's own data arrived), then saves shortly after each change,
// and right away when you switch pages or reload. Saving null clears it. Returns true once loading finished.
export function useSavedState<T>(key: StateKey, value: T | null, restore: (saved: T) => void, ready = true): boolean {
  const [loaded, setLoaded] = useState(false);
  const restoreRef = useRef(restore);
  const pending = useRef<string | null>(null);
  const json = JSON.stringify({ value });

  useEffect(() => {
    restoreRef.current = restore;
  });

  useEffect(() => {
    if (!ready || loaded) return;
    let cancelled = false;
    fetch(`/api/state/${key}`)
      .then((response) => (response.ok ? (response.json() as Promise<{ value: T | null }>) : { value: null }))
      .then(({ value: saved }) => {
        if (!cancelled && saved !== null) restoreRef.current(saved);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, ready, loaded]);

  // Skips the first run after loading: it's the value just restored (or the empty page), already in sync.
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (lastSent.current === null) {
      lastSent.current = json;
      return;
    }
    if (json === lastSent.current) return;
    pending.current = json;
    const timer = setTimeout(() => {
      pending.current = null;
      lastSent.current = json;
      send(key, json);
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [key, loaded, json]);

  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return;
      lastSent.current = pending.current;
      send(key, pending.current);
      pending.current = null;
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [key]);

  return loaded;
}

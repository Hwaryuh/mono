import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { InMemoryMediaStore, type MediaStore } from "./media-store";

const MediaStoreContext = createContext<MediaStore>(new InMemoryMediaStore());

export const MediaStoreProvider = MediaStoreContext.Provider;

export function useMediaStore(): MediaStore {
  return useContext(MediaStoreContext);
}

/** Lazily loads a data URL by mediaId. Only fetches the heavy bytes at render time. */
export function useMedia(mediaId: string | null | undefined) {
  const store = useMediaStore();
  return useQuery({
    queryKey: ["media", mediaId],
    queryFn: () => store.load(mediaId as string),
    enabled: Boolean(mediaId),
    staleTime: Infinity,
  });
}
